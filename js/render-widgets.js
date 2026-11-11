function updateContextPill(snap) {
  const ctx = snap.context || {};
  const curTok = ctx.currentTokens ?? snap.estimatedContextTokens ?? 0;
  const maxTok = ctx.maxTokens || 256000;
  const usagePct = ctx.usagePct ?? Math.min(100, Math.round((curTok / maxTok) * 100));
  const curK = (curTok / 1000).toFixed(1).replace(/\.0$/, '');
  const maxK = Math.round(maxTok / 1000);

  ctxPctLabel.textContent = `${usagePct}%`;

  let ctxColor = '#38bdf8';
  let borderRgba = 'rgba(56, 189, 248, 0.35)';
  let textColor = '#7dd3fc';
  let tipAccentClass = 'tip-accent-sky';

  if (usagePct >= 86 || snap.isCompacting) {
    ctxColor = '#c084fc';
    borderRgba = 'rgba(192, 132, 252, 0.45)';
    textColor = '#d8b4fe';
    tipAccentClass = 'tip-accent-purple';
  } else if (usagePct >= 65) {
    ctxColor = '#fbbf24';
    borderRgba = 'rgba(251, 191, 36, 0.45)';
    textColor = '#fcd34d';
    tipAccentClass = 'tip-accent-amber';
  }

  ctxSectorPath.setAttribute('fill', ctxColor);
  ctxSectorPath.setAttribute('d', buildPieSectorPath(7, 7, 5.8, usagePct));
  ctxPiePill.style.borderColor = borderRgba;
  ctxPiePill.style.color = textColor;

  const inK = ((ctx.inputTokens || 0) / 1000).toFixed(1).replace(/\.0$/, '');
  const outK = ((ctx.totalOutputTokens || 0) / 1000).toFixed(1).replace(/\.0$/, '');
  const cacheHit = ctx.cacheHitPct || 0;

  let compactLine = '暂未触发自动压缩';
  if (ctx.compactionCount > 0) {
    const fromK = ((ctx.lastCompactedFrom || 0) / 1000).toFixed(1).replace(/\.0$/, '');
    const toK = ((ctx.lastCompactedTo || 0) / 1000).toFixed(1).replace(/\.0$/, '');
    compactLine = `已压缩 ${ctx.compactionCount} 次${ctx.lastCompactedFrom ? ` (${fromK}k → ${toK}k)` : ''}`;
  }

  currentCtxTipHtml = [
    `<div><b class="${tipAccentClass}">【上下文窗口】</b> ~${curK}k / ${maxK}k tokens (${usagePct}%)${snap.isCompacting ? ' · 自动压缩中' : ''}</div>`,
    `<div><b class="${tipAccentClass}">【Token 构成】</b> 输入 ${inK}k · 缓存命中 ${cacheHit}% · 输出 ${outK}k</div>`,
    `<div><b class="${tipAccentClass}">【压缩记录】</b> ${compactLine}</div>`
  ].join('');

  // Fallback native tooltip when collapsed into 74px mini-capsule
  ctxPiePill.title = isCollapsed
    ? `【上下文窗口】~${curK}k / ${maxK}k tokens (${usagePct}%)\n【Token 构成】输入 ${inK}k · 缓存命中 ${cacheHit}% · 输出 ${outK}k\n【压缩记录】${compactLine}`
    : '';
}

function updateCmdPreviewBar(snap) {
  const rawLogName = snap.activeLogName || 'transcript.jsonl';
  const shortLogName = rawLogName === 'transcript.jsonl' ? '日志' : rawLogName;
  logBtn.textContent = `📄 ${shortLogName}`;
  logHeaderLabel.textContent = `${rawLogName} · 实时跟随 (tail -f)`;

  if (!snap || !snap.stages || snap.stages.length === 0) {
    previewPrefix.textContent = '$';
    previewText.textContent = '正在等待任务步骤...';
    previewText.title = '';
    unpinBtn.style.display = 'none';
    copyPreviewBtn.style.display = 'none';
    currentPreviewRawText = '';
    return;
  }

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

  const prefix = targetStage.previewPrefix || (targetStage.toolType === 'bash' ? '$' : '🧠 状态');
  const rawTarget = targetStage.previewTarget || targetStage.command || targetStage.title || '';
  currentPreviewRawText = rawTarget;

  const displayTarget =
    targetStage.toolType === 'write' || targetStage.toolType === 'edit' || targetStage.toolType === 'read'
      ? middleEllipsisPath(rawTarget, 42)
      : rawTarget;

  previewPrefix.textContent = prefix;
  previewText.textContent = displayTarget;
  previewText.title = `${targetStage.title}\n${rawTarget}`;
  unpinBtn.style.display = isPinned ? 'inline-flex' : 'none';
  copyPreviewBtn.style.display = rawTarget ? 'inline-flex' : 'none';
}

function renderMultiTaskBar(snap) {
  const rawList = Array.isArray(snap.parallelTasks) ? snap.parallelTasks : [];

  // Re-enable any dismissed task if it starts running/compacting again
  for (const t of rawList) {
    if (t.isRunning || t.isCompacting) {
      dismissedParallelIds.delete(t.id);
    }
  }

  visibleParallelTasks = rawList.filter(t => !dismissedParallelIds.has(t.id));

  // Global background watchdog inspection across all active conversations
  const allConvs = Array.isArray(snap.conversations) ? snap.conversations : visibleParallelTasks;
  if (watchdogThreshold > 0) {
    for (const c of allConvs) {
      if (c.isRunning && !c.isCompacting && (c.silenceSeconds || 0) >= watchdogThreshold) {
        const lastAt = lastAutoWakeupByConv.get(c.id) || 0;
        if (Date.now() - lastAt > 15000) {
          lastAutoWakeupByConv.set(c.id, Date.now());
          const isBg = c.id !== snap.convId;
          doWakeup(
            `日志连续 ${c.silenceSeconds} 秒无输出`,
            c.id,
            isBg ? c.title || c.shortId : ''
          );
        }
      }
    }
  }

  const stallWarnSec = watchdogThreshold > 0 ? Math.min(watchdogThreshold, 45) : 60;
  const stalledTasks = visibleParallelTasks.filter(
    t => t.isRunning && !t.isCompacting && (t.silenceSeconds || 0) >= stallWarnSec
  );

  // Update 74px header session / parallel / collapsed-step button
  const shortId = snap.convId && snap.convId !== 'none' ? snap.convId.slice(0, 6) : '';
  convDropdownBtn.classList.remove('parallel-cycle-sky', 'parallel-cycle-amber');

  const activeStepRaw = snap.activeStageTitle || '当前回合全部步骤执行完毕';
  const shortActiveStep = activeStepRaw.replace(/\s*·\s*.*$/, '');

  if (isCollapsed) {
    if (visibleParallelTasks.length >= 2) {
      const curIdx = Math.max(0, visibleParallelTasks.findIndex(t => t.id === snap.convId));
      if (stalledTasks.length > 0) {
        convDropdownBtn.classList.add('parallel-cycle-amber');
        convBtnText.textContent = `⚠ ${stalledTasks.length}卡顿/${visibleParallelTasks.length}并行 · ${shortActiveStep}`;
      } else {
        convDropdownBtn.classList.add('parallel-cycle-sky');
        convBtnText.textContent = `⚡ ${visibleParallelTasks.length}并行(${curIdx + 1}/${visibleParallelTasks.length}) · ${shortActiveStep}`;
      }
      convDropdownBtn.title = `当前步骤: ${activeStepRaw}\n左键点击轮播切换下一个并行任务 · 右键展开完整会话菜单`;
    } else {
      const stepPrefix = snap.isRunning || snap.isCompacting ? '▸ ' : '';
      convBtnText.textContent = `${stepPrefix}${activeStepRaw}`;
      convDropdownBtn.title = `当前步骤: ${activeStepRaw}\n点击展开面板并切换监控会话`;
    }
  } else {
    convDropdownBtn.title = '切换监控会话';
    if (currentConvChoice === 'auto') {
      convBtnText.textContent =
        visibleParallelTasks.length >= 2
          ? `自动追踪 · ${visibleParallelTasks.length}并行`
          : shortId
          ? `自动追踪 (${shortId})`
          : '自动追踪';
    } else {
      const chosenMeta = (snap.conversations || []).find(c => c.id === currentConvChoice);
      convBtnText.textContent = chosenMeta
        ? `${chosenMeta.isSubagent ? '[子] ' : ''}${chosenMeta.title}`
        : `会话 ${currentConvChoice.slice(0, 6)}`;
    }
  }

  // Show Multi-Task Pill Bar only when >= 2 parallel/recent tasks and not collapsed
  const showMultiBar = visibleParallelTasks.length >= 2 && !isCollapsed;
  hudWin.classList.toggle('has-multi-bar', showMultiBar);
  if (!showMultiBar) {
    multiTaskBar.style.display = 'none';
    return;
  }

  multiTaskBar.style.display = 'flex';
  while (multiTaskBar.children.length > visibleParallelTasks.length) {
    multiTaskBar.lastElementChild.remove();
  }

  visibleParallelTasks.forEach((t, idx) => {
    const isAct = t.id === snap.convId;
    const isTaskStalled =
      t.isRunning && !t.isCompacting && (t.silenceSeconds || 0) >= stallWarnSec;

    let dotChar = '●';
    let dotColor = '#38bdf8';
    let metricText = `${t.overallProgress || 0}%`;
    let metricColor = '#94a3b8';

    if (t.isStopped) {
      dotChar = '■';
      dotColor = '#fb7185';
      metricText = '已停';
      metricColor = '#fda4af';
    } else if (t.isCompacting) {
      dotChar = '✦';
      dotColor = '#c084fc';
      metricText = '压缩';
      metricColor = '#d8b4fe';
    } else if (isTaskStalled) {
      dotChar = '⚠';
      dotColor = '#fbbf24';
      metricText = `⚠ ${t.silenceSeconds}s`;
      metricColor = '#fde68a';
    } else if (!t.isRunning) {
      dotChar = '✓';
      dotColor = '#34d399';
      metricText = '完成';
      metricColor = '#6ee7b7';
    }

    let tab = multiTaskBar.children[idx];
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      multiTaskBar.appendChild(tab);
    }

    const canDismiss = !t.isRunning && !t.isCompacting;
    const cls = `task-pill-tab${isAct ? ' is-active' : ''}${
      !isAct && isTaskStalled ? ' is-stalled-bg' : ''
    }`;
    if (tab.className !== cls) tab.className = cls;

    tab.dataset.taskId = t.id;
    tab.dataset.taskLabel = t.label || t.title;
    const tipText = `${t.isSubagent ? '[子智能体] ' : ''}${t.title} (${t.completedStages}/${t.totalStages} 阶段 · ${metricText})`;
    if (tab.title !== tipText) tab.title = tipText;

    const sig = `${t.id}|${dotChar}|${t.isSubagent ? 1 : 0}|${t.title}|${metricText}|${canDismiss ? 1 : 0}`;
    if (tab.dataset.renderSig !== sig) {
      tab.dataset.renderSig = sig;
      const rolePrefix = t.isSubagent ? `<span class="tab-sub-badge">子</span>` : '';
      const closeHtml = canDismiss
        ? `<span class="tab-close" data-close-id="${t.id}" title="从标签栏移除">×</span>`
        : '';
      tab.innerHTML = `
        <span style="color:${dotColor};font-weight:700;">${dotChar}</span>
        ${rolePrefix}
        <span class="tab-title">${escapeHtml(t.title)}</span>
        <span class="tab-metric" style="color:${metricColor};">${metricText}</span>
        ${closeHtml}
      `;
    }
  });
}

function buildConvMenu(conversations, currentConvId) {
  const shortId = currentConvId && currentConvId !== 'none' ? currentConvId.slice(0, 6) : '';
  const baseItems = [{ id: 'auto', label: '自动追踪活跃会话 (当前)', tag: '自动', time: '' }];
  const allItems = [
    ...baseItems,
    ...(conversations || []).map(c => {
      let tag = '已就绪';
      if (c.isRunning) tag = '运行中';
      else if (c.isCompacting) tag = '压缩中';
      else if (c.isStopped) tag = '已停止';
      const subPrefix = c.isSubagent ? '[子] ' : '';
      return {
        id: c.id,
        label: `${subPrefix}${c.title || c.label || c.id.slice(0, 8)}`,
        tag,
        time: c.time || ''
      };
    })
  ];

  const TAG_COLORS = {
    '自动': ['rgba(148,163,184,0.18)', '#cbd5e1'],
    '运行中': ['rgba(56,189,248,0.18)', '#38bdf8'],
    '压缩中': ['rgba(192,132,252,0.18)', '#c084fc'],
    '已停止': ['rgba(251,113,133,0.18)', '#fb7185'],
    '已就绪': ['rgba(52,211,153,0.15)', '#34d399']
  };

  while (convMenuList.children.length > allItems.length) {
    convMenuList.lastElementChild.remove();
  }

  allItems.forEach((item, idx) => {
    let row = convMenuList.children[idx];
    if (!row) {
      row = document.createElement('div');
      row.className = 'conv-item';
      convMenuList.appendChild(row);
    }

    const isAct = currentConvChoice === item.id;
    const isFocused = row.classList.contains('focused');
    row.className = `conv-item${isAct ? ' active' : ''}${isFocused ? ' focused' : ''}`;
    row.dataset.convId = item.id;
    row.dataset.btnLabel =
      item.id === 'auto' ? (shortId ? `自动追踪 (${shortId})` : '自动追踪') : item.label;

    const sig = `${item.id}|${item.tag}|${item.label}|${item.time}`;
    if (row.dataset.renderSig !== sig) {
      row.dataset.renderSig = sig;
      const [tBg, tColor] = TAG_COLORS[item.tag] || TAG_COLORS['已就绪'];
      row.innerHTML = `
        <span class="conv-item-tag" style="background:${tBg};color:${tColor};">${item.tag}</span>
        <span class="conv-item-title">${escapeHtml(item.label)}</span>
        <span class="conv-item-time">${escapeHtml(item.time)}</span>
      `;
    }
  });
}

function updateStopButton(snap) {
  const canStop = Boolean(snap.isRunning || snap.isCompacting);
  stopBtn.disabled = !canStop;
  if (!canStop && awaitingStopConfirm) {
    resetStopConfirmation();
  }
}

function renderFooterState(snap, isDoneState) {
  if (isDoneState) {
    watchdogRow.style.display = 'none';
    doneRow.style.display = 'flex';
    silenceFill.style.width = '0%';

    doneAgoText.textContent = formatRelativeFinished(snap.completedAtMs);
    doneAgoText.title = snap.completedAtClock ? `精确完成时间: ${snap.completedAtClock}` : '';
    const stepsDurStr = formatDuration(snap.stepsDurationSec, 'done');
    const waitDurStr = formatDuration(snap.thinkWaitSec, 'done');
    doneSplitText.textContent = `步骤执行 ${stepsDurStr} · 思考等待 ${waitDurStr}`;
    return;
  }

  doneRow.style.display = 'none';
  watchdogRow.style.display = 'flex';

  wakeupBtn.disabled = Boolean(snap.isCompacting);
  wakeupBtn.textContent = snap.isCompacting ? '🔒 压缩保护中' : '⚡ 立即重调';

  const silSec = snap.silenceSeconds || 0;
  if (watchdogThreshold > 0) {
    silenceLabel.textContent = `静默 ${silSec}s / ${watchdogThreshold}s`;
    const ratio = snap.isStopped ? 0 : Math.min(100, Math.round((silSec / watchdogThreshold) * 100));
    silenceFill.style.width = `${ratio}%`;
    silenceFill.style.backgroundColor = ratio >= 85 ? '#fb7185' : ratio >= 50 ? '#fbbf24' : '#38bdf8';
  } else {
    silenceLabel.textContent = `静默 ${silSec}s (仅告警)`;
    silenceFill.style.width = '0%';
  }

  if (snap.isCompacting) {
    watchdogNote.style.display = 'inline';
    watchdogNote.textContent = '防打断已锁定';
  } else {
    watchdogNote.style.display = 'none';
  }
}
