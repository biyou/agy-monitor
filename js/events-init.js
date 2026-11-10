// Toast copy fallback button
toastCopyBtn.addEventListener('click', () => {
  if (lastFallbackPrompt) {
    navigator.clipboard.writeText(lastFallbackPrompt);
    showToast('✓ 已复制唤醒指令至剪贴板');
  }
});

// Hover 3-line Tooltip Overlay (for Title & Context Pie Pill when expanded)
titleText.addEventListener('mouseenter', () => {
  if (isCollapsed || !currentTitleTipHtml) return;
  tooltipOverlay.innerHTML = currentTitleTipHtml;
  tooltipOverlay.style.display = 'flex';
});

titleText.addEventListener('mouseleave', () => {
  tooltipOverlay.style.display = 'none';
});

ctxPiePill.addEventListener('mouseenter', () => {
  if (isCollapsed || !currentCtxTipHtml) return;
  tooltipOverlay.innerHTML = currentCtxTipHtml;
  tooltipOverlay.style.display = 'flex';
});

ctxPiePill.addEventListener('mouseleave', () => {
  tooltipOverlay.style.display = 'none';
});

// Collapse / Expand 520x74 Mini-Capsule
collapseBtn.addEventListener('click', e => {
  e.stopPropagation();
  isCollapsed = !isCollapsed;
  hudWin.classList.toggle('is-collapsed', isCollapsed);
  if (isCollapsed) {
    tooltipOverlay.style.display = 'none';
    convMenu.style.display = 'none';
    convDropdownBtn.classList.remove('active');
  }
  syncWindowHeight();
  if (latestSnap) {
    updateContextPill(latestSnap);
    renderMultiTaskBar(latestSnap);
  }
});

// Minimize to System Tray
hideBtn.addEventListener('click', e => {
  e.stopPropagation();
  fetch('/api/hide-to-tray', { method: 'POST' }).catch(() => {});
});

// 2-Step Confirmation Stop Button
stopBtn.addEventListener('click', async e => {
  e.stopPropagation();
  if (!latestSnap || (!latestSnap.isRunning && !latestSnap.isCompacting)) return;
  if (!awaitingStopConfirm) {
    awaitingStopConfirm = true;
    stopBtn.classList.add('confirming');
    stopBtn.textContent = '确认停止?';
    stopConfirmTimer = setTimeout(resetStopConfirmation, 2600);
    return;
  }
  resetStopConfirmation();
  try {
    const res = await fetch('/api/stop-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: latestSnap.convId })
    });
    const data = await res.json();
    showToast(data.message || '■ 已下发停止指令', true);
    pollStatus();
  } catch (err) {
    showToast('停止任务失败: ' + err.message, true);
  }
});

// Scroll-to-Top Hint
stageList.addEventListener('scroll', updateScrollTopHint);
scrollTopHint.addEventListener('click', () => {
  stageList.scrollTo({ top: 0, behavior: 'smooth' });
});

// Session Selector Dropdown, 74px Collapsed Parallel Cycle & Keyboard Navigation
convDropdownBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (isCollapsed && visibleParallelTasks.length >= 2 && latestSnap) {
    const curIdx = visibleParallelTasks.findIndex(t => t.id === latestSnap.convId);
    const nextIdx = (curIdx + 1) % visibleParallelTasks.length;
    const nextTask = visibleParallelTasks[nextIdx];
    if (nextTask) {
      selectConversation(nextTask.id, nextTask.label || nextTask.title);
      showToast(`↻ 已切换并行任务 (${nextIdx + 1}/${visibleParallelTasks.length}): ${nextTask.title}`);
      return;
    }
  }
  if (isCollapsed) {
    isCollapsed = false;
    hudWin.classList.remove('is-collapsed');
    syncWindowHeight();
    if (latestSnap) renderMultiTaskBar(latestSnap);
  }
  const isOpen = convMenu.style.display !== 'none';
  convMenu.style.display = isOpen ? 'none' : 'flex';
  convDropdownBtn.classList.toggle('active', !isOpen);
});

convDropdownBtn.addEventListener('contextmenu', e => {
  e.preventDefault();
  e.stopPropagation();
  if (isCollapsed) {
    isCollapsed = false;
    hudWin.classList.remove('is-collapsed');
    syncWindowHeight();
    if (latestSnap) renderMultiTaskBar(latestSnap);
  }
  convMenu.style.display = 'flex';
  convDropdownBtn.classList.add('active');
});

document.addEventListener('click', () => {
  convMenu.style.display = 'none';
  convDropdownBtn.classList.remove('active');
});

document.addEventListener('keydown', e => {
  if (convMenu.style.display !== 'none') {
    const items = [...convMenuList.querySelectorAll('.conv-item')];
    if (!items.length) return;
    let idx = items.findIndex(el => el.classList.contains('focused') || el.classList.contains('active'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = (idx + 1) % items.length;
      items.forEach(el => el.classList.remove('focused'));
      items[idx].classList.add('focused');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = (idx - 1 + items.length) % items.length;
      items.forEach(el => el.classList.remove('focused'));
      items[idx].classList.add('focused');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0) items[idx].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      convMenu.style.display = 'none';
      convDropdownBtn.classList.remove('active');
    }
  }
});

// Real-Time Log Stream Drawer
logBtn.addEventListener('click', () => {
  isLogOpen = !isLogOpen;
  logDrawer.classList.toggle('is-open', isLogOpen);
  logBtn.classList.toggle('active', isLogOpen);
});

closeLogBtn.addEventListener('click', () => {
  isLogOpen = false;
  logDrawer.classList.remove('is-open');
  logBtn.classList.remove('active');
});

notepadBtn.addEventListener('click', () => {
  fetch('/api/open-log', { method: 'POST' }).catch(() => {});
});

copyLogBtn.addEventListener('click', () => {
  if (latestSnap && latestSnap.logTail) {
    navigator.clipboard.writeText(latestSnap.logTail);
    showToast('✓ 已将最新日志复制到剪贴板');
  }
});

// Preview Bar Actions
unpinBtn.addEventListener('click', () => {
  pinnedStageIndex = null;
  if (latestSnap) renderSnapshot(latestSnap, { preserveScroll: true });
});

copyPreviewBtn.addEventListener('click', () => {
  if (currentPreviewRawText) {
    navigator.clipboard.writeText(currentPreviewRawText);
    copyPreviewBtn.textContent = '已复制 ✓';
    setTimeout(() => {
      copyPreviewBtn.textContent = '复制';
    }, 1400);
  }
});

// Watchdog Threshold Select & Wakeup
thresholdSel.addEventListener('change', e => {
  watchdogThreshold = parseInt(e.target.value, 10);
  pollStatus();
});

wakeupBtn.addEventListener('click', () => {
  if (latestSnap && latestSnap.isCompacting) return;
  doWakeup('手动点击立即重调');
});

// Copy Turn-Done Summary
copySummaryBtn.addEventListener('click', () => {
  if (!latestSnap) return;
  const ctx = latestSnap.context || {};
  const curK = Math.round((ctx.currentTokens || latestSnap.estimatedContextTokens || 0) / 1000);
  const lines = [
    `【任务名称】${latestSnap.title}`,
    `【完成状态】已完成 (${latestSnap.completedStages}/${latestSnap.totalStages} 阶段)`,
    `【耗时统计】总耗时 ${formatDuration(latestSnap.elapsedSeconds, 'done')} (步骤执行 ${formatDuration(latestSnap.stepsDurationSec, 'done')} · 思考等待 ${formatDuration(latestSnap.thinkWaitSec, 'done')})`,
    `【上下文窗】~${curK}k / 256k (${ctx.usagePct || 0}%)${ctx.compactionCount ? ' · 已压缩 ' + ctx.compactionCount + ' 次' : ''}`,
    `【阶段明细】`,
    ...(latestSnap.stages || []).map(
      s => `  ${s.index}. [${s.status === 'done' ? '✓' : s.status}] ${s.title}${s.badge ? ' (' + s.badge + ')' : ''} - ${formatDuration(s.durationSec, s.status)}`
    )
  ];
  navigator.clipboard.writeText(lines.join('\n'));
  showToast('✓ 已复制结构化回合摘要至剪贴板');
});

// Start Polling
pollStatus();
setInterval(pollStatus, 1000);
