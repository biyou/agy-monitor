function applyTheme(themeKey) {
  const th = THEMES[themeKey] || THEMES.running;
  const root = document.documentElement;
  root.style.setProperty('--accent', th.accent);
  root.style.setProperty('--accent-dim', th.dim);
  root.style.setProperty('--glow', hexToRgba(th.accent, 0.16));
  root.style.setProperty('--glow-strong', hexToRgba(th.accent, 0.5));
  root.style.setProperty('--edge', hexToRgba(th.accent, 0.24));
  root.style.setProperty('--chip-bg', hexToRgba(th.accent, 0.14));
  root.style.setProperty('--pill-ring', hexToRgba(th.accent, 0.3));
}

function updateContextPill(snap) {
  const ctx = snap.context || {};
  const curTok = ctx.currentTokens ?? snap.estimatedContextTokens ?? 0;
  const maxTok = ctx.maxTokens || 256000;
  const usagePct = ctx.usagePct ?? Math.min(100, Math.round((curTok / maxTok) * 100));
  const curK = (curTok / 1000).toFixed(curTok >= 100000 ? 0 : 1).replace(/\.0$/, '');
  const maxK = Math.round(maxTok / 1000);

  ctxPctText.textContent = `${usagePct}%`;
  miniCtxPctText.textContent = `${usagePct}%`;

  let ctxColor = '#38BDF8';
  if (usagePct >= 86 || snap.isCompacting) {
    ctxColor = '#A78BFA';
  } else if (usagePct >= 65) {
    ctxColor = '#FBBF24';
  }

  const deg = usagePct * 3.6;
  ctxPie.style.background = `conic-gradient(${ctxColor} ${deg}deg, rgba(255,255,255,.12) 0deg)`;
  miniCtxPie.style.background = `conic-gradient(${ctxColor} ${deg}deg, rgba(255,255,255,.12) 0deg)`;
  ctxPctText.style.color = ctxColor;
  miniCtxPctText.style.color = ctxColor;

  const cacheK = ((ctx.cacheTokens || 0) / 1000).toFixed(1).replace(/\.0$/, '');
  const inK = ((ctx.inputTokens || 0) / 1000).toFixed(1).replace(/\.0$/, '');
  const outK = ((ctx.totalOutputTokens || 0) / 1000).toFixed(1).replace(/\.0$/, '');
  const statusHint = usagePct >= 86 ? '临近阈值' : usagePct >= 65 ? '较高' : '充裕';

  const tipLines = [
    `【上下文窗口】${curK}k / ${maxK}k (${curTok.toLocaleString()} / ${maxTok.toLocaleString()} tokens · ${usagePct}% · ${statusHint})`,
    `【Token 构成】缓存命中 ${cacheK}k (${ctx.cacheHitPct || 0}%) · 新增输入 ${inK}k · 累计输出 ${outK}k`
  ];
  if (ctx.compactionCount > 0) {
    const fromK = Math.round((ctx.lastCompactedFrom || 0) / 1000);
    const toK = Math.round((ctx.lastCompactedTo || 0) / 1000);
    tipLines.push(`【压缩记录】本会话已自动 Compact ${ctx.compactionCount} 次${fromK ? ` (${fromK}k → ${toK}k)` : ''}`);
  } else {
    tipLines.push(`【压缩记录】本会话尚未触发自动 Compact`);
  }
  const fullTip = tipLines.join('\n');
  ctxPill.title = fullTip;
  miniCtxPill.title = fullTip;
}

function updateCmdPreviewBar(snap) {
  cmdPreviewBar.style.display = 'flex';
  if (!snap || !snap.stages || snap.stages.length === 0) {
    cmdPreviewTag.textContent = '末步 #0';
    cmdPreviewPrefix.textContent = '$';
    cmdPreviewText.textContent = '正在等待任务步骤...';
    cmdPreviewText.title = '';
    backToActiveBtn.style.display = 'none';
    copyCmdBtn.style.display = 'none';
    currentPreviewRawText = '';
    return;
  }

  const isDoneState = !snap.isRunning && !snap.isCompacting && !snap.isStopped;
  let targetStage = null;
  let isPinned = false;
  if (pinnedStageIndex !== null) {
    targetStage = snap.stages.find(s => s.index === pinnedStageIndex);
    if (targetStage) isPinned = true;
    else pinnedStageIndex = null;
  }

  if (!targetStage) {
    targetStage = snap.stages.find(s => s.index === snap.activeStageIndex) || snap.stages[snap.stages.length - 1];
  }

  const prefix = targetStage.previewPrefix || (targetStage.toolType === 'bash' ? '$' : '状态');
  const rawTarget = targetStage.previewTarget || targetStage.command || targetStage.title || '';
  currentPreviewRawText = rawTarget;

  const displayTarget =
    targetStage.toolType === 'write' || targetStage.toolType === 'edit' || targetStage.toolType === 'read'
      ? middleEllipsisPath(rawTarget, 40)
      : rawTarget;

  if (isPinned) {
    cmdPreviewTag.textContent = `已选 #${targetStage.index}`;
    backToActiveBtn.textContent = isDoneState ? '✕ 取消' : '↩ 回到当前';
    backToActiveBtn.style.display = 'inline-flex';
  } else {
    cmdPreviewTag.textContent = snap.isRunning ? `当前 #${targetStage.index}` : `末步 #${targetStage.index}`;
    backToActiveBtn.style.display = 'none';
  }

  cmdPreviewPrefix.textContent = prefix;
  cmdPreviewText.textContent = displayTarget;
  cmdPreviewText.title = `${targetStage.title}\n${rawTarget}`;
  copyCmdBtn.style.display = rawTarget ? 'inline-flex' : 'none';
}

function buildConvMenu(conversations) {
  convMenuList.innerHTML = '';
  const baseItems = [{ id: 'auto', label: '自动追踪活跃会话（当前）', tag: '自动', time: '' }];
  const allItems = [...baseItems, ...(conversations || []).map(c => {
    let tag = '已就绪';
    if (c.isRunning) tag = '运行中';
    else if (c.isCompacting) tag = '压缩中';
    else if (c.isStopped) tag = '已停止';
    return { id: c.id, label: c.title || c.label || c.id.slice(0, 8), tag, time: c.time || '' };
  })];

  const TAG_COLORS = {
    '自动': ['rgba(255,255,255,.08)', '#B6C0CE'],
    '运行中': ['rgba(56,189,248,.15)', '#38BDF8'],
    '压缩中': ['rgba(167,139,250,.15)', '#A78BFA'],
    '已停止': ['rgba(251,113,133,.15)', '#FB7185'],
    '已就绪': ['rgba(255,255,255,.08)', '#B6C0CE']
  };

  allItems.forEach(item => {
    const row = document.createElement('div');
    const isAct = currentConvChoice === item.id;
    row.className = `session-item ${isAct ? 'active' : ''}`;
    const [tBg, tColor] = TAG_COLORS[item.tag] || TAG_COLORS['已就绪'];
    row.innerHTML = `
      <span class="session-tag" style="background:${tBg}; color:${tColor};">${item.tag}</span>
      <span class="session-title">${item.label}</span>
      <span class="session-time">${item.time}</span>
    `;
    row.addEventListener('click', () => {
      selectConversation(item.id, item.label);
      convMenu.style.display = 'none';
    });
    convMenuList.appendChild(row);
  });
}

function updateStopButtons(snap) {
  const canStop = snap.isRunning || snap.isCompacting;
  stopTaskBtn.disabled = !canStop;
  miniStopBtn.disabled = !canStop;
  if (!canStop && awaitingStopConfirm) {
    resetStopConfirmation();
  }
}

function renderFooterState(snap, isDoneState) {
  if (isDoneState) {
    watchdogBar.style.display = 'none';
    silenceBarTrack.style.display = 'none';
    doneSummaryBar.style.display = 'flex';

    doneAgoText.textContent = formatRelativeFinished(snap.completedAtMs);
    const totalDurStr = formatDuration(snap.elapsedSeconds, 'done');
    const stepsDurStr = formatDuration(snap.stepsDurationSec, 'done');
    const waitDurStr = formatDuration(snap.thinkWaitSec, 'done');
    doneTotalText.textContent = `· 总耗时 ${totalDurStr}`;
    doneSplitText.textContent = `步骤执行 ${stepsDurStr} · 思考等待 ${waitDurStr}`;
  } else {
    doneSummaryBar.style.display = 'none';
    watchdogBar.style.display = 'flex';
    silenceBarTrack.style.display = 'block';

    if (snap.isCompacting) {
      silenceSecNow.textContent = '0s';
      silenceSecMax.textContent = '/ 60s';
      thresholdSegment.style.display = 'none';
      watchdogNote.style.display = 'inline-block';
      watchdogNote.textContent = '上下文压缩期间已暂停超时重调（防打断保护中）';
      watchdogNote.style.color = '#A78BFA';
      silenceBarFill.style.width = '0%';

      wakeupNowBtn.disabled = true;
      wakeupNowBtn.title = '正在压缩上下文窗口，已锁定重调按钮以防打断';
      wakeBoltIcon.style.display = 'none';
      wakeLockIcon.style.display = 'inline-block';
      wakeBtnLabel.textContent = '防打断';
    } else if (snap.isStopped) {
      silenceSecNow.textContent = '0s';
      silenceSecMax.textContent = '';
      thresholdSegment.style.display = 'none';
      watchdogNote.style.display = 'inline-block';
      watchdogNote.textContent = '任务已手动停止 · 点击右侧可恢复执行';
      watchdogNote.style.color = '#FDA4AF';
      silenceBarFill.style.width = '0%';

      wakeupNowBtn.disabled = false;
      wakeupNowBtn.title = '向当前会话发送唤醒恢复指令';
      wakeBoltIcon.style.display = 'inline-block';
      wakeLockIcon.style.display = 'none';
      wakeBtnLabel.textContent = '立即重调';
    } else {
      thresholdSegment.style.display = 'flex';
      watchdogNote.style.display = 'none';
      silenceSecNow.textContent = `${snap.silenceSeconds || 0}s`;
      silenceSecMax.textContent = watchdogThreshold > 0 ? `/ ${watchdogThreshold}s` : '';

      wakeupNowBtn.disabled = false;
      wakeupNowBtn.title = '立即向当前会话发送唤醒重调指令';
      wakeBoltIcon.style.display = 'inline-block';
      wakeLockIcon.style.display = 'none';
      wakeBtnLabel.textContent = '立即重调';

      if (watchdogThreshold > 0) {
        const ratio = Math.min(100, Math.round((snap.silenceSeconds / watchdogThreshold) * 100));
        silenceBarFill.style.width = `${ratio}%`;
        silenceBarFill.style.backgroundColor = ratio >= 85 ? '#FB7185' : ratio >= 50 ? '#FBBF24' : '#38BDF8';
      } else {
        silenceBarFill.style.width = '0%';
      }

      if (watchdogThreshold > 0 && snap.silenceSeconds >= watchdogThreshold) {
        if (Date.now() - lastAutoWakeupAt > 15000) {
          lastAutoWakeupAt = Date.now();
          doWakeup(`日志连续 ${snap.silenceSeconds} 秒无输出`);
        }
      }
    }
  }
}
