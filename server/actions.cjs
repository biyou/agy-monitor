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

function getCurrentSnapshot() {
  const convs = listConversations();
  const parsedTop = convs.slice(0, 6).map(c => {
    const snap = parseConversation(c, []);
    const tag = snap.isStopped
      ? '[已停止]'
      : snap.isCompacting
      ? '[压缩中]'
      : snap.isRunning
      ? '[运行中]'
      : '[已就绪]';
    const shortTitle = (snap.title || c.id.slice(0, 8)).slice(0, 15);
    return {
      conv: c,
      snap,
      meta: { id: c.id, label: `${tag} ${shortTitle}` }
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

  if (chosen) {
    chosen.snap.conversations = allMeta;
    return chosen.snap;
  }
  return parseConversation(convs[0], allMeta);
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
