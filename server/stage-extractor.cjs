const fs = require('fs');
const path = require('path');
const { manuallyStoppedConvs } = require('./config-state.cjs');
const {
  unquote,
  extractUserRequest,
  isFeedbackOrChatter,
  isShortFollowup,
  classifyToolPreview,
  localizeToolTitle
} = require('./parser-utils.cjs');

function extractTranscriptData(conv) {
  const rawLines = fs.readFileSync(conv.transcriptPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const steps = [];
  for (const line of rawLines) {
    try {
      steps.push(JSON.parse(line));
    } catch (_) {}
  }

  // 1. Extract user prompts and summarize title
  const allUserPrompts = [];
  let initialTaskPrompt = '';
  let mainFullPrompt = '';
  let latestRawPrompt = '';
  let lastUserStepIdx = -1;
  let hasExplicitUserRequest = false;
  const spawnedSubagents = {}; // convId -> role

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'USER_INPUT' && s.content) {
      if (/<USER_REQUEST>/i.test(s.content) || s.source === 'USER_EXPLICIT') {
        hasExplicitUserRequest = true;
      }
      const req = extractUserRequest(s.content);
      if (req) {
        allUserPrompts.push(req);
        latestRawPrompt = req;
        lastUserStepIdx = i;
        if (!initialTaskPrompt && !isFeedbackOrChatter(req)) {
          initialTaskPrompt = req;
        }
        if (!mainFullPrompt || !isFeedbackOrChatter(req)) {
          mainFullPrompt = req;
        }
      }
    }
  }
  const isSubagent = steps.length > 0 && !hasExplicitUserRequest;
  if (!initialTaskPrompt && allUserPrompts.length > 0) {
    initialTaskPrompt = allUserPrompts[0];
  }
  const latestFollowup =
    latestRawPrompt && latestRawPrompt !== mainFullPrompt && isShortFollowup(latestRawPrompt)
      ? latestRawPrompt
      : '';

  // Check manual stop state
  const lastStepObj = steps[steps.length - 1];
  const currentMaxStepIdx = lastStepObj ? lastStepObj.step_index : 0;
  let stopRecord = manuallyStoppedConvs.get(conv.id);
  if (stopRecord && currentMaxStepIdx > stopRecord.stepIndex) {
    manuallyStoppedConvs.delete(conv.id);
    stopRecord = null;
  }
  const isManuallyStopped = Boolean(stopRecord);
  const isStoppedCooled = Boolean(stopRecord && Date.now() - stopRecord.stoppedAtMs > 12000);

  // 2. Collect completed / canceled / failed background task IDs
  const finishedBgTasks = new Map(); // taskId -> 'done' | 'stopped' | 'error'
  for (const s of steps) {
    const text = s.content || '';
    const sysMatch = text.match(/Task id "([^"]+)" (completed|was canceled|failed)/i);
    if (sysMatch) {
      const verb = sysMatch[2].toLowerCase();
      finishedBgTasks.set(
        sysMatch[1],
        verb.includes('completed') ? 'done' : verb.includes('canceled') ? 'stopped' : 'error'
      );
    }
    const cancelMatch = text.match(/Task "([^"]+)" cancelled/i);
    if (cancelMatch) {
      finishedBgTasks.set(cancelMatch[1], 'stopped');
    }
  }

  // 3. Extract tool execution stages & Context Window telemetry
  const rawStages = [];
  let latestContextTokens = 0;
  let latestInputTokens = 0;
  let latestCacheTokens = 0;
  let totalOutputTokens = 0;
  let compactionCount = 0;
  let lastCompactedFrom = 0;
  let lastCompactedTo = 0;
  let bytesSinceLastPlanner = 0;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === 'PLANNER_RESPONSE') {
      const inp = Number(s.input_tokens || 0);
      const cache = Number(s.cache_read_tokens || 0);
      const outTok = Number(s.output_tokens || 0);
      totalOutputTokens += outTok;
      const inTok = inp + cache;
      if (inTok > 0) {
        if (latestContextTokens >= 80000 && inTok < latestContextTokens * 0.55) {
          compactionCount += 1;
          lastCompactedFrom = latestContextTokens;
          lastCompactedTo = inTok;
        }
        latestContextTokens = inTok;
        latestInputTokens = inp;
        latestCacheTokens = cache;
      }
      bytesSinceLastPlanner = 0;
    } else if (s.type === 'GENERIC' && s.content) {
      bytesSinceLastPlanner += s.content.length;
    }

    if (s.type === 'PLANNER_RESPONSE' && Array.isArray(s.tool_calls) && s.tool_calls.length > 0) {
      for (let k = 0; k < s.tool_calls.length; k++) {
        const tc = s.tool_calls[k];
        const name = tc.name || 'tool';
        if (name === 'manage_task' || name === 'ask_question') continue;
        const args = tc.args || {};
        const rawSummary = unquote(args.toolSummary || args.Role || '');
        const command = unquote(args.CommandLine || args.Path || args.Prompt || '');
        let title = '';
        let badge = '';
        let groupKey = null;

        if (name === 'read_file') {
          const base = path.basename(command || '文件');
          groupKey = `file:${base}`;
          const sl = unquote(String(args.StartLine || ''));
          const el = unquote(String(args.EndLine || ''));
          badge = sl && el ? `L${sl}–${el}` : sl ? `L${sl}+` : '';
          title = `读取 ${base}`;
        } else if (name === 'edit_file') {
          const base = path.basename(command || '文件');
          groupKey = `file:${base}`;
          title = `修改 ${base}`;
        } else if (name === 'write_file') {
          const base = path.basename(command || '文件');
          groupKey = `file:${base}`;
          title = `写入 ${base}`;
        } else if (rawSummary) {
          title = localizeToolTitle(rawSummary, name, command);
        } else if (name === 'run_command') {
          title = command.slice(0, 38) || '执行终端命令';
        } else if (name === 'invoke_subagent') {
          title = `子代理: ${unquote(args.Role || args.TypeName || '')}`;
        } else {
          title = name;
        }

        const nextStep = steps[i + 1 + k];
        let status = 'running';
        let bgTaskId = null;
        let logFile = null;
        let isDaemon = Boolean(args.IsDaemon === true || args.IsDaemon === 'true');
        let createdAtMs = s.created_at ? Date.parse(s.created_at) : Date.now();
        let completedAtMs = null;

        if (nextStep && nextStep.type === 'GENERIC') {
          const out = nextStep.content || '';
          const createdMatch = out.match(/Created At:\s*([^\r\n]+)/i);
          const completedMatch = out.match(/Completed At:\s*([^\r\n]+)/i);
          if (createdMatch) {
            const parsedStart = Date.parse(createdMatch[1].trim());
            if (!Number.isNaN(parsedStart)) createdAtMs = parsedStart;
          }
          const parsedEndMs = completedMatch ? Date.parse(completedMatch[1].trim()) : NaN;
          const fallbackEndMs = !Number.isNaN(parsedEndMs)
            ? parsedEndMs
            : nextStep.created_at
            ? Date.parse(nextStep.created_at)
            : createdAtMs + 1000;

          if (name === 'invoke_subagent') {
            const subIdMatch = out.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (subIdMatch) {
              spawnedSubagents[subIdMatch[1].toLowerCase()] = unquote(args.Role || args.TypeName || '子代理');
            }
          }
          const isBgCapableTool = name === 'run_command' || name === 'schedule';
          const headerSlice = out.slice(0, 420);
          const bgMatch = isBgCapableTool
            ? headerSlice.match(
                /^Tool is running as a background task with task id:\s*([a-zA-Z0-9_/-]+)/im
              )
            : null;
          const logMatch = isBgCapableTool ? headerSlice.match(/tasks\/(task-\d+\.log)/i) : null;
          if (logMatch) logFile = logMatch[1];

          if (bgMatch) {
            bgTaskId = bgMatch[1].trim();
            if (finishedBgTasks.has(bgTaskId)) {
              status = finishedBgTasks.get(bgTaskId);
              completedAtMs = fallbackEndMs;
            } else if (isDaemon && i + 1 + k < steps.length - 1) {
              status = 'done';
              badge = '后台常驻';
              completedAtMs = fallbackEndMs;
            } else {
              status = 'running';
            }
          } else if (
            nextStep.status === 'ERROR' ||
            nextStep.status === 'FAILED' ||
            /^Encountered error in tool execution:/m.test(headerSlice)
          ) {
            status = 'error';
            if (!badge) badge = '执行失败';
            completedAtMs = fallbackEndMs;
          } else if (nextStep.status === 'CANCELED' || nextStep.status === 'CANCELLED') {
            status = 'stopped';
            completedAtMs = fallbackEndMs;
          } else if (nextStep.status === 'DONE') {
            const exitMatch =
              name === 'run_command'
                ? headerSlice.match(/^Command exited with code (\d+)\./m)
                : null;
            if (exitMatch && exitMatch[1] !== '0') {
              status = 'error';
              badge = `Exit ${exitMatch[1]}`;
            } else {
              status = 'done';
            }
            completedAtMs = fallbackEndMs;
          } else if (nextStep.status === 'RUNNING') {
            const hasLaterPlanner = steps
              .slice(i + 1 + k + 1)
              .some(st => st.type === 'PLANNER_RESPONSE');
            if (hasLaterPlanner) {
              status = 'done';
              completedAtMs = fallbackEndMs;
            } else {
              status = 'running';
            }
          } else {
            status = 'done';
            completedAtMs = fallbackEndMs;
          }
        } else if (i + 1 + k < steps.length) {
          status = 'done';
          completedAtMs = steps[i + 1 + k]?.created_at ? Date.parse(steps[i + 1 + k].created_at) : createdAtMs + 1000;
        }

        const endMs = completedAtMs || Date.now();
        const durationSec = Math.max(1, Math.round((endMs - createdAtMs) / 1000));
        const previewMeta = classifyToolPreview(name, args, command || title, badge);

        rawStages.push({
          stepIndex: s.step_index,
          turnIsCurrent: i > lastUserStepIdx,
          name,
          groupKey,
          title,
          badge,
          command: command || title,
          toolType: previewMeta.toolType,
          previewPrefix: previewMeta.previewPrefix,
          previewTarget: previewMeta.previewTarget,
          status,
          bgTaskId,
          logFile,
          durationSec,
          createdAtMs,
          endMs
        });
      }
    }
  }

  let turnStages = rawStages.filter(st => st.turnIsCurrent);
  if (turnStages.length === 0) {
    turnStages = rawStages.slice(-8);
  }

  // Universal consecutive operation aggregation (read_file, edit_file, write_file on same file)
  const mergedStages = [];
  for (const st of turnStages) {
    const prev = mergedStages[mergedStages.length - 1];
    if (prev && prev.groupKey && prev.groupKey === st.groupKey) {
      prev.subSteps.push({
        name: st.name,
        title: st.title,
        badge: st.badge,
        durationSec: st.durationSec,
        status: st.status,
        command: st.command
      });

      if (st.createdAtMs < prev.lastEndMs) {
        prev.durationSec += Math.max(0, Math.round((st.endMs - prev.lastEndMs) / 1000));
      } else {
        prev.durationSec += st.durationSec;
      }
      prev.lastEndMs = Math.max(prev.lastEndMs, st.endMs);

      if (prev.subSteps.some(sub => sub.status === 'running')) {
        prev.status = 'running';
      } else {
        prev.status = prev.subSteps[prev.subSteps.length - 1].status;
      }

      const base = st.groupKey.replace(/^file:/, '');
      const readSubs = prev.subSteps.filter(s => s.name === 'read_file');
      const editSubs = prev.subSteps.filter(s => s.name === 'edit_file' || s.name === 'write_file');
      const okEditCount = editSubs.filter(s => s.status !== 'error').length || editSubs.length;

      if (editSubs.length > 0 && readSubs.length > 0) {
        prev.title = `修改 ${base}`;
        prev.toolType = 'edit';
        prev.previewPrefix = '📝 修改';
        prev.badge = `${okEditCount}次修改 · ${readSubs.length}段读取`;
      } else if (editSubs.length > 0) {
        prev.title = st.name === 'write_file' ? `写入 ${base}` : `修改 ${base}`;
        prev.toolType = st.toolType;
        prev.previewPrefix = st.previewPrefix;
        prev.badge = `${okEditCount}次修改`;
      } else {
        const firstRange = readSubs[0]?.badge || '';
        const lastRange = readSubs[readSubs.length - 1]?.badge || '';
        const spanText =
          firstRange && lastRange && firstRange !== lastRange
            ? `${firstRange.split('–')[0]}–${lastRange.replace(/^L/, '')}`
            : lastRange || firstRange;
        prev.badge = `${readSubs.length}段${spanText ? ' · ' + spanText : ''}`;
      }
    } else {
      mergedStages.push({
        ...st,
        lastEndMs: st.endMs,
        subSteps: [
          {
            name: st.name,
            title: st.title,
            badge: st.badge,
            durationSec: st.durationSec,
            status: st.status,
            command: st.command
          }
        ]
      });
    }
  }

  return {
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
  };
}

module.exports = {
  extractTranscriptData
};
