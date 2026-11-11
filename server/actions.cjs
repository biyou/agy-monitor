const fs = require('fs');
const { execFile } = require('child_process');
const {
  electron,
  AGENTAPI_BAT,
  runtimeState,
  watchdogHistory,
  manuallyStoppedConvs
} = require('./config-state.cjs');
const { listConversations, parseConversation } = require('./collector.cjs');

function formatShortAgo(mtimeMs) {
  if (!mtimeMs) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
  if (diffSec < 60) return `${diffSec}s前`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m前`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h前`;
}

function getCurrentSnapshot() {
  const convs = listConversations();
  const rawParsed = convs.slice(0, 6).map(c => ({
    conv: c,
    snap: parseConversation(c, [])
  }));

  // Cross-reference parent invoke_subagent records to tag subagent conversations accurately
  const subagentRoleMap = new Map();
  for (const item of rawParsed) {
    const mapObj = item.snap.spawnedSubagents || {};
    for (const [subId, role] of Object.entries(mapObj)) {
      subagentRoleMap.set(subId.toLowerCase(), role);
    }
  }

  const parsedTop = rawParsed.map(({ conv: c, snap }) => {
    const lowerId = c.id.toLowerCase();
    const isSub = Boolean(snap.isSubagent || subagentRoleMap.has(lowerId));
    const subRole = subagentRoleMap.get(lowerId) || '';
    snap.isSubagent = isSub;
    if (isSub && subRole && snap.title.startsWith('会话 ')) {
      snap.title = subRole;
    }

    const tag = snap.isStopped
      ? '[已停止]'
      : snap.isCompacting
      ? '[压缩中]'
      : snap.isRunning
      ? '[运行中]'
      : '[已就绪]';
    const shortTitle = (snap.title || c.id.slice(0, 8)).slice(0, 32);
    const finishMs = snap.completedAtMs || c.mtimeMs || 0;
    const isRecentlyFinished =
      !snap.isRunning &&
      !snap.isCompacting &&
      snap.totalStages > 0 &&
      Date.now() - finishMs <= 180000;

    return {
      conv: c,
      snap,
      meta: {
        id: c.id,
        shortId: c.id.slice(0, 6),
        title: snap.title || c.id.slice(0, 8),
        label: `${isSub ? '[子] ' : ''}${shortTitle}`,
        fullLabel: `${tag} ${isSub ? '[子] ' : ''}${shortTitle}`,
        isSubagent: isSub,
        subagentRole: subRole,
        state: snap.state,
        isRunning: snap.isRunning,
        isCompacting: snap.isCompacting,
        isStopped: snap.isStopped,
        isRecentlyFinished,
        overallProgress: snap.overallProgress || 0,
        completedStages: snap.completedStages || 0,
        totalStages: snap.totalStages || 0,
        silenceSeconds: snap.silenceSeconds || 0,
        completedAtMs: snap.completedAtMs || null,
        mtimeMs: c.mtimeMs || 0,
        time: formatShortAgo(c.mtimeMs)
      }
    };
  });

  const allMeta = parsedTop.map(p => p.meta);

  let chosen = parsedTop[0];
  if (runtimeState.selectedConvId === 'auto') {
    const activeRunning = parsedTop.find(p => p.snap.isCompacting || p.snap.isRunning);
    if (activeRunning) chosen = activeRunning;
  } else {
    const found = parsedTop.find(p => p.conv.id === runtimeState.selectedConvId);
    if (found) chosen = found;
  }

  // Parallel task bar candidates: active (running/compacting) OR finished within last 3 minutes
  const parallelCandidates = allMeta.filter(
    m => m.isRunning || m.isCompacting || m.isRecentlyFinished
  );
  if (
    chosen &&
    parallelCandidates.length >= 1 &&
    !parallelCandidates.some(m => m.id === chosen.conv.id)
  ) {
    parallelCandidates.unshift(chosen.meta);
  }

  if (chosen) {
    chosen.snap.conversations = allMeta;
    chosen.snap.parallelTasks = parallelCandidates;
    chosen.snap.isClickThrough = Boolean(runtimeState.isClickThrough);
    return chosen.snap;
  }
  const fallback = parseConversation(convs[0], allMeta);
  fallback.parallelTasks = parallelCandidates;
  fallback.isClickThrough = Boolean(runtimeState.isClickThrough);
  return fallback;
}

// Respect user clipboard: only write to clipboard if explicitly requested or if agentapi fails
function triggerWakeup(convId, reason, forceCopy = false) {
  const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const promptText = `[Watchdog 监控唤醒] 检测到当前任务（${reason || '长时间无新日志输出'}）疑似卡住。请立即调用 manage_task(status) 检查后台任务日志，若卡在交互确认请 send_input，若进程卡死请 kill 并重新调起执行。`;

  manuallyStoppedConvs.delete(convId);
  const prev = watchdogHistory.get(convId) || { wakeupCount: 0, lastWakeupTime: null };
  prev.wakeupCount += 1;
  prev.lastWakeupTime = nowStr;
  watchdogHistory.set(convId, prev);

  return new Promise(resolve => {
    if (fs.existsSync(AGENTAPI_BAT) && convId && convId !== 'none') {
      execFile(
        AGENTAPI_BAT,
        ['send-message', convId, promptText],
        { timeout: 6000, windowsHide: true },
        err => {
          if (!err) {
            if (forceCopy && electron && electron.clipboard) {
              electron.clipboard.writeText(promptText);
            }
            resolve({
              ok: true,
              sentViaAgentApi: true,
              copiedToClipboard: Boolean(forceCopy),
              promptText,
              message: `已通过 AgentAPI 成功唤醒会话 (${convId.slice(0, 8)})`
            });
          } else {
            // Only copy as fallback when agentapi fails
            if (electron && electron.clipboard) {
              electron.clipboard.writeText(promptText);
            }
            resolve({
              ok: true,
              sentViaAgentApi: false,
              copiedToClipboard: true,
              promptText,
              message: `AgentAPI 未响应，已将唤醒指令兜底复制到剪贴板`
            });
          }
        }
      );
    } else {
      if (electron && electron.clipboard) {
        electron.clipboard.writeText(promptText);
      }
      resolve({
        ok: true,
        sentViaAgentApi: false,
        copiedToClipboard: true,
        promptText,
        message: '已将唤醒指令兜底复制到剪贴板'
      });
    }
  });
}

function stopRunningTask(convId) {
  const snap = getCurrentSnapshot();
  const targetId = convId || snap.convId;
  if (targetId && targetId !== 'none') {
    manuallyStoppedConvs.set(targetId, {
      stepIndex: snap.maxStepIndex || 999999,
      stoppedAtMs: Date.now()
    });
  }

  const stopPrompt = `[任务终止指令] 用户在监控面板确认停止了当前任务，请立即调用 manage_task(kill) 终止当前正在运行的后台任务并暂停后续步骤。`;

  return new Promise(resolve => {
    if (fs.existsSync(AGENTAPI_BAT) && targetId && targetId !== 'none') {
      execFile(
        AGENTAPI_BAT,
        ['send-message', targetId, stopPrompt],
        { timeout: 5000, windowsHide: true },
        err => {
          if (!err) {
            resolve({
              ok: true,
              sentViaAgentApi: true,
              copiedToClipboard: false,
              message: `已通过 AgentAPI 发送停止指令 (${targetId.slice(0, 8)})`
            });
          } else {
            if (electron && electron.clipboard) {
              electron.clipboard.writeText(stopPrompt);
            }
            resolve({
              ok: true,
              sentViaAgentApi: false,
              copiedToClipboard: true,
              message: `已标记停止任务（AgentAPI 未响应，终止指令已兜底复制到剪贴板）`
            });
          }
        }
      );
    } else {
      if (electron && electron.clipboard) {
        electron.clipboard.writeText(stopPrompt);
      }
      resolve({
        ok: true,
        sentViaAgentApi: false,
        copiedToClipboard: true,
        message: '已标记停止任务，终止指令已兜底复制到剪贴板'
      });
    }
  });
}

module.exports = {
  getCurrentSnapshot,
  triggerWakeup,
  stopRunningTask
};
