let isCollapsed = false;
let isLogOpen = false;
let currentConvChoice = 'auto';
let watchdogThreshold = 120;
let lastAutoWakeupAt = 0;
const lastAutoWakeupByConv = new Map();
const dismissedParallelIds = new Set();
let visibleParallelTasks = [];
let latestSnap = null;
let lastStageCount = 0;
let pinnedStageIndex = null;
let currentPreviewRawText = '';
let stopConfirmTimer = null;
let awaitingStopConfirm = false;
let expandedSubstepIndices = new Set();
let lastFallbackPrompt = '';
let toastTimer = null;

let currentCtxTipHtml = '';
let currentTitleTipHtml = '';

const EXPANDED_WIN_HEIGHT = 400;
const COLLAPSED_WIN_HEIGHT = 74;
let lastSentWinHeight = 0;
let resizeDelayTimer = null;
let lastRenderedConvId = '';
let lastRenderedLogTail = null;

// DOM References
const hudWin = document.getElementById('hudWin');
const hudBody = document.querySelector('.hud-body');
const ringFill = document.getElementById('ringFill');
const ringLabel = document.getElementById('ringLabel');
const linearBar = document.getElementById('linearBar');

const titleText = document.getElementById('titleText');
const titleInfoBtn = document.getElementById('titleInfoBtn');
const ghostBadge = document.getElementById('ghostBadge');
const followupPill = document.getElementById('followupPill');

const statusCapsule = document.getElementById('statusCapsule');
const statusText = document.getElementById('statusText');
const convDropdownBtn = document.getElementById('convDropdownBtn');
const convBtnText = document.getElementById('convBtnText');
const multiTaskBar = document.getElementById('multiTaskBar');

const ctxPiePill = document.getElementById('ctxPiePill');
const ctxSectorPath = document.getElementById('ctxSectorPath');
const ctxPctLabel = document.getElementById('ctxPctLabel');

const stopBtn = document.getElementById('stopBtn');
const stopBtnLabel = document.getElementById('stopBtnLabel');
const collapseBtn = document.getElementById('collapseBtn');
const hideBtn = document.getElementById('hideBtn');

const tooltipOverlay = document.getElementById('tooltipOverlay');
const convMenu = document.getElementById('convMenu');
const convMenuList = document.getElementById('convMenuList');

const scrollTopHint = document.getElementById('scrollTopHint');
const scrollTopHintText = document.getElementById('scrollTopHintText');
const stageList = document.getElementById('stageList');

const logDrawer = document.getElementById('logDrawer');
const logHeaderLabel = document.getElementById('logHeaderLabel');
const copyLogBtn = document.getElementById('copyLogBtn');
const notepadBtn = document.getElementById('notepadBtn');
const closeLogBtn = document.getElementById('closeLogBtn');
const logContent = document.getElementById('logContent');

const cmdPreviewBar = document.getElementById('cmdPreviewBar');
const previewPrefix = document.getElementById('previewPrefix');
const previewText = document.getElementById('previewText');
const unpinBtn = document.getElementById('unpinBtn');
const copyPreviewBtn = document.getElementById('copyPreviewBtn');
const logBtn = document.getElementById('logBtn');

const watchdogRow = document.getElementById('watchdogRow');
const silenceLabel = document.getElementById('silenceLabel');
const thresholdSel = document.getElementById('thresholdSel');
const watchdogNote = document.getElementById('watchdogNote');
const wakeupBtn = document.getElementById('wakeupBtn');

const doneRow = document.getElementById('doneRow');
const doneAgoText = document.getElementById('doneAgoText');
const doneSplitText = document.getElementById('doneSplitText');
const copySummaryBtn = document.getElementById('copySummaryBtn');

const silenceBarTrack = document.getElementById('silenceBarTrack');
const silenceFill = document.getElementById('silenceFill');

const toastBox = document.getElementById('toastBox');
const toastText = document.getElementById('toastText');
const toastCopyBtn = document.getElementById('toastCopyBtn');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPieSectorPath(cx, cy, r, pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  if (clamped <= 0) return '';
  if (clamped >= 99.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const angleRad = ((clamped / 100) * 360 - 90) * (Math.PI / 180);
  const x = (cx + r * Math.cos(angleRad)).toFixed(2);
  const y = (cy + r * Math.sin(angleRad)).toFixed(2);
  const largeArc = clamped > 50 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${(cy - r).toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x} ${y} Z`;
}

function showToast(msg, isWarn = false, copyText = '') {
  toastText.textContent = msg;
  toastBox.style.borderColor = isWarn ? 'rgba(251, 113, 133, 0.5)' : 'rgba(56, 189, 248, 0.45)';
  if (copyText) {
    lastFallbackPrompt = copyText;
    toastCopyBtn.style.display = 'inline-block';
  } else {
    toastCopyBtn.style.display = 'none';
  }
  toastBox.style.display = 'flex';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastBox.style.display = 'none';
  }, 3200);
}

function updateScrollTopHint() {
  const scrollTop = stageList.scrollTop;
  if (scrollTop <= 14) {
    scrollTopHint.classList.remove('visible');
    return;
  }
  const rows = [...stageList.querySelectorAll('.stage-card')];
  let hiddenCount = 0;
  for (const r of rows) {
    if (r.offsetTop + r.offsetHeight * 0.45 <= scrollTop) {
      hiddenCount++;
    } else {
      break;
    }
  }
  if (hiddenCount > 0) {
    scrollTopHintText.textContent = `↑ 上方还有 ${hiddenCount} 项已完成步骤（点击查看）`;
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
  if (!completedAtMs) return '✓ 刚刚完成';
  const diffSec = Math.max(0, Math.floor((Date.now() - completedAtMs) / 1000));
  if (diffSec < 15) return '✓ 刚刚完成';
  if (diffSec < 60) return `✓ ${diffSec} 秒前完成`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `✓ ${mins} 分钟前完成`;
  const hrs = Math.floor(mins / 60);
  return `✓ ${hrs} 小时前完成`;
}

function middleEllipsisPath(text, maxLen = 44) {
  if (!text || text.length <= maxLen) return text || '';
  const hasSlash = text.includes('\\') || text.includes('/');
  if (hasSlash && !text.trim().includes(' ')) {
    const sep = text.includes('\\') ? '\\' : '/';
    const parts = text.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 3) {
      const head = parts.slice(0, 2).join(sep);
      const tail = parts.slice(-2).join(sep);
      const joined = `${head}${sep}...${sep}${tail}`;
      if (joined.length <= maxLen + 6) return joined;
    }
  }
  const keepHead = Math.ceil((maxLen - 3) * 0.45);
  const keepTail = Math.floor((maxLen - 3) * 0.55);
  return `${text.slice(0, keepHead)}...${text.slice(text.length - keepTail)}`;
}
