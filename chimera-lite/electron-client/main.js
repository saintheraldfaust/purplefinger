const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'kdieoqwiasmsoalkw';
const OBS_PORT = 7891;

const headers = { 'x-api-token': API_TOKEN };

// ---------------------------------------------------------------------------
// OBS Browser Source server
// Serves a self-updating canvas page at http://localhost:7891
// Add this as a Browser Source in OBS (640x360, no audio).
// OBS captures your real mic separately — no audio processing needed here.
// ---------------------------------------------------------------------------
const obsClients = new Set(); // active SSE connections

const obsServer = http.createServer((req, res) => {
  if (req.url === '/stream') {
    // SSE endpoint — OBS page connects here to receive JPEG data-URLs
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n'); // initial ping
    obsClients.add(res);
    req.on('close', () => obsClients.delete(res));
    return;
  }

  // Root — serve the canvas page OBS loads
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; background:#000; }
  canvas { display:block; width:100vw; height:100vh; object-fit:contain; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const es = new EventSource('/stream');
es.addEventListener('frame', (e) => {
  const img = new Image();
  img.onload = () => {
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
  };
  img.src = e.data;
});
</script>
</body>
</html>`);
});

obsServer.listen(OBS_PORT, '127.0.0.1', () => {
  console.log(`[OBS] Browser Source ready → http://localhost:${OBS_PORT}`);
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: '#050816',
    fullscreen: true,
    fullscreenable: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Allow camera access for WebRTC
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  // Auto-stop session when app closes
  axios.post(`${BACKEND_URL}/stop`, {}, { headers }).catch(() => {});
  app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('get-status', async () => {
  const res = await axios.get(`${BACKEND_URL}/status`, { headers });
  return res.data;
});

ipcMain.handle('start-session', async () => {
  const res = await axios.post(`${BACKEND_URL}/start`, {}, { headers, timeout: 10 * 60 * 1000 });
  return res.data;
});

ipcMain.handle('check-ready', async () => {
  const res = await axios.get(`${BACKEND_URL}/ready`, { headers, timeout: 5000 });
  return res.data;
});

ipcMain.handle('stop-session', async () => {
  const res = await axios.post(`${BACKEND_URL}/stop`, {}, { headers });
  return res.data;
});

ipcMain.handle('get-stream-profile', async () => {
  const res = await axios.get(`${BACKEND_URL}/stream-profile`, { headers });
  return res.data;
});

ipcMain.handle('set-stream-profile', async (_event, profile) => {
  const res = await axios.post(`${BACKEND_URL}/stream-profile`, { profile }, { headers });
  return res.data;
});

ipcMain.handle('upload-face', async (_event, buffer, filename) => {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('face', Buffer.from(buffer), { filename, contentType: 'image/jpeg' });
  const res = await axios.post(`${BACKEND_URL}/upload-face`, form, {
    headers: { ...headers, ...form.getHeaders() },
  });
  return res.data;
});

// Renderer sends each swapped JPEG blob as a data-URL; we push it to OBS clients
ipcMain.on('obs-frame', (_event, dataUrl) => {
  if (obsClients.size === 0) return;
  const msg = `event: frame\ndata: ${dataUrl}\n\n`;
  for (const client of obsClients) {
    try { client.write(msg); } catch { obsClients.delete(client); }
  }
});
