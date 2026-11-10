let isCollapsed = false;
let isLogOpen = false;
let currentConvChoice = 'auto';
let watchdogThreshold = 60;
let lastAutoWakeupAt = 0;
let latestSnap = null;
let lastStageCount = 0;
let pinnedStageIndex = null;
let currentPreviewRawText = '';
let stopConfirmTimer = null;
let awaitingStopConfirm = false;
let expandedSubstepIndices = new Set();
let lastFallbackPrompt = '';
let isEditingTitle = false;

const EXPANDED_WIN_HEIGHT = 400;
const COLLAPSED_WIN_HEIGHT = 74;
let lastSentWinHeight = 0;
let lastRenderedConvId = '';
let lastRenderedLogTail = null;

// 主题色预设（与设计图 TH 严格对齐）
const THEMES = {
  running:    { accent: '#38BDF8', dim: '#0EA5E9', label: '进行中' },
  compacting: { accent: '#A78BFA', dim: '#7C5CF0', label: '压缩中' },
  stalled:    { accent: '#FBBF24', dim: '#F59E0B', label: '疑似卡顿' },
  stopped:    { accent: '#FB7185', dim: '#E11D48', label: '已停止' },
  done:       { accent: '#34D399', dim: '#10B981', label: '已完成' }
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mixWithDark(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const br = 16, bg = 20, bb = 26; // #10141A
  const nr = Math.round(br + (r - br) * factor);
  const ng = Math.round(bg + (g - bg) * factor);
  const nb = Math.round(bb + (b - bb) * factor);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

// DOM 节点引用
const shellEl = document.getElementById('widgetShell');
const expandedContainer = document.getElementById('expandedContainer');
const collapsedContainer = document.getElementById('collapsedContainer');

const ringWrap = document.getElementById('ringWrap');
const ringTrack = document.getElementById('ringTrack');
const ringSweep = document.getElementById('ringSweep');
const ringPctVal = document.getElementById('ringPctVal');

const miniRingWrap = document.getElementById('miniRingWrap');
const miniRingTrack = document.getElementById('miniRingTrack');
const miniRingPctVal = document.getElementById('miniRingPctVal');

const mainTitle = document.getElementById('mainTitle');
const miniMainTitle = document.getElementById('miniMainTitle');
const titleEditInput = document.getElementById('titleEditInput');
const followupTag = document.getElementById('followupTag');

const statusBadge = document.getElementById('statusBadge');
const statusLabel = document.getElementById('statusLabel');
const subtitleText = document.getElementById('subtitleText');
const miniStatusBadge = document.getElementById('miniStatusBadge');
const miniStatusLabel = document.getElementById('miniStatusLabel');
const miniSubtitleText = document.getElementById('miniSubtitleText');

const ctxPill = document.getElementById('ctxPill');
const ctxPie = document.getElementById('ctxPie');
const ctxPctText = document.getElementById('ctxPctText');
const miniCtxPill = document.getElementById('miniCtxPill');
const miniCtxPie = document.getElementById('miniCtxPie');
const miniCtxPctText = document.getElementById('miniCtxPctText');

const collapseBtn = document.getElementById('collapseBtn');
const miniExpandBtn = document.getElementById('miniExpandBtn');
const hideToTrayBtn = document.getElementById('hideToTrayBtn');
const miniHideToTrayBtn = document.getElementById('miniHideToTrayBtn');
const stopTaskBtn = document.getElementById('stopTaskBtn');
const miniStopBtn = document.getElementById('miniStopBtn');

const linearTrack = document.getElementById('linearTrack');
const linearFill = document.getElementById('linearFill');

const stageSummaryCount = document.getElementById('stageSummaryCount');
const convTrigger = document.getElementById('convTrigger');
const convTriggerLabel = document.getElementById('convTriggerLabel');
const convMenu = document.getElementById('convMenu');
const convMenuList = document.getElementById('convMenuList');

const logPillBtn = document.getElementById('logPillBtn');
const logSourceName = document.getElementById('logSourceName');
const logDrawerArrow = document.getElementById('logDrawerArrow');

const stageList = document.getElementById('stageList');
const scrollTopHint = document.getElementById('scrollTopHint');
const scrollTopHintText = document.getElementById('scrollTopHintText');

const logDrawer = document.getElementById('logDrawer');
const logHeaderTitle = document.getElementById('logHeaderTitle');
const logTerminal = document.getElementById('logTerminal');
const openNotepadBtn = document.getElementById('openNotepadBtn');
const copyLogBtn = document.getElementById('copyLogBtn');
const closeLogBtn = document.getElementById('closeLogBtn');

const cmdPreviewBar = document.getElementById('cmdPreviewBar');
const cmdPreviewTag = document.getElementById('cmdPreviewTag');
const cmdPreviewPrefix = document.getElementById('cmdPreviewPrefix');
const cmdPreviewText = document.getElementById('cmdPreviewText');
const backToActiveBtn = document.getElementById('backToActiveBtn');
const copyCmdBtn = document.getElementById('copyCmdBtn');
const copyCmdLabel = document.getElementById('copyCmdLabel');

const silenceBarTrack = document.getElementById('silenceBarTrack');
const silenceBarFill = document.getElementById('silenceBarFill');

const watchdogBar = document.getElementById('watchdogBar');
const silenceSecNow = document.getElementById('silenceSecNow');
const silenceSecMax = document.getElementById('silenceSecMax');
const thresholdSegment = document.getElementById('thresholdSegment');
const watchdogNote = document.getElementById('watchdogNote');
const wakeupNowBtn = document.getElementById('wakeupNowBtn');
const wakeBoltIcon = document.getElementById('wakeBoltIcon');
const wakeLockIcon = document.getElementById('wakeLockIcon');
const wakeBtnLabel = document.getElementById('wakeBtnLabel');

const doneSummaryBar = document.getElementById('doneSummaryBar');
const doneAgoText = document.getElementById('doneAgoText');
const doneTotalText = document.getElementById('doneTotalText');
const doneSplitText = document.getElementById('doneSplitText');
const copySummaryBtn = document.getElementById('copySummaryBtn');

const toastBanner = document.getElementById('toastBanner');
const toastText = document.getElementById('toastText');
const toastCopyBtn = document.getElementById('toastCopyBtn');

function showToast(msg, isWarn = false, copyText = '') {
  toastText.textContent = msg;
  toastBanner.style.borderColor = isWarn ? 'rgba(244, 63, 94, 0.5)' : 'rgba(56, 189, 248, 0.4)';
  if (copyText) {
    lastFallbackPrompt = copyText;
    toastCopyBtn.style.display = 'inline-block';
  } else {
    toastCopyBtn.style.display = 'none';
  }
  toastBanner.classList.add('show');
  setTimeout(() => toastBanner.classList.remove('show'), 4200);
}

function updateScrollTopHint() {
  const scrollTop = stageList.scrollTop;
  if (scrollTop <= 14) {
    scrollTopHint.classList.remove('visible');
    return;
  }
  const rows = [...stageList.querySelectorAll('.stage-row')];
  let hiddenCount = 0;
  for (const r of rows) {
    if (r.offsetTop + r.offsetHeight * 0.45 <= scrollTop) {
      hiddenCount++;
    } else {
      break;
    }
  }
  if (hiddenCount > 0) {
    scrollTopHintText.textContent = `上方还有 ${hiddenCount} 项已完成步骤（点击查看）`;
    scrollTopHint.classList.add('visible');
  } else {
    scrollTopHint.classList.remove('visible');
  }
}

function formatDuration(sec, status) {
  if (status === 'pending') return '待执行';
  if (!sec || sec <= 0) return '1s';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function formatRelativeFinished(completedAtMs) {
  if (!completedAtMs) return '刚刚完成';
  const diffSec = Math.max(0, Math.floor((Date.now() - completedAtMs) / 1000));
  if (diffSec < 15) return '刚刚完成';
  if (diffSec < 60) return `${diffSec} 秒前完成`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} 分钟前完成`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} 小时前完成`;
}

function middleEllipsisPath(text, maxLen = 42) {
  if (!text || text.length <= maxLen) return text || '';
  const hasSlash = text.includes('\\') || text.includes('/');
  if (hasSlash && !text.trim().includes(' ')) {
    const sep = text.includes('\\') ? '\\' : '/';
    const parts = text.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 3) {
      const head = parts.slice(0, 2).join(sep);
      const tail = parts.slice(-2).join(sep);
      const joined = `${head}${sep}…${sep}${tail}`;
      if (joined.length <= maxLen + 6) return joined;
    }
  }
  const keepHead = Math.ceil((maxLen - 3) * 0.45);
  const keepTail = Math.floor((maxLen - 3) * 0.55);
  return `${text.slice(0, keepHead)}…${text.slice(text.length - keepTail)}`;
}
