const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { ROOT_DIR, PORT, runtimeState } = require('./config-state.cjs');
const { getCurrentSnapshot, triggerWakeup, stopRunningTask } = require('./actions.cjs');

function startHttpServer(callbacks) {
  const htmlPath = path.join(ROOT_DIR, 'index.html');
  const cssDir = path.join(ROOT_DIR, 'css');
  const jsDir = path.join(ROOT_DIR, 'js');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(fs.readFileSync(htmlPath, 'utf-8'));
      return;
    }

    if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
      const targetPath = path.normalize(path.join(ROOT_DIR, url.pathname));
      const allowedPrefix = url.pathname.startsWith('/css/')
        ? cssDir + path.sep
        : jsDir + path.sep;
      if (
        targetPath.startsWith(allowedPrefix) &&
        fs.existsSync(targetPath) &&
        fs.statSync(targetPath).isFile()
      ) {
        const ext = path.extname(targetPath).toLowerCase();
        const contentType =
          ext === '.css'
            ? 'text/css; charset=utf-8'
            : ext === '.js'
            ? 'application/javascript; charset=utf-8'
            : 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(fs.readFileSync(targetPath, 'utf-8'));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (url.pathname === '/api/status') {
      const qConv = url.searchParams.get('convId');
      if (qConv) runtimeState.selectedConvId = qConv;
      const snap = getCurrentSnapshot();
      if (callbacks && callbacks.onStatusSnapshot) {
        callbacks.onStatusSnapshot(snap);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snap));
      return;
    }

    if (url.pathname === '/api/select-conv' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (data.convId) {
            runtimeState.selectedConvId = data.convId;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, selectedConvId: runtimeState.selectedConvId }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/wakeup' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const snap = getCurrentSnapshot();
          const result = await triggerWakeup(data.convId || snap.convId, data.reason, data.forceCopy);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/stop-task' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const snap = getCurrentSnapshot();
          const result = await stopRunningTask(data.convId || snap.convId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/hide-to-tray' && req.method === 'POST') {
      if (callbacks && callbacks.onHideToTray) {
        callbacks.onHideToTray();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === '/api/resize' && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (callbacks && callbacks.onResize && data.width && data.height) {
            callbacks.onResize(Math.round(data.width), Math.round(data.height));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/open-log' && req.method === 'POST') {
      const snap = getCurrentSnapshot();
      if (snap.activeLogPath && fs.existsSync(snap.activeLogPath)) {
        exec(`notepad.exe "${snap.activeLogPath}"`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} already in use.`);
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[agy-monitor] Server listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  startHttpServer
};
