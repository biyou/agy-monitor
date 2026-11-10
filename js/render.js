function renderSnapshot(snap, options = {}) {
  latestSnap = snap;
  buildConvMenu(snap.conversations);
  updateStopButtons(snap);
  updateContextPill(snap);

  const pct = Math.max(0, Math.min(100, snap.overallProgress || 0));
  const isDoneState = !snap.isRunning && !snap.isCompacting && !snap.isStopped;
  const isStalled = snap.isRunning && !snap.isCompacting && watchdogThreshold > 0 && snap.silenceSeconds >= Math.min(watchdogThreshold, 20);

  let themeKey = 'running';
  if (snap.isStopped) themeKey = 'stopped';
  else if (snap.isCompacting) themeKey = 'compacting';
  else if (isStalled) themeKey = 'stalled';
  else if (isDoneState) themeKey = 'done';

  applyTheme(themeKey);

  // 环形进度
  const deg = pct * 3.6;
  const acc = THEMES[themeKey].accent;
  ringPctVal.textContent = pct;
  miniRingPctVal.textContent = pct;

  if (snap.isCompacting) {
    ringTrack.style.background = `conic-gradient(${acc} 0deg, rgba(255,255,255,.08) 0deg)`;
    miniRingTrack.style.background = `conic-gradient(${acc} 0deg, rgba(255,255,255,.08) 0deg)`;
    ringSweep.style.display = 'block';
  } else {
    ringTrack.style.background = `conic-gradient(${acc} ${deg}deg, rgba(255,255,255,.08) 0deg)`;
    miniRingTrack.style.background = `conic-gradient(${acc} ${deg}deg, rgba(255,255,255,.08) 0deg)`;
    ringSweep.style.display = 'none';
  }

  // 顶栏进度细线
  linearTrack.style.opacity = isDoneState ? '0.45' : '1';
  linearFill.classList.toggle('indeterminate', snap.isCompacting);
  linearFill.style.width = snap.isCompacting ? '100%' : `${pct}%`;

  // 状态徽标与文本
  const unifiedActiveDur = formatDuration(snap.activeStageElapsedSec || snap.silenceSeconds, 'running');
  let labelText = THEMES[themeKey].label;
  if (snap.isCompacting) labelText = `Compacting · ${unifiedActiveDur}`;
  else if (isStalled) labelText = `疑似卡顿 · ${formatDuration(snap.silenceSeconds, 'running')}`;

  statusLabel.textContent = labelText;
  miniStatusLabel.textContent = labelText;

  // 标题
  if (!isEditingTitle) {
    mainTitle.textContent = snap.title || 'Antigravity 会话监控';
    miniMainTitle.textContent = snap.title || 'Antigravity 会话监控';
  }

  const tooltipParts = [`【任务名称】${snap.title || ''}（双击可重命名）`];
  if (snap.initialPrompt) tooltipParts.push(`【初始任务】${snap.initialPrompt.slice(0, 160)}`);
  if (snap.fullPrompt && snap.fullPrompt !== snap.initialPrompt) tooltipParts.push(`【本轮指令】${snap.fullPrompt.slice(0, 220)}`);
  mainTitle.title = tooltipParts.join('\n');
  miniMainTitle.title = mainTitle.title;

  if (snap.latestPrompt) {
    followupTag.style.display = 'inline-flex';
    followupTag.textContent = `追问: “${snap.latestPrompt}”`;
    followupTag.title = `最新提问: ${snap.latestPrompt}`;
  } else {
    followupTag.style.display = 'none';
  }

  const subText = snap.isRunning ? `当前第 ${snap.activeStageIndex} 步：${snap.activeStageTitle || ''}` : (snap.activeStageTitle || '');
  subtitleText.textContent = subText;
  subtitleText.title = subText;
  miniSubtitleText.textContent = subText;
  miniSubtitleText.title = subText;

  // 分区统计
  stageSummaryCount.textContent = `${snap.completedStages || 0} / ${snap.totalStages || 0}`;
  const rawLogName = snap.activeLogName || 'transcript.jsonl';
  logSourceName.textContent = rawLogName === 'transcript.jsonl' ? '日志' : rawLogName;
  logHeaderTitle.textContent = `tail -f · ${logSourceName.textContent} · 最近 30 行`;

  // 阶段流水线渲染（就地差分）
  const wasNearBottom = stageList.scrollHeight - stageList.scrollTop - stageList.clientHeight <= 28;
  const convChanged = snap.convId !== lastRenderedConvId;

  if (!snap.stages || snap.stages.length === 0) {
    if (!stageList.querySelector('[data-empty-placeholder="1"]')) {
      stageList.innerHTML = `<div class="stage-row" data-empty-placeholder="1"><span class="stage-idx">-</span><span class="stage-name">当前回合暂无工具阶段记录</span><span class="stage-dur">--</span></div>`;
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
      const isPinned = pinnedStageIndex === st.index;
      const hasSubs = Array.isArray(st.subSteps) && st.subSteps.length > 1;
      const isSubOpen = hasSubs && expandedSubstepIndices.has(st.index);

      let groupEl = stageList.children[idx];
      if (!groupEl || !groupEl.classList.contains('stage-item-group')) {
        if (groupEl) groupEl.remove();
        groupEl = document.createElement('div');
        groupEl.className = 'stage-item-group';
        groupEl.innerHTML = `
          <div class="stage-timeline-v-line"></div>
          <div class="stage-row">
            <div class="stage-node"></div>
            <span class="stage-idx"></span>
            <span class="stage-name"></span>
            <span class="stage-badge-wrap"></span>
            <span class="stage-expand-wrap"></span>
            <span class="stage-dur"></span>
          </div>
          <div class="substeps-box"></div>
        `;
        const rEl = groupEl.querySelector('.stage-row');
        rEl.addEventListener('click', () => {
          const curIdx = Number(groupEl.dataset.stageIndex || 0);
          const curHasSubs = groupEl.dataset.hasSubs === '1';
          if (!curIdx) return;
          if (curHasSubs) {
            if (expandedSubstepIndices.has(curIdx)) expandedSubstepIndices.delete(curIdx);
            else expandedSubstepIndices.add(curIdx);
            pinnedStageIndex = curIdx;
          } else {
            pinnedStageIndex = pinnedStageIndex === curIdx ? null : curIdx;
          }
          if (latestSnap) renderSnapshot(latestSnap, { preserveScroll: true });
        });
        stageList.appendChild(groupEl);
      }

      groupEl.dataset.stageIndex = String(st.index);
      groupEl.dataset.hasSubs = hasSubs ? '1' : '0';

      const vLine = groupEl.querySelector('.stage-timeline-v-line');
      vLine.style.top = idx === 0 ? '50%' : '0px';
      vLine.style.bottom = idx === snap.stages.length - 1 ? '50%' : '0px';

      const rowEl = groupEl.querySelector('.stage-row');
      rowEl.className = `stage-row ${st.status}${isPinned ? ' selected-pin' : ''}`;

      // Node 图标与动效
      const nodeEl = rowEl.querySelector('.stage-node');
      let nodeColor = '#7C8899', nodeBg = 'transparent', nodeBorder = '0 solid transparent', halo = '0px';
      if (st.status === 'done') {
        nodeColor = '#34D399';
        nodeBg = mixWithDark(nodeColor, 0.18);
        nodeEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
      } else if (st.status === 'running' || st.status === 'compacting') {
        nodeColor = st.status === 'compacting' ? '#A78BFA' : (isStalled ? '#FBBF24' : '#38BDF8');
        nodeBg = mixWithDark(nodeColor, 0.18);
        halo = `0 0 0 3px ${hexToRgba(nodeColor, 0.18)}`;
        const spinAnim = isStalled ? 'none' : 'agy-spin .9s linear infinite';
        nodeEl.innerHTML = `<div style="width:10px; height:10px; box-sizing:border-box; border-radius:50%; border:2px solid ${hexToRgba(nodeColor, 0.25)}; border-top-color:${nodeColor}; animation:${spinAnim};"></div>`;
      } else if (st.status === 'stopped') {
        nodeColor = '#FB7185';
        nodeBg = mixWithDark(nodeColor, 0.18);
        nodeEl.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>`;
      } else {
        nodeColor = '#556070';
        nodeBg = '#10141A';
        nodeBorder = '1px dashed #556070';
        nodeEl.innerHTML = '';
      }
      nodeEl.style.backgroundColor = nodeBg;
      nodeEl.style.borderColor = nodeBorder;
      nodeEl.style.color = nodeColor;
      nodeEl.style.boxShadow = halo;

      rowEl.querySelector('.stage-idx').textContent = st.index;
      rowEl.querySelector('.stage-name').textContent = st.title;

      const badgeWrap = rowEl.querySelector('.stage-badge-wrap');
      if (st.badge) {
        badgeWrap.innerHTML = `<span class="stage-badge ${hasSubs ? 'clickable' : ''}">${st.badge}</span>`;
      } else {
        badgeWrap.innerHTML = '';
      }

      const expandWrap = rowEl.querySelector('.stage-expand-wrap');
      if (hasSubs) {
        const d = isSubOpen ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6';
        expandWrap.innerHTML = `<svg class="stage-expand-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
      } else {
        expandWrap.innerHTML = '';
      }

      const durEl = rowEl.querySelector('.stage-dur');
      const durText = formatDuration(st.durationSec, st.status);
      if (st.hasRealProgress && st.progress !== null) {
        durEl.textContent = `${st.progress}%`;
        durEl.style.color = acc;
      } else {
        durEl.textContent = durText;
        durEl.style.color = st.status === 'running' ? acc : '#8A95A6';
      }

      const subBox = groupEl.querySelector('.substeps-box');
      subBox.className = isSubOpen ? 'substeps-box open' : 'substeps-box';
      if (isSubOpen && hasSubs) {
        subBox.innerHTML = st.subSteps.map((sub, sIdx, arr) => `
          <div class="substep-item">
            <span class="substep-branch">${sIdx === arr.length - 1 ? '└─' : '├─'}</span>
            <span>(${sIdx + 1}/${arr.length})</span>
            <span class="substep-text">${sub.title} ${sub.badge || ''}</span>
            <span>${sub.durationSec}s</span>
          </div>
        `).join('');
      } else {
        subBox.innerHTML = '';
      }
    });

    const shouldAutoScrollBottom =
      !options.preserveScroll &&
      (convChanged || (snap.stages.length > lastStageCount && wasNearBottom && pinnedStageIndex === null && expandedSubstepIndices.size === 0));

    lastRenderedConvId = snap.convId;
    lastStageCount = snap.stages.length;

    if (shouldAutoScrollBottom) {
      stageList.scrollTop = stageList.scrollHeight;
    }
    updateScrollTopHint();
  }

  updateCmdPreviewBar(snap);

  const newLogText = snap.logTail || '暂无输出';
  if (newLogText !== lastRenderedLogTail) {
    const logNearBottom = logTerminal.scrollHeight - logTerminal.scrollTop - logTerminal.clientHeight <= 24;
    lastRenderedLogTail = newLogText;
    logTerminal.textContent = newLogText;
    if (logNearBottom) logTerminal.scrollTop = logTerminal.scrollHeight;
  }

  renderFooterState(snap, isDoneState);
  syncWindowHeight();
}
