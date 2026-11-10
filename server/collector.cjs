const fs = require('fs');
const path = require('path');
const { BRAIN_DIR, watchdogHistory } = require('./config-state.cjs');
const { isUuidDir, deriveSmartTaskTitle, parseLogProgress } = require('./parser-utils.cjs');
const { extractTranscriptData } = require('./stage-extractor.cjs');

function listConversations() {
  if (!fs.existsSync(BRAIN_DIR)) return [];
  const entries = fs.readdirSync(BRAIN_DIR, { withFileTypes: true });
  const convs = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isUuidDir(entry.name)) continue;
    const convPath = path.join(BRAIN_DIR, entry.name);
    const transcriptPath = path.join(convPath, '.system_generated', 'logs', 'transcript.jsonl');
    let mtimeMs = 0;
    try {
      if (fs.existsSync(transcriptPath)) {
        mtimeMs = fs.statSync(transcriptPath).mtimeMs;
      } else {
        mtimeMs = fs.statSync(convPath).mtimeMs;
      }
    } catch (_) {
      continue;
    }
    convs.push({ id: entry.name, path: convPath, transcriptPath, mtimeMs });
  }

  convs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return convs.slice(0, 12);
}

function parseConversation(conv, allConvs) {
  if (!conv || !fs.existsSync(conv.transcriptPath)) {
    return {
      mode: 'live',
      convId: conv ? conv.id : 'none',
      title: '等待 Antigravity 会话启动...',
      fullPrompt: '',
      latestPrompt: '',
      state: 'idle',
      isRunning: false,
      isCompacting: false,
      isStopped: false,
      overallProgress: 0,
      completedStages: 0,
      totalStages: 0,
      activeStageIndex: 0,
      activeStageTitle: '当前无正在执行的后台任务',
      activeStageElapsedSec: 0,
      elapsedSeconds: 0,
      silenceSeconds: 0,
      activeLogName: '无活跃日志',
      activeLogPath: '',
      logTail: '等待任务执行输出...',
      context: {
        currentTokens: 0,
        maxTokens: 256000,
        usagePct: 0,
        inputTokens: 0,
        cacheTokens: 0,
        cacheHitPct: 0,
        totalOutputTokens: 0,
        compactionCount: 0,
        lastCompactedFrom: 0,
        lastCompactedTo: 0
      },
      stages: [],
      conversations: allConvs,
      watchdog: { wakeupCount: 0, lastWakeupTime: null }
    };
  }

  const {
    steps,
    allUserPrompts,
    initialTaskPrompt,
    mainFullPrompt,
    latestRawPrompt,
    lastUserStepIdx,
    latestFollowup,
    currentMaxStepIdx,
    isManuallyStopped,
    isStoppedCooled,
    latestContextTokens,
    latestInputTokens,
    latestCacheTokens,
    totalOutputTokens,
    compactionCount,
    lastCompactedFrom,
    lastCompactedTo,
    bytesSinceLastPlanner,
    mergedStages,
    isSubagent,
    spawnedSubagents
  } = extractTranscriptData(conv);

  // 4. Inspect .system_generated/tasks/*.log
  const tasksDir = path.join(conv.path, '.system_generated', 'tasks');
  let latestLogFile = null;
  let latestLogMtimeMs = 0;
  let latestLogPath = '';

  const activeRunningBg = mergedStages.find(s => s.status === 'running' && s.logFile);
  if (activeRunningBg && fs.existsSync(path.join(tasksDir, activeRunningBg.logFile))) {
    latestLogFile = activeRunningBg.logFile;
    latestLogPath = path.join(tasksDir, activeRunningBg.logFile);
    try {
      latestLogMtimeMs = fs.statSync(latestLogPath).mtimeMs;
    } catch (_) {}
  } else if (fs.existsSync(tasksDir)) {
    const logFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.log'));
    for (const lf of logFiles) {
      const fp = path.join(tasksDir, lf);
      try {
        const st = fs.statSync(fp);
        if (st.size > 0 && st.mtimeMs >= latestLogMtimeMs) {
          latestLogMtimeMs = st.mtimeMs;
          latestLogFile = lf;
          latestLogPath = fp;
        }
      } catch (_) {}
    }
  }

  let logTail = '';
  let parsedLogPct = null;
  if (latestLogPath && fs.existsSync(latestLogPath)) {
    try {
      const content = fs.readFileSync(latestLogPath, 'utf-8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (lines.length > 0) {
        logTail = lines.slice(-30).join('\n');
        parsedLogPct = parseLogProgress(content);
      }
    } catch (_) {}
  }

  // 5. Determine turn completion & Compacting state
  const lastStep = steps[steps.length - 1];
  const hasRunningBgTask = mergedStages.some(s => s.status === 'running');

  const isTurnFinished = Boolean(
    isManuallyStopped ||
      (lastStep &&
        lastStep.type === 'PLANNER_RESPONSE' &&
        lastStep.status === 'DONE' &&
        (!Array.isArray(lastStep.tool_calls) ||
          lastStep.tool_calls.length === 0 ||
          lastStep.tool_calls.every(tc => tc.name === 'ask_question')) &&
        !hasRunningBgTask)
  );

  const lastStepTimeMs =
    lastStep && lastStep.created_at ? Date.parse(lastStep.created_at) : conv.mtimeMs || Date.now();
  const postStepWaitSec = Math.max(1, Math.floor((Date.now() - lastStepTimeMs) / 1000));

  const isStaleSession = !isTurnFinished && postStepWaitSec > 2700;
  const isRunning = !isTurnFinished && !isStaleSession;

  const estimatedContextTokens = latestContextTokens + Math.round(bytesSinceLastPlanner / 3.2);
  const isCompacting =
    isRunning &&
    !hasRunningBgTask &&
    (estimatedContextTokens >= 135000 || (bytesSinceLastPlanner >= 60000 && postStepWaitSec >= 10));

  // Build final stages list (using a single unified timer source for active stage!)
  const stages = mergedStages.map((st, idx) => {
    let stStatus = st.status;
    if (isManuallyStopped && stStatus === 'running') {
      stStatus = 'stopped';
    }
    const hasRealProgress = stStatus === 'running' && parsedLogPct !== null;
    return {
      index: idx + 1,
      title: st.title,
      badge: st.badge || '',
      command: st.command,
      toolType: st.toolType || 'shell',
      previewPrefix: st.previewPrefix || '$',
      previewTarget: st.previewTarget || st.command,
      status: stStatus,
      hasRealProgress,
      progress: stStatus === 'done' ? 100 : hasRealProgress ? parsedLogPct : null,
      durationSec: st.durationSec,
      logFile: st.logFile,
      subSteps: st.subSteps && st.subSteps.length > 1 ? st.subSteps : []
    };
  });

  if (isRunning && !hasRunningBgTask) {
    const synthIndex = stages.length + 1;
    if (isCompacting) {
      const tokK = Math.round(estimatedContextTokens / 1000);
      stages.push({
        index: synthIndex,
        title: `上下文压缩中 (Compacting)`,
        badge: `~${tokK}k tokens`,
        command: `正在压缩约 ${tokK}k tokens 上下文窗口，耗时取决于上下文长度`,
        toolType: 'think',
        previewPrefix: '🧠 状态',
        previewTarget: `正在压缩约 ${tokK}k tokens 上下文窗口，耗时取决于上下文长度`,
        status: 'compacting',
        hasRealProgress: false,
        progress: null,
        durationSec: postStepWaitSec,
        logFile: null,
        subSteps: []
      });
    } else {
      stages.push({
        index: synthIndex,
        title: '模型深度思考与生成回复中...',
        badge: '推理中',
        command: `正在分析工具输出并生成下一步动作`,
        toolType: 'think',
        previewPrefix: '🧠 状态',
        previewTarget: `正在分析工具输出并生成下一步动作`,
        status: 'running',
        hasRealProgress: false,
        progress: null,
        durationSec: postStepWaitSec,
        logFile: null,
        subSteps: []
      });
    }
  }

  const cleanTitle = deriveSmartTaskTitle(conv.id, allUserPrompts, stages);

  const totalStages = stages.length;
  const completedStages = stages.filter(s => s.status === 'done').length;
  const stoppedStages = stages.filter(s => s.status === 'stopped').length;
  const errorStages = stages.filter(s => s.status === 'error').length;

  const runningStage =
    stages.find(s => s.status === 'compacting' || s.status === 'running') || stages[stages.length - 1];
  const activeStageIndex = runningStage ? runningStage.index : totalStages;
  const activeStageElapsedSec = runningStage ? runningStage.durationSec : postStepWaitSec;

  // Overall progress calculation: clear and consistent with stage ratio
  let overallProgress = 0;
  if (totalStages > 0) {
    if (!isRunning && !isManuallyStopped) {
      overallProgress = 100;
    } else {
      const activeContribution =
        runningStage && runningStage.hasRealProgress && runningStage.progress
          ? runningStage.progress / 100
          : 0.45;
      const effectiveDone = completedStages + (isRunning ? activeContribution : 0);
      overallProgress = Math.min(92, Math.max(8, Math.round((effectiveDone / totalStages) * 100)));
    }
  } else if (!isRunning && steps.length > 0) {
    overallProgress = 100;
  }

  const lastActivityMs = Math.max(conv.mtimeMs || 0, latestLogMtimeMs || 0, lastStepTimeMs || 0);
  const silenceSeconds = isRunning
    ? Math.max(0, Math.floor((Date.now() - lastActivityMs) / 1000))
    : 0;

  const turnStartMs =
    lastUserStepIdx >= 0 && steps[lastUserStepIdx]?.created_at
      ? Date.parse(steps[lastUserStepIdx].created_at)
      : conv.mtimeMs;
  const rawElapsedSec = isRunning
    ? Math.max(0, Math.floor((Date.now() - turnStartMs) / 1000))
    : Math.max(0, Math.floor((lastActivityMs - turnStartMs) / 1000));

  const stepsDurationSec = stages.reduce((acc, s) => acc + (s.durationSec || 0), 0);
  const elapsedSeconds = Math.max(rawElapsedSec, stepsDurationSec);
  const thinkWaitSec = Math.max(0, elapsedSeconds - stepsDurationSec);

  const completedAtMs = !isRunning ? lastStepTimeMs || lastActivityMs : null;
  const completedAtClock = completedAtMs
    ? new Date(completedAtMs).toLocaleTimeString('zh-CN', { hour12: false })
    : '';

  const wdInfo = watchdogHistory.get(conv.id) || { wakeupCount: 0, lastWakeupTime: null };

  if (!logTail) {
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'GENERIC' && steps[i].content) {
        logTail = steps[i].content.split(/\r?\n/).slice(-25).join('\n');
        break;
      }
    }
  }

  let state = 'idle';
  if (isManuallyStopped) state = isStoppedCooled ? 'stopped_cool' : 'stopped';
  else if (isCompacting) state = 'compacting';
  else if (isRunning) state = 'running';
  else if (errorStages > 0) state = 'error';

  const maxContextTokens = 256000;
  const contextUsagePct = Math.min(100, Math.round((estimatedContextTokens / maxContextTokens) * 100));
  const cacheHitPct =
    latestContextTokens > 0 ? Math.round((latestCacheTokens / latestContextTokens) * 100) : 0;

  return {
    mode: 'live',
    convId: conv.id,
    maxStepIndex: currentMaxStepIdx,
    title: cleanTitle,
    isSubagent: Boolean(isSubagent),
    spawnedSubagents: spawnedSubagents || {},
    initialPrompt: initialTaskPrompt || '',
    fullPrompt: latestRawPrompt || mainFullPrompt || '',
    latestPrompt: latestFollowup,
    state,
    isRunning,
    isCompacting,
    isStopped: isManuallyStopped,
    isStoppedCooled,
    estimatedContextTokens,
    context: {
      currentTokens: estimatedContextTokens,
      maxTokens: maxContextTokens,
      usagePct: contextUsagePct,
      inputTokens: latestInputTokens,
      cacheTokens: latestCacheTokens,
      cacheHitPct,
      totalOutputTokens,
      compactionCount,
      lastCompactedFrom,
      lastCompactedTo
    },
    overallProgress,
    completedStages,
    stoppedStages,
    errorStages,
    totalStages,
    activeStageIndex,
    activeStageTitle: isManuallyStopped
      ? `已停止：${runningStage ? runningStage.title : '任务已手动终止'}`
      : runningStage
      ? `${runningStage.title}${runningStage.badge ? ' · ' + runningStage.badge : ''}`
      : isRunning
      ? '正在思考与规划步骤...'
      : '当前回合全部步骤执行完毕',
    activeStageCommand: runningStage ? runningStage.command : '',
    activeStageElapsedSec,
    elapsedSeconds,
    stepsDurationSec,
    thinkWaitSec,
    completedAtMs,
    completedAtClock,
    silenceSeconds,
    activeLogName: latestLogFile || 'transcript.jsonl',
    activeLogPath: latestLogPath || conv.transcriptPath,
    logTail: logTail || '暂无命令输出',
    stages,
    conversations: allConvs,
    watchdog: wdInfo
  };
}

module.exports = {
  listConversations,
  parseConversation
};
