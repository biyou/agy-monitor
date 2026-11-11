function syncWindowHeight() {
  const targetH = isCollapsed ? COLLAPSED_WIN_HEIGHT : EXPANDED_WIN_HEIGHT;
  if (targetH === lastSentWinHeight && !resizeDelayTimer) return;
  if (resizeDelayTimer) {
    clearTimeout(resizeDelayTimer);
    resizeDelayTimer = null;
  }
  const sendResize = () => {
    lastSentWinHeight = targetH;
    fetch('/api/resize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 520, height: targetH })
    }).catch(() => {});
  };
  if (isCollapsed && lastSentWinHeight !== 0) {
    resizeDelayTimer = setTimeout(() => {
      resizeDelayTimer = null;
      sendResize();
    }, 215);
  } else {
    sendResize();
  }
}

function resetStopConfirmation() {
  awaitingStopConfirm = false;
  stopBtn.classList.remove('confirming');
  stopBtnLabel.textContent = '';
  stopBtn.title = '二次点击确认停止任务';
  if (stopConfirmTimer) {
    clearTimeout(stopConfirmTimer);
    stopConfirmTimer = null;
  }
}

async function selectConversation(choice, labelText) {
  currentConvChoice = choice;
  convBtnText.textContent = labelText;
  expandedSubstepIndices.clear();
  pinnedStageIndex = null;
  await fetch('/api/select-conv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ convId: choice })
  });
  pollStatus();
}

async function doWakeup(reason, targetConvId = null, targetTitle = '') {
  try {
    const res = await fetch('/api/wakeup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        convId: targetConvId || (latestSnap && latestSnap.convId) || undefined,
        reason,
        forceCopy: false
      })
    });
    const data = await res.json();
    const msg = targetTitle
      ? `⚡ 后台自动唤醒「${targetTitle.slice(0, 12)}」: ${data.message}`
      : data.message;
    showToast(msg, !data.sentViaAgentApi, data.promptText);
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
