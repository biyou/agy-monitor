toastCopyBtn.addEventListener('click', () => {
  if (lastFallbackPrompt) {
    navigator.clipboard.writeText(lastFallbackPrompt);
    showToast('已复制指令到剪贴板');
  }
});

// 标题重命名
function finishTitleEdit(save = true) {
  if (!isEditingTitle) return;
  isEditingTitle = false;
  const newTitle = titleEditInput.value.trim();
  titleEditInput.style.display = 'none';
  mainTitle.style.display = '';
  if (save && latestSnap && latestSnap.convId) {
    fetch('/api/rename-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ convId: latestSnap.convId, title: newTitle })
    })
      .then(() => {
        showToast(newTitle ? `已更新标题为「${newTitle}」` : '已恢复默认标题');
        pollStatus();
      })
      .catch(() => {});
  }
}

mainTitle.addEventListener('dblclick', e => {
  e.stopPropagation();
  if (!latestSnap) return;
  isEditingTitle = true;
  titleEditInput.value = latestSnap.title || '';
  mainTitle.style.display = 'none';
  titleEditInput.style.display = 'inline-block';
  titleEditInput.focus();
  titleEditInput.select();
});

titleEditInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    finishTitleEdit(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    finishTitleEdit(false);
  }
});

titleEditInput.addEventListener('blur', () => {
  finishTitleEdit(true);
});

// 折叠 / 展开
function toggleCollapse() {
  isCollapsed = !isCollapsed;
  expandedContainer.style.display = isCollapsed ? 'none' : 'flex';
  collapsedContainer.style.display = isCollapsed ? 'flex' : 'none';
  syncWindowHeight();
}

collapseBtn.addEventListener('click', toggleCollapse);
miniExpandBtn.addEventListener('click', toggleCollapse);

// 托盘最小化
function doHideToTray() {
  fetch('/api/hide-to-tray', { method: 'POST' }).catch(() => {});
}

hideToTrayBtn.addEventListener('click', doHideToTray);
miniHideToTrayBtn.addEventListener('click', doHideToTray);

// 停止任务逻辑（二次点击确认机制）
function resetStopConfirmation() {
  awaitingStopConfirm = false;
  stopTaskBtn.classList.remove('confirming');
  stopTaskBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;
  stopTaskBtn.title = '停止当前任务（二次点击确认）';
  miniStopBtn.classList.remove('confirming');
  miniStopBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`;
  if (stopConfirmTimer) {
    clearTimeout(stopConfirmTimer);
    stopConfirmTimer = null;
  }
}

async function handleStopTask(btn) {
  if (!latestSnap || (!latestSnap.isRunning && !latestSnap.isCompacting)) return;
  if (!awaitingStopConfirm) {
    awaitingStopConfirm = true;
    btn.classList.add('confirming');
    btn.textContent = '确认停止?';
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
    showToast(data.message, true);
    pollStatus();
  } catch (err) {
    showToast('停止任务失败: ' + err.message, true);
  }
}

stopTaskBtn.addEventListener('click', e => {
  e.stopPropagation();
  handleStopTask(stopTaskBtn);
});

miniStopBtn.addEventListener('click', e => {
  e.stopPropagation();
  handleStopTask(miniStopBtn);
});

// 滚动提示
stageList.addEventListener('scroll', updateScrollTopHint);
scrollTopHint.addEventListener('click', () => {
  stageList.scrollTo({ top: 0, behavior: 'smooth' });
});

// 会话下拉弹出与键盘导航
convTrigger.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = convMenu.style.display !== 'none';
  convMenu.style.display = isOpen ? 'none' : 'flex';
  convTrigger.classList.toggle('active', !isOpen);
});

document.addEventListener('click', () => {
  convMenu.style.display = 'none';
  convTrigger.classList.remove('active');
});

document.addEventListener('keydown', e => {
  if (convMenu.style.display !== 'none') {
    const items = [...convMenuList.querySelectorAll('.session-item')];
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
      convTrigger.classList.remove('active');
    }
  }
});

// 日志抽屉展开/收起
function toggleLogDrawer() {
  isLogOpen = !isLogOpen;
  logDrawer.style.display = isLogOpen ? 'flex' : 'none';
  logPillBtn.classList.toggle('active', isLogOpen);
  logDrawerArrow.style.transform = isLogOpen ? 'rotate(180deg)' : 'none';
}

logPillBtn.addEventListener('click', toggleLogDrawer);
closeLogBtn.addEventListener('click', toggleLogDrawer);

// 4 档阈值切换
thresholdSegment.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    thresholdSegment.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    watchdogThreshold = parseInt(btn.dataset.val, 10);
    pollStatus();
  });
});

wakeupNowBtn.addEventListener('click', () => {
  if (latestSnap && latestSnap.isCompacting) return;
  doWakeup('手动点击立即重调');
});

// 复制总结
copySummaryBtn.addEventListener('click', () => {
  if (!latestSnap) return;
  const ctx = latestSnap.context || {};
  const curK = Math.round((ctx.currentTokens || latestSnap.estimatedContextTokens || 0) / 1000);
  const lines = [
    `【任务名称】${latestSnap.title}`,
    `【完成状态】已完成 (${latestSnap.completedStages}/${latestSnap.totalStages})`,
    `【耗时统计】总耗时 ${formatDuration(latestSnap.elapsedSeconds, 'done')} (步骤执行 ${formatDuration(latestSnap.stepsDurationSec, 'done')}${latestSnap.thinkWaitSec >= 3 ? ' · 思考等待 ' + formatDuration(latestSnap.thinkWaitSec, 'done') : ''})`,
    `【上下文窗】${curK}k / 256k (${ctx.usagePct || 0}%)${ctx.compactionCount ? ' · 已压缩 ' + ctx.compactionCount + ' 次' : ''}`,
    `【阶段明细】`,
    ...(latestSnap.stages || []).map(
      s => `  ${s.index}. [${s.status === 'done' ? '✓' : s.status}] ${s.title}${s.badge ? ' (' + s.badge + ')' : ''} - ${formatDuration(s.durationSec, s.status)}`
    )
  ];
  navigator.clipboard.writeText(lines.join('\n'));
  showToast('已复制本轮执行摘要到剪贴板');
});

backToActiveBtn.addEventListener('click', e => {
  e.stopPropagation();
  pinnedStageIndex = null;
  if (latestSnap) renderSnapshot(latestSnap, { preserveScroll: true });
});

copyCmdBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (currentPreviewRawText) {
    navigator.clipboard.writeText(currentPreviewRawText);
    copyCmdLabel.textContent = '已复制 ✓';
    setTimeout(() => {
      copyCmdLabel.textContent = '复制';
    }, 1400);
  }
});

openNotepadBtn.addEventListener('click', () => {
  fetch('/api/open-log', { method: 'POST' });
});

copyLogBtn.addEventListener('click', () => {
  if (latestSnap && latestSnap.logTail) {
    navigator.clipboard.writeText(latestSnap.logTail);
    showToast('已将最新日志复制到剪贴板');
  }
});

pollStatus();
setInterval(pollStatus, 1000);
