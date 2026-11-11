function isUuidDir(name) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

function unquote(str) {
  if (typeof str !== 'string') return '';
  let s = str.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function extractUserRequest(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return '';
  const m = rawContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  const text = (m ? m[1] : rawContent).trim();
  return text.replace(/\s+/g, ' ');
}

// Detect whether a user message is review commentary, screenshot feedback, or short follow-up
function isFeedbackOrChatter(rawText) {
  if (!rawText) return true;
  const s = rawText.replace(/^\/[a-zA-Z0-9_-]+\s*/g, '').trim();
  if (s.length <= 8) return true;
  const patterns = [
    /^(完成了么|完成了吗|好了吗|好了么|继续|还在跑吗|卡住了吗|重试|ok|yes|可以加一个)/i,
    /^(参考下面的修改|结合你这份|这张新截图|这一版进步|下面是我看到的|这个UI实现感觉|compacting\s*时\s*UI)/i,
    /^(你能优化一下你的|是X上有人发的贴子|感觉边框|启用推主|可以显示context|停止task)/i
  ];
  return patterns.some(re => re.test(s));
}

function cleanSingleObjective(rawPrompt) {
  if (!rawPrompt) return '';
  let s = rawPrompt
    .replace(/^\/[a-zA-Z0-9_-]+\s*/g, '')
    .replace(/^参考下面的修改[：:]\s*/g, '')
    .replace(/^[0-9]+\.\s*/g, '')
    .replace(/^(?:我是想|请帮我|帮我|为我|你能|可以帮我|麻烦)\s*/g, '')
    .replace(/(?:吗|么|吧|呢)[？?！!。.]*$/g, '')
    .trim();

  const firstSentence = s.split(/(?:##|。|！|？|\n|；)/)[0].trim();
  if (firstSentence.length >= 4 && firstSentence.length <= 48) {
    return firstSentence;
  }
  const firstClause = firstSentence.split(/，/)[0].trim();
  if (firstClause.length >= 10 && firstClause.length <= 48) {
    return firstClause;
  }
  return (firstSentence || s).slice(0, 45);
}

// Smart task title derivation:
// 1. Filter out review/feedback commentary ("这张新截图是...", "参考下面的修改...") and extract the core task goal (<= 45 chars).
// 2. Fall back to synthesizing from the key deliverable stages when prompts are pure review notes.
function deriveSmartTaskTitle(convId, allUserPrompts, stages) {
  // Find best objective prompt (prefer non-feedback task definitions)
  const objectivePrompts = allUserPrompts.filter(p => !isFeedbackOrChatter(p));
  if (objectivePrompts.length > 0) {
    const candidate = cleanSingleObjective(objectivePrompts[objectivePrompts.length - 1]);
    if (candidate && candidate.length >= 4) {
      return candidate;
    }
  }
  // If latest prompt was a review/calibration prompt ("参考下面的修改..."), synthesize from stages or core topic
  const latestRaw = allUserPrompts[allUserPrompts.length - 1] || '';
  if (/参考下面的修改|这张新截图|这一版进步|结合你这份|状态机|系统托盘/i.test(latestRaw)) {
    return '桌面进度监控浮窗 UI 校准';
  }
  if (stages && stages.length > 0) {
    const lastKeyStage = [...stages].reverse().find(st => st.status !== 'pending');
    if (lastKeyStage && lastKeyStage.title) {
      return lastKeyStage.title.slice(0, 45);
    }
  }
  return cleanSingleObjective(latestRaw) || `会话 ${(convId || '').slice(0, 8)}`;
}

function isShortFollowup(text) {
  if (!text) return true;
  const cleaned = text.replace(/^\/[a-zA-Z0-9_-]+\s*/g, '').trim();
  if (cleaned.length <= 8) return true;
  const followups = /^(完成了么|完成了吗|好了吗|好了么|继续|还在跑吗|卡住了吗|重试|ok|yes|1|2|3|可以加一个)/i;
  return followups.test(cleaned) && cleaned.length <= 20;
}

// Classify tool type for preview bar prefix ($ vs 📝 vs 📄 vs 🔍 vs 🧠)
function classifyToolPreview(name, args, command, badge) {
  if (name === 'write_file') {
    return { toolType: 'write', previewPrefix: '📝 写入', previewTarget: command };
  }
  if (name === 'edit_file') {
    return { toolType: 'edit', previewPrefix: '📝 修改', previewTarget: command };
  }
  if (name === 'read_file' || name === 'view_file_outline' || name === 'view_code_item') {
    const suffix = badge ? ` (${badge})` : '';
    return { toolType: 'read', previewPrefix: '📄 读取', previewTarget: `${command}${suffix}` };
  }
  if (name === 'grep_search' || name === 'find_by_name' || name === 'search_web') {
    const q = unquote(String(args?.Query || args?.Pattern || args?.query || command || ''));
    const dir = unquote(String(args?.SearchPath || args?.SearchDirectory || ''));
    return {
      toolType: 'search',
      previewPrefix: '🔍 检索',
      previewTarget: dir ? `"${q}" in ${dir}` : q
    };
  }
  if (name === 'run_command') {
    const cleanedCmd = String(command || '')
      .replace(/^Remove-Item\s+Env:\\ELECTRON_RUN_AS_NODE[^;]*;\s*/i, '')
      .trim();
    return { toolType: 'shell', previewPrefix: '$', previewTarget: cleanedCmd || command };
  }
  return { toolType: 'other', previewPrefix: '▸', previewTarget: command };
}

// Translate common English toolSummary strings to clean Chinese
function localizeToolTitle(title, toolName, targetPath) {
  if (!title) return '执行步骤';
  let t = title.trim();
  const rules = [
    [/^Check\s+(.+?)\s+syntax$/i, '检查 $1 语法'],
    [/^Check\s+if\s+(.+?)\s+exists$/i, '检查 $1 是否存在'],
    [/^Check\s+(.+)$/i, '检查 $1'],
    [/^Launch\s+floating\s+monitor.*$/i, '启动桌面悬浮监控窗'],
    [/^Start\s+floating\s+monitor.*$/i, '启动桌面悬浮监控窗'],
    [/^Keep\s+floating\s+monitor.*$/i, '保持悬浮监控窗后台驻留'],
    [/^Run\s+floating\s+monitor.*$/i, '运行桌面悬浮监控窗'],
    [/^Restart\s+monitor.*$/i, '重启悬浮监控并校验状态'],
    [/^Start\s+monitor.*$/i, '启动监控并校验接口'],
    [/^Set\s+monitor\s+mode.*$/i, '切换监控会话追踪模式'],
    [/^Stop\s+existing\s+electron\s+process$/i, '停止旧版 Electron 进程'],
    [/^Stop\s+(.+)$/i, '停止 $1'],
    [/^List\s+workspace\s+files$/i, '列出工作区文件'],
    [/^List\s+(.+)$/i, '列出 $1'],
    [/^Search\s+(.+)$/i, '搜索 $1'],
    [/^Find\s+(.+)$/i, '查找 $1'],
    [/^Grep\s*(.+)$/i, '检索 $1'],
    [/^Inspect\s+(.+)$/i, '检查 $1'],
    [/^Verify\s+(.+)$/i, '校验 $1'],
    [/^Syntax\s+and\s+file\s+size\s+verification$/i, '语法与文件体积校验'],
    [/^Git\s+status.*$/i, '检查 Git 工作区状态'],
    [/^Stage\s+and\s+commit.*$/i, '暂存并提交 Git 代码'],
    [/^Amend\s+commit.*$/i, '修正 Git 提交记录'],
    [/^Summarize\s+SVN\s+log.*$/i, '汇总 SVN 提交记录与日期范围'],
    [/^Summarize\s+Git\s+log.*$/i, '汇总 Git 仓库提交记录与日期'],
    [/^List\s+all\s+Git\s+repositories.*$/i, '列出全部 Git 仓库与时间跨度']
  ];
  for (const [regex, replacement] of rules) {
    if (regex.test(t)) {
      return t.replace(regex, replacement);
    }
  }
  return t;
}

function parseLogProgress(logText) {
  if (!logText) return null;
  const matches = [...logText.matchAll(/(\d{1,3})(?:\.\d+)?%/g)];
  if (matches.length > 0) {
    const val = parseInt(matches[matches.length - 1][1], 10);
    if (val >= 0 && val <= 100) return val;
  }
  return null;
}

module.exports = {
  isUuidDir,
  unquote,
  extractUserRequest,
  isFeedbackOrChatter,
  cleanSingleObjective,
  deriveSmartTaskTitle,
  isShortFollowup,
  classifyToolPreview,
  localizeToolTitle,
  parseLogProgress
};
