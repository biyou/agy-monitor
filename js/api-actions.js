function syncWindowHeight() {
  const targetH = isCollapsed ? COLLAPSED_WIN_HEIGHT : EXPANDED_WIN_HEIGHT;
  if (targetH === lastSentWinHeight) return;
  lastSentWinHeight = targetH;
  fetch('/api/resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ width: 520, height: targetH })
  }).catch(() => {});
}

function resetStopConfirmation() {
  awaitingStopConfirm = false;
  stopOrHideBtn.classList.remove('confirming');
  if (stopConfirmTimer) {
    clearTimeout(stopConfirmTimer);
    stopConfirmTimer = null;
  }
  if (latestSnap) updateStopOrHideButton(latestSnap);
}

function updateStopOrHideButton(snap) {
  if (awaitingStopConfirm) return;
  if (snap.isRunning || snap.isCompacting) {
    stopOrHideBtn.className = 'ctrl-btn stop-mode';
    stopOrHideIcon.innerHTML = STOP_SQUARE_SVG;
    stopOrHideBtn.title = '停止当前正在运行的任务（需二次点击确认，防误触）';
  } else {
    stopOrHideBtn.className = 'ctrl-btn';
    stopOrHideIcon.innerHTML = TRAY_MINIMIZE_SVG;
    stopOrHideBtn.title = '隐藏到系统托盘（左键单击右下角托盘图标可恢复）';
  }
}

async function selectConversation(choice, labelText) {
  currentConvChoice = choice;
  convTriggerLabel.textContent = labelText;
  expandedSubstepIndices.clear();
  pinnedStageIndex = null;
  await fetch('/api/select-conv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ convId: choice })
  });
  pollStatus();
}

async function doWakeup(reason) {
  try {
    const res = await fetch('/api/wakeup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, forceCopy: false })
    });
    const data = await res.json();
    showToast(data.message, !data.sentViaAgentApi, data.promptText);
    pollStatus();
  } catch (e) {
    showToast('唤醒请求失败: ' + e.message, true);
  }
}

async function pollStatus() {
  try {
    const res = await fetch('/api/status');
    const snap = await res.json();
    renderSnapshot(snap);
  } catch (_) {}
}
