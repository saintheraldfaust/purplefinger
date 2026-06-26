const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const dotenv = require('dotenv');

// ---------------------------------------------------------------------------
// Purplefinger client (open-source, bring-your-own-GPU).
//
// The client connects DIRECTLY to a GPU inference node you run yourself
// (see gpu-node/). You provide its URL (e.g. ws://127.0.0.1:8765). There is no
// hosted backend, no accounts, and no license keys.
//
// The renderer talks to the GPU node over a WebSocket (ws://host:port/ws) for
// frames, and this main process forwards the source face + quality profile to
// the node's REST endpoints (/set-face, /set-mode, /health).
// ---------------------------------------------------------------------------

function resolveUserEnvPath() {
  return path.join(app.getPath('userData'), '.env');
}

const envCandidates = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

function resolveWritableEnvPath() {
  return resolveUserEnvPath();
}

function normalizePort(value, fallback = 7891) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 && port < 65536 ? Math.round(port) : fallback;
}

// Accepts ws://host:port, wss://, http(s)://host:port, or a bare host:port.
// Returns { host, port, wsUrl, httpBase } or null if it can't be parsed.
function parseGpuUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const stripped = value.replace(/^(wss?|https?):\/\//i, '').replace(/\/+$/, '');
  const secure = /^(wss|https):\/\//i.test(value);
  const [host, portStr] = stripped.split(':');
  if (!host) return null;
  const port = normalizePort(portStr, 8765);
  return {
    host,
    port,
    wsUrl: `${secure ? 'wss' : 'ws'}://${host}:${port}`,
    httpBase: `${secure ? 'https' : 'http'}://${host}:${port}`,
  };
}

function formatGpuError(err, fallback = 'Request failed') {
  const responseError = err?.response?.data?.error;
  return String(responseError || err?.message || fallback).trim() || fallback;
}

let appConfig = {
  // Accept legacy BACKEND_URL as the GPU URL so old .env files still work.
  gpuUrl: String(process.env.GPU_URL || process.env.BACKEND_URL || '').trim(),
  obsPort: normalizePort(process.env.OBS_PORT, 7891),
};

// Last quality/stream profile chosen in the UI (kept locally; also pushed to GPU).
let currentProfile = 'balanced';

function requireGpu() {
  const gpu = parseGpuUrl(appConfig.gpuUrl);
  if (!gpu) {
    throw new Error('No GPU node URL set. Open Settings and enter your GPU node URL (e.g. ws://127.0.0.1:8765).');
  }
  return gpu;
}

function validateConfig(nextConfig) {
  // The renderer's settings field is still posted as `backendUrl`; treat it as
  // the GPU URL. Prefer an explicit gpuUrl if present.
  const rawUrl = nextConfig.gpuUrl ?? nextConfig.backendUrl ?? '';
  const gpuUrl = String(rawUrl).trim();
  const obsPort = normalizePort(nextConfig.obsPort, 7891);

  if (gpuUrl && !parseGpuUrl(gpuUrl)) {
    throw new Error('GPU node URL must look like ws://host:port (e.g. ws://127.0.0.1:8765).');
  }

  return { gpuUrl, obsPort };
}

function writeConfigFile(nextConfig) {
  const envPath = resolveWritableEnvPath();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const content = [
    `GPU_URL=${nextConfig.gpuUrl || ''}`,
    `OBS_PORT=${nextConfig.obsPort}`,
    '',
  ].join('\n');
  fs.writeFileSync(envPath, content, 'utf8');
  return envPath;
}

function publicConfig() {
  return {
    gpuUrl: appConfig.gpuUrl || '',
    // Back-compat: the renderer settings field reads `backendUrl`.
    backendUrl: appConfig.gpuUrl || '',
    warmPodId: '',
    obsPort: appConfig.obsPort,
    configPath: resolveWritableEnvPath(),
    obsUrl: `http://localhost:${appConfig.obsPort}`,
  };
}

// ---------------------------------------------------------------------------
// OBS Browser Source server
// Serves a self-updating canvas page at http://localhost:7891
// Add this as a Browser Source in OBS (640x360, no audio).
// ---------------------------------------------------------------------------
const obsClients = new Set(); // active SSE connections
let obsServer = null;

function createObsServer() {
  return http.createServer((req, res) => {
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
}

function startObsServer() {
  return new Promise((resolve, reject) => {
    const server = createObsServer();
    server.once('error', reject);
    server.listen(appConfig.obsPort, '127.0.0.1', () => {
      server.removeListener('error', reject);
      obsServer = server;
      console.log(`[OBS] Browser Source ready → http://localhost:${appConfig.obsPort}`);
      console.log(`[Config] GPU node URL → ${appConfig.gpuUrl || '(not set)'}`);
      resolve();
    });
  });
}

function stopObsServer() {
  return new Promise((resolve) => {
    if (!obsServer) return resolve();
    for (const client of obsClients) {
      try { client.end(); } catch {}
    }
    obsClients.clear();
    const server = obsServer;
    obsServer = null;
    server.close(() => resolve());
  });
}

async function restartObsServer(nextPort) {
  if (nextPort === appConfig.obsPort && obsServer) return;
  await stopObsServer();
  appConfig.obsPort = nextPort;
  await startObsServer();
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#000000',
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
  // Load .env from paths that require app to be ready
  for (const envPath of [
    resolveUserEnvPath(),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(process.resourcesPath || '', '.env'),
  ]) {
    try {
      if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
    } catch (_) {}
  }
  // Re-read config after late .env files load.
  appConfig.gpuUrl = appConfig.gpuUrl || String(process.env.GPU_URL || process.env.BACKEND_URL || '').trim();
  appConfig.obsPort = normalizePort(process.env.OBS_PORT, appConfig.obsPort);

  // Allow camera access for WebRTC
  app.on('web-contents-created', (_e, contents) => {
    contents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
  });

  startObsServer()
    .then(() => createWindow())
    .catch((err) => {
      console.error('Failed to start OBS relay:', err.message);
      app.quit();
    });
});

app.on('window-all-closed', () => {
  app.quit();
});

// --- IPC: GPU node session (bring-your-own-GPU) ---

// No control plane: "status" is just whether a GPU URL is configured. The user
// drives connection with the Connect button (start-session below).
ipcMain.handle('get-status', async () => {
  const gpu = parseGpuUrl(appConfig.gpuUrl);
  return { active: false, endpoint: gpu ? { ip: gpu.host, port: gpu.port } : null, streamProfile: currentProfile };
});

// "Start" = resolve the configured GPU URL into an endpoint. No provisioning.
ipcMain.handle('start-session', async () => {
  const gpu = requireGpu();
  return {
    podId: 'byo-gpu',
    endpoint: { ip: gpu.host, port: gpu.port },
    gpuType: 'GPU',
    reused: false,
  };
});

// Readiness = the GPU node's own /health. ready once it responds ok.
ipcMain.handle('check-ready', async () => {
  let gpu;
  try { gpu = requireGpu(); } catch (err) { return { ready: false, reason: 'no_gpu_url' }; }
  try {
    const res = await axios.get(`${gpu.httpBase}/health`, { timeout: 5000 });
    if (res.data?.ok) return { ready: true };
    return { ready: false, reason: 'starting' };
  } catch (_) {
    return { ready: false, reason: 'starting' };
  }
});

// Nothing to tear down remotely — the renderer closes its own WebSocket.
ipcMain.handle('stop-session', async () => ({ ok: true }));

ipcMain.handle('get-stream-profile', async () => ({ profile: currentProfile }));

ipcMain.handle('set-stream-profile', async (_event, profile) => {
  currentProfile = String(profile || currentProfile);
  const gpu = parseGpuUrl(appConfig.gpuUrl);
  if (gpu) {
    try {
      await axios.post(`${gpu.httpBase}/set-mode`, { profile: currentProfile }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
    } catch (err) {
      throw new Error(formatGpuError(err, 'Failed to set quality on GPU node'));
    }
  }
  return { ok: true, profile: currentProfile };
});

ipcMain.handle('upload-face', async (_event, buffer, filename) => {
  const gpu = requireGpu();
  const FormData = require('form-data');
  const form = new FormData();
  form.append('face', Buffer.from(buffer), { filename, contentType: 'image/jpeg' });
  try {
    const res = await axios.post(`${gpu.httpBase}/set-face`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });
    return res.data ?? { ok: true };
  } catch (err) {
    throw new Error(formatGpuError(err, 'Failed to upload face to GPU node'));
  }
});

// --- IPC: config ---

ipcMain.handle('get-app-config', async () => publicConfig());

ipcMain.handle('save-app-config', async (_event, nextConfig) => {
  const validated = validateConfig(nextConfig || {});
  const previousPort = appConfig.obsPort;
  appConfig = { ...appConfig, ...validated };
  try {
    writeConfigFile(appConfig);
    if (validated.obsPort !== previousPort) {
      await restartObsServer(validated.obsPort);
    }
  } catch (err) {
    appConfig.obsPort = previousPort;
    throw err;
  }
  return publicConfig();
});

// --- IPC: stubs for features removed from the open-source build ---
// (Licensing, usage, notifications, warm pods, and voice/TTS were part of the
//  proprietary hosted product. Kept as inert no-ops so the existing UI doesn't
//  error; the corresponding UI is removed in the visual redesign.)
ipcMain.handle('get-license-session', async () => ({ loggedIn: true, productKey: '', user: null }));
ipcMain.handle('license-login', async () => ({ ok: true, user: null, productKey: '' }));
ipcMain.handle('license-logout', async () => ({ ok: true }));
ipcMain.handle('get-usage', async () => ({ ok: false, usage: null, requiresLogin: false }));
ipcMain.handle('get-user-notifications', async () => ({ notifications: [] }));
ipcMain.handle('mark-notification-read', async () => ({ ok: true }));
ipcMain.handle('attach-warm-pod', async () => ({ ok: true }));
ipcMain.handle('get-voices', async () => ({ voices: [] }));
ipcMain.handle('voice-convert', async () => { throw new Error('Voice conversion is not available in the open-source build.'); });
ipcMain.handle('tts-generate', async () => { throw new Error('TTS is not available in the open-source build.'); });

// --- IPC: local helpers (unchanged) ---

ipcMain.handle('open-drivers-folder', async () => {
  // DroidCam is third-party software (dev47apps); the open-source build doesn't
  // bundle its installers — open the official download page instead.
  const url = 'https://www.dev47apps.com/';
  await shell.openExternal(url);
  return { ok: true, url };
});

// Renderer sends each swapped JPEG frame as a raw ArrayBuffer; base64-encode
// here and push to OBS SSE clients.
ipcMain.on('obs-frame', (_event, data) => {
  if (obsClients.size === 0) return;
  const b64 = Buffer.from(data).toString('base64');
  const msg = `event: frame\ndata: data:image/jpeg;base64,${b64}\n\n`;
  for (const client of obsClients) {
    try { client.write(msg); } catch { obsClients.delete(client); }
  }
});

// Save recording blob to disk via native Save dialog (WebM → MP4 conversion)
ipcMain.handle('save-recording', async (_event, buffer) => {
  const { dialog } = require('electron');
  const { execFile } = require('child_process');
  const os = require('os');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = `purplefinger-recording-${timestamp}.mp4`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Recording',
    defaultPath: defaultName,
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
      { name: 'WebM Video', extensions: ['webm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };

  const savePath = result.filePath;
  const wantsMP4 = savePath.toLowerCase().endsWith('.mp4');

  if (!wantsMP4) {
    fs.writeFileSync(savePath, Buffer.from(buffer));
    return { ok: true, path: savePath };
  }

  const tmpWebm = path.join(os.tmpdir(), `purplefinger-rec-${Date.now()}.webm`);
  fs.writeFileSync(tmpWebm, Buffer.from(buffer));

  let ffmpegPath;
  try {
    ffmpegPath = require('ffmpeg-static');
  } catch (_) {
    fs.renameSync(tmpWebm, savePath.replace(/\.mp4$/i, '.webm'));
    return { ok: true, path: savePath.replace(/\.mp4$/i, '.webm'), note: 'ffmpeg not found, saved as WebM' };
  }

  return new Promise((resolve) => {
    execFile(ffmpegPath, [
      '-y',
      '-i', tmpWebm,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      savePath,
    ], { timeout: 120000 }, (err) => {
      try { fs.unlinkSync(tmpWebm); } catch (_) {}
      if (err) {
        console.error('[Rec] ffmpeg error:', err.message);
        const fallback = savePath.replace(/\.mp4$/i, '.webm');
        try {
          fs.writeFileSync(fallback, Buffer.from(buffer));
          resolve({ ok: true, path: fallback, note: 'ffmpeg failed, saved as WebM' });
        } catch (e2) {
          resolve({ ok: false, error: e2.message });
        }
        return;
      }
      resolve({ ok: true, path: savePath });
    });
  });
});

ipcMain.handle('open-file', async (_event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  try {
    await shell.openExternal(String(url || ''));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
