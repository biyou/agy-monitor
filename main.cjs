const fs = require('fs');
const path = require('path');
const { electron, PORT, runtimeState, createTrayPngBuffer } = require('./server/config-state.cjs');
const { getCurrentSnapshot, triggerWakeup, stopRunningTask } = require('./server/actions.cjs');
const { startHttpServer } = require('./server/http-server.cjs');

// Launch Electron frameless always-on-top window + Dynamic System Tray
if (electron && electron.app) {
  const { app, BrowserWindow, screen, Tray, Menu, nativeImage, Notification } = electron;
  let mainWindow = null;
  let tray = null;
  let isAlwaysOnTop = true;
  let isGhostOpacity = false;
  let lastTrayIconState = '';
  let lastTaskRunningState = null;
  let lastNotifiedStallConv = '';

  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenW } = primaryDisplay.workAreaSize;
      const winW = 520;
      const winH = 400;

      // Pre-build 5 state icons for the System Tray
      const trayIcons = {
        running: nativeImage.createFromBuffer(createTrayPngBuffer([34, 211, 238], [56, 189, 248])),
        compacting: nativeImage.createFromBuffer(createTrayPngBuffer([192, 132, 252], [168, 85, 247])),
        stalled: nativeImage.createFromBuffer(createTrayPngBuffer([245, 158, 11], [251, 191, 36])),
        error: nativeImage.createFromBuffer(createTrayPngBuffer([244, 63, 94], [251, 113, 133])),
        idle: nativeImage.createFromBuffer(createTrayPngBuffer([100, 116, 139], [16, 185, 129]))
      };

      const toggleWindowVisible = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      };

      const syncTrayWithSnapshot = snap => {
        if (!tray) return;
        let iconKey = 'idle';
        let stateLabel = '已就绪';
        if (snap.isStopped || snap.state === 'error') {
          iconKey = 'error';
          stateLabel = snap.isStopped ? '已停止' : '异常';
        } else if (snap.isCompacting) {
          iconKey = 'compacting';
          stateLabel = 'Compacting';
        } else if (snap.isRunning && snap.silenceSeconds >= 45) {
          iconKey = 'stalled';
          stateLabel = `疑似卡顿 ${snap.silenceSeconds}s`;
        } else if (snap.isRunning) {
          iconKey = 'running';
          stateLabel = '运行中';
        }

        if (iconKey !== lastTrayIconState) {
          lastTrayIconState = iconKey;
          tray.setImage(trayIcons[iconKey] || trayIcons.idle);
          rebuildTrayMenu(snap);
        }

        const m = Math.floor((snap.elapsedSeconds || 0) / 60);
        const s = (snap.elapsedSeconds || 0) % 60;
        const timeStr = m > 0 ? `${m}m ${s}s` : `${s}s`;
        const ctxTokK = Math.round(((snap.context && snap.context.currentTokens) || snap.estimatedContextTokens || 0) / 1000);
        const ctxPct = (snap.context && snap.context.usagePct) || 0;
        tray.setToolTip(
          `Antigravity 监控 · ${stateLabel} (${snap.overallProgress}%)\n任务: ${snap.title}\n当前: ${snap.activeStageTitle}\n上下文: ${ctxTokK}k / 256k (${ctxPct}%) · 耗时: ${timeStr}`
        );

        // Send Windows native notification on completion or severe stall when window is hidden
        if (Notification.isSupported()) {
          if (lastTaskRunningState === true && !snap.isRunning && !snap.isStopped) {
            if (mainWindow && !mainWindow.isVisible()) {
              new Notification({
                title: 'Antigravity 任务已完成 (100%)',
                body: `${snap.title}\n总耗时: ${timeStr}`
              }).show();
            }
          }
          if (snap.isRunning && !snap.isCompacting && snap.silenceSeconds >= 120) {
            const stallKey = `${snap.convId}:${Math.floor(snap.silenceSeconds / 120)}`;
            if (stallKey !== lastNotifiedStallConv) {
              lastNotifiedStallConv = stallKey;
              new Notification({
                title: 'Antigravity 任务疑似卡顿告警',
                body: `${snap.activeStageTitle}\n已连续 ${snap.silenceSeconds}s 无输出，正在执行看门狗唤醒`
              }).show();
            }
          }
        }
        lastTaskRunningState = Boolean(snap.isRunning || snap.isCompacting);
      };

      const rebuildTrayMenu = snap => {
        if (!tray) return;
        const canStopOrWake = Boolean(snap && (snap.isRunning || snap.isCompacting));
        const contextMenu = Menu.buildFromTemplate([
          {
            label: mainWindow && mainWindow.isVisible() ? '隐藏监控浮窗' : '显示监控浮窗',
            click: () => {
              toggleWindowVisible();
              rebuildTrayMenu(snap);
            }
          },
          {
            label: '窗口始终置顶',
            type: 'checkbox',
            checked: isAlwaysOnTop,
            click: item => {
              isAlwaysOnTop = item.checked;
              if (mainWindow) mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
            }
          },
          {
            label: '半透明点击穿透模式 (防遮挡)',
            type: 'checkbox',
            checked: isGhostOpacity,
            click: item => {
              isGhostOpacity = item.checked;
              runtimeState.isClickThrough = isGhostOpacity;
              if (mainWindow) {
                mainWindow.setOpacity(isGhostOpacity ? 0.62 : 1.0);
                mainWindow.setIgnoreMouseEvents(isGhostOpacity, { forward: true });
              }
            }
          },
          { type: 'separator' },
          {
            label: '立即唤醒重调当前任务',
            enabled: !snap?.isCompacting,
            click: () => {
              const cur = getCurrentSnapshot();
              triggerWakeup(cur.convId, '系统托盘手动触发唤醒');
              if (mainWindow) mainWindow.show();
            }
          },
          { type: 'separator' },
          {
            label: '停止当前运行任务',
            enabled: canStopOrWake,
            click: () => {
              const cur = getCurrentSnapshot();
              stopRunningTask(cur.convId);
              if (mainWindow) mainWindow.show();
            }
          },
          {
            label: '退出监控程序',
            click: () => {
              app.exit(0);
            }
          }
        ]);
        tray.setContextMenu(contextMenu);
      };

      let hasShownFirstHideTip = false;
      startHttpServer({
        onResize: (newW, newH) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            const [curW, curH] = mainWindow.getContentSize();
            if (curW === newW && curH === newH) return;
            const [curX, curY] = mainWindow.getPosition();
            mainWindow.setContentSize(newW, newH, false);
            mainWindow.setPosition(curX, curY);
          }
        },
        onHideToTray: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.hide();
            rebuildTrayMenu(getCurrentSnapshot());
            if (!hasShownFirstHideTip) {
              hasShownFirstHideTip = true;
              if (Notification.isSupported()) {
                new Notification({
                  title: '监控浮窗已隐藏到系统托盘',
                  body: '左键单击右下角托盘图标即可随时恢复显示，右键可彻底退出程序。'
                }).show();
              }
            }
          }
        },
        onStatusSnapshot: snap => {
          syncTrayWithSnapshot(snap);
        }
      });

      mainWindow = new BrowserWindow({
        width: winW,
        height: winH,
        x: Math.max(20, screenW - winW - 24),
        y: 32,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

      // Hot-reload frontend automatically when index.html, css/*, or js/* are modified
      let reloadTimer = null;
      const scheduleReload = () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reloadIgnoringCache();
          }
        }, 350);
      };
      for (const watchTarget of ['', 'css', 'js']) {
        const dirPath = path.join(__dirname, watchTarget);
        if (fs.existsSync(dirPath)) {
          fs.watch(dirPath, (_eventType, filename) => {
            if (filename && /\.(html|css|js)$/i.test(filename)) {
              scheduleReload();
            }
          });
        }
      }

      tray = new Tray(trayIcons.idle);
      rebuildTrayMenu(getCurrentSnapshot());

      tray.on('click', () => {
        toggleWindowVisible();
        rebuildTrayMenu(getCurrentSnapshot());
      });
      tray.on('double-click', () => {
        if (mainWindow) {
          isGhostOpacity = false;
          runtimeState.isClickThrough = false;
          mainWindow.setOpacity(1.0);
          mainWindow.setIgnoreMouseEvents(false);
          mainWindow.show();
          mainWindow.focus();
          rebuildTrayMenu(getCurrentSnapshot());
        }
      });
    });
  }
} else {
  startHttpServer(null);
}
