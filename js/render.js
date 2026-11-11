function renderSnapshot(snap, options = {}) {
  latestSnap = snap;
  buildConvMenu(snap.conversations, snap.convId);
  renderMultiTaskBar(snap);
  updateStopButton(snap);
  updateContextPill(snap);

  const pct = Math.max(0, Math.min(100, snap.overallProgress || 0));
  const isDoneState = !snap.isRunning && !snap.isCompacting && !snap.isStopped;
  const isStalled =
    snap.isRunning &&
    !snap.isCompacting &&
    watchdogThreshold > 0 &&
    snap.silenceSeconds >= Math.min(watchdogThreshold, 45);

  let dataState = 'running';
  if (snap.isStopped) {
    dataState = snap.isStoppedCooled ? 'stopped_cool' : 'stopped';
  } else if (snap.isCompacting) {
    dataState = 'compacting';
  } else if (isStalled) {
    dataState = 'stalled';
  } else if (isDoneState) {
    dataState = 'done';
  }

  hudWin.setAttribute('data-state', dataState);

  const isGhost = Boolean(snap.isClickThrough);
  hudWin.classList.toggle('is-click-through', isGhost);
  ghostBadge.style.display = isGhost ? 'inline-flex' : 'none';

  // 42x42 SVG Progress Ring (r=17 => circumference = 106.8)
  const circumference = 106.8;
  const offset = circumference - (pct / 100) * circumference;
  ringFill.style.strokeDashoffset = String(offset.toFixed(1));
  ringLabel.textContent = dataState === 'compacting' ? '✦' : `${pct}%`;

  // Header bottom 2px linear bar
  linearBar.style.width = `${pct}%`;

  // Title & 3-line Tooltip
  titleText.textContent = snap.title || 'Antigravity 会话监控';

  const initPromptText = snap.initialPrompt ? snap.initialPrompt.slice(0, 160) : '暂无初始任务记录';
  const latestOrderText = snap.latestPrompt || (snap.fullPrompt ? snap.fullPrompt.slice(0, 220) : '执行当前回合所有步骤');
  currentTitleTipHtml = [
    `<div><b class="tip-accent-sky">【任务名称】</b> ${escapeHtml(snap.title || '')}</div>`,
    `<div><b class="tip-accent-sky">【初始任务】</b> ${escapeHtml(initPromptText)}</div>`,
    `<div><b class="tip-accent-sky">【本轮指令】</b> ${escapeHtml(latestOrderText)}</div>`
  ].join('');

  const nativeTaskTip = isCollapsed
    ? `【任务名称】${snap.title || ''}\n【初始任务】${initPromptText}\n【本轮指令】${latestOrderText}`
    : '';
  titleInfoBtn.title = nativeTaskTip;
  statusCapsule.title = nativeTaskTip;

  if (snap.latestPrompt) {
    followupPill.textContent = `追问: "${snap.latestPrompt}"`;
    followupPill.title = `最新追问: ${snap.latestPrompt}`;
    followupPill.style.display = 'inline-flex';
  } else {
    followupPill.style.display = 'none';
  }

  // Status Capsule: "<State> · X/Y 阶段"
  const doneCnt = snap.completedStages || 0;
  const totCnt = snap.totalStages || 0;
  let statePrefix = '进行中';
  if (dataState === 'compacting') statePrefix = 'Compacting';
  else if (dataState === 'stalled') statePrefix = '疑似卡顿';
  else if (dataState === 'stopped' || dataState === 'stopped_cool') statePrefix = '已停止';
  else if (dataState === 'done') statePrefix = '已完成';

  statusText.textContent = `${statePrefix} · ${doneCnt}/${totCnt} 阶段`;

  // Stage List (in-place DOM diffing to preserve scroll & interactions)
  const wasNearBottom = stageList.scrollHeight - stageList.scrollTop - stageList.clientHeight <= 28;
  const convChanged = snap.convId !== lastRenderedConvId;

  if (!snap.stages || snap.stages.length === 0) {
    if (!stageList.querySelector('[data-empty-placeholder="1"]')) {
      stageList.innerHTML = `<div class="stage-card" data-empty-placeholder="1"><div class="stage-main-row"><span class="stage-icon" style="color:#64748b">○</span><span class="stage-title" style="color:#94a3b8">当前回合暂无工具阶段记录</span><span class="stage-dur">--</span></div></div>`;
    }
    scrollTopHint.classList.remove('visible');
    lastRenderedConvId = snap.convId;
    lastStageCount = 0;
  } else {
    const emptyEl = stageList.querySelector('[data-empty-placeholder="1"]');
    if (emptyEl) emptyEl.remove();

    while (stageList.children.length > snap.stages.length) {
      stageList.lastElementChild.remove();
    }

    snap.stages.forEach((st, idx) => {
      const isPin = pinnedStageIndex === st.index;
      const hasSubs = Array.isArray(st.subSteps) && st.subSteps.length > 1;
      const isSubOpen = hasSubs && expandedSubstepIndices.has(st.index);

      let cardEl = stageList.children[idx];
      if (!cardEl || !cardEl.classList.contains('stage-card')) {
        if (cardEl) cardEl.remove();
        cardEl = document.createElement('div');
        cardEl.className = 'stage-card';
        cardEl.addEventListener('click', () => {
          const curIdx = Number(cardEl.dataset.stageIndex || 0);
          const curHasSubs = cardEl.dataset.hasSubs === '1';
          if (!curIdx) return;
          if (curHasSubs) {
            if (expandedSubstepIndices.has(curIdx)) expandedSubstepIndices.delete(curIdx);
            else expandedSubstepIndices.add(curIdx);
          }
          pinnedStageIndex = pinnedStageIndex === curIdx && !curHasSubs ? null : curIdx;
          if (latestSnap) renderSnapshot(latestSnap, { preserveScroll: true });
        });
        stageList.appendChild(cardEl);
      }

      const visualStatus = st.status === 'running' && isStalled ? 'stalled' : st.status;
      cardEl.dataset.stageIndex = String(st.index);
      cardEl.dataset.hasSubs = hasSubs ? '1' : '0';
      cardEl.dataset.stageStatus = visualStatus;
      cardEl.className = `stage-card${isPin ? ' is-pinned' : ''}`;

      let iconChar = '●';
      let iconColor = '#38bdf8';
      if (st.status === 'done') {
        iconChar = '✓';
        iconColor = '#34d399';
      } else if (st.status === 'compacting') {
        iconChar = '✦';
        iconColor = '#c084fc';
      } else if (st.status === 'error') {
        iconChar = '✕';
        iconColor = '#fb7185';
      } else if (st.status === 'stopped') {
        iconChar = '■';
        iconColor = '#fb7185';
      } else if (st.status === 'running' && isStalled) {
        iconChar = '⚠';
        iconColor = '#fbbf24';
      } else if (st.status === 'pending') {
        iconChar = '○';
        iconColor = '#64748b';
      }

      const badgeText =
        st.hasRealProgress && st.progress !== null
          ? `${st.progress}%`
          : st.badge || (st.status === 'done' ? '完成' : '执行中');
      const isErrBadge = st.status === 'error' || st.status === 'stopped' || /^Exit\s+[1-9]/.test(badgeText);
      const durStr = formatDuration(st.durationSec, st.status);
      const chevronSuffix = hasSubs ? (isSubOpen ? ' ▾' : ' ▸') : '';

      const renderSig = `${st.index}|${visualStatus}|${iconChar}|${st.title}|${badgeText}|${durStr}|${isSubOpen ? 1 : 0}|${hasSubs ? st.subSteps.length : 0}`;
      if (cardEl.dataset.renderSig !== renderSig) {
        cardEl.dataset.renderSig = renderSig;
        const subsHtml =
          hasSubs && isSubOpen
            ? `<div class="stage-substeps">${st.subSteps
                .map((sub, sIdx, arr) => {
                  const branch = sIdx === arr.length - 1 ? '└─' : '├─';
                  const subBadge = sub.badge ? ` ${sub.badge}` : '';
                  const errMark = sub.status === 'error' ? ' [已重试]' : '';
                  return `<div class="stage-substep-row">${branch} (${sIdx + 1}/${arr.length}) ${escapeHtml(sub.title)}${escapeHtml(subBadge)}${errMark} (${sub.durationSec || 1}s)</div>`;
                })
                .join('')}</div>`
            : '';

        cardEl.innerHTML = `
          <div class="stage-main-row">
            <span class="stage-icon" style="color:${iconColor}">${iconChar}</span>
            <span class="stage-title">${escapeHtml(st.title)}${chevronSuffix}</span>
            <span class="stage-badge${isErrBadge ? ' badge-error' : ''}">${escapeHtml(badgeText)}</span>
            <span class="stage-dur">${durStr}</span>
          </div>
          ${subsHtml}
        `;
      }
    });

    const shouldAutoScrollBottom =
      !options.preserveScroll &&
      (convChanged ||
        (snap.stages.length > lastStageCount &&
          wasNearBottom &&
          pinnedStageIndex === null &&
          expandedSubstepIndices.size === 0));

    lastRenderedConvId = snap.convId;
    lastStageCount = snap.stages.length;

    if (shouldAutoScrollBottom) {
      stageList.scrollTop = stageList.scrollHeight;
    }
    updateScrollTopHint();
  }

  updateCmdPreviewBar(snap);

  // Real-Time Log Stream
  const newLogText = snap.logTail || '暂无命令输出';
  if (newLogText !== lastRenderedLogTail) {
    const logNearBottom = logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight <= 24;
    lastRenderedLogTail = newLogText;
    logContent.textContent = newLogText;
    if (logNearBottom) {
      logContent.scrollTop = logContent.scrollHeight;
    }
  }

  renderFooterState(snap, isDoneState);
  syncWindowHeight();
}
