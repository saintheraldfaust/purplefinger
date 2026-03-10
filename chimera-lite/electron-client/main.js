const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const http = require('http');
const dotenv = require('dotenv');

function resolveUserEnvPath() {
  return path.join(app.getPath('userData'), '.env');
}

const envCandidates = [
  resolveUserEnvPath(),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '.env'),
  path.join(path.dirname(app.getPath('exe')), '.env'),
  path.join(process.resourcesPath, '.env'),
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

function resolveWritableEnvPath() {
  return resolveUserEnvPath();
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizePort(value, fallback = 7891) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 && port < 65536 ? Math.round(port) : fallback;
}

let appConfig = {
  backendUrl: normalizeBaseUrl(process.env.BACKEND_URL || 'https://purplefinger-chimera.onrender.com'),
  apiToken: String(process.env.API_TOKEN || '').trim(),
  obsPort: normalizePort(process.env.OBS_PORT, 7891),
};

function getHeaders() {
  return { 'x-api-token': appConfig.apiToken };
}

function ensureBackendConfig() {
  if (!appConfig.backendUrl) {
    throw new Error('Missing BACKEND_URL. Add it to electron-client/.env or beside the EXE.');
  }
  if (!appConfig.apiToken) {
    throw new Error('Missing API_TOKEN. Add it to electron-client/.env or beside the EXE.');
  }
}

function validateConfig(nextConfig) {
  const backendUrl = normalizeBaseUrl(nextConfig.backendUrl);
  const apiToken = String(nextConfig.apiToken || '').trim();
  const obsPort = normalizePort(nextConfig.obsPort, 7891);

  if (!backendUrl || !/^https?:\/\//i.test(backendUrl)) {
    throw new Error('Backend URL must start with http:// or https://');
  }
  if (!apiToken) {
    throw new Error('API token is required');
  }

  return { backendUrl, apiToken, obsPort };
}

function writeConfigFile(nextConfig) {
  const envPath = resolveWritableEnvPath();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const content = [
    `BACKEND_URL=${nextConfig.backendUrl}`,
    `API_TOKEN=${nextConfig.apiToken}`,
    `OBS_PORT=${nextConfig.obsPort}`,
    '',
  ].join('\n');
  fs.writeFileSync(envPath, content, 'utf8');
  return envPath;
}

// ---------------------------------------------------------------------------
// OBS Browser Source server
// Serves a self-updating canvas page at http://localhost:7891
// Add this as a Browser Source in OBS (640x360, no audio).
// OBS captures your real mic separately — no audio processing needed here.
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
      console.log(`[Config] Backend URL → ${appConfig.backendUrl}`);
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
    backgroundColor: '#050816',
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
  startObsServer()
    .then(() => createWindow())
    .catch((err) => {
      console.error('Failed to start OBS relay:', err.message);
      app.quit();
    });
});

app.on('window-all-closed', () => {
  // Auto-stop session when app closes
  axios.post(`${appConfig.backendUrl}/stop`, {}, { headers: getHeaders() }).catch(() => {});
  app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('get-status', async () => {
  ensureBackendConfig();
  const res = await axios.get(`${appConfig.backendUrl}/status`, { headers: getHeaders() });
  return res.data;
});

ipcMain.handle('start-session', async () => {
  ensureBackendConfig();
  const res = await axios.post(`${appConfig.backendUrl}/start`, {}, { headers: getHeaders(), timeout: 10 * 60 * 1000 });
  return res.data;
});

ipcMain.handle('check-ready', async () => {
  ensureBackendConfig();
  const res = await axios.get(`${appConfig.backendUrl}/ready`, { headers: getHeaders(), timeout: 5000 });
  return res.data;
});

ipcMain.handle('stop-session', async () => {
  ensureBackendConfig();
  const res = await axios.post(`${appConfig.backendUrl}/stop`, {}, { headers: getHeaders() });
  return res.data;
});

ipcMain.handle('get-stream-profile', async () => {
  ensureBackendConfig();
  const res = await axios.get(`${appConfig.backendUrl}/stream-profile`, { headers: getHeaders() });
  return res.data;
});

ipcMain.handle('set-stream-profile', async (_event, profile) => {
  ensureBackendConfig();
  const res = await axios.post(`${appConfig.backendUrl}/stream-profile`, { profile }, { headers: getHeaders() });
  return res.data;
});

ipcMain.handle('upload-face', async (_event, buffer, filename) => {
  ensureBackendConfig();
  const FormData = require('form-data');
  const form = new FormData();
  form.append('face', Buffer.from(buffer), { filename, contentType: 'image/jpeg' });
  const res = await axios.post(`${appConfig.backendUrl}/upload-face`, form, {
    headers: { ...getHeaders(), ...form.getHeaders() },
  });
  return res.data;
});

ipcMain.handle('get-app-config', async () => ({
  backendUrl: appConfig.backendUrl,
  apiToken: appConfig.apiToken,
  obsPort: appConfig.obsPort,
  configPath: resolveWritableEnvPath(),
  obsUrl: `http://localhost:${appConfig.obsPort}`,
}));

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

  return {
    backendUrl: appConfig.backendUrl,
    apiToken: appConfig.apiToken,
    obsPort: appConfig.obsPort,
    configPath: resolveWritableEnvPath(),
    obsUrl: `http://localhost:${appConfig.obsPort}`,
  };
});

// Renderer sends each swapped JPEG blob as a data-URL; we push it to OBS clients
ipcMain.on('obs-frame', (_event, dataUrl) => {
  if (obsClients.size === 0) return;
  const msg = `event: frame\ndata: ${dataUrl}\n\n`;
  for (const client of obsClients) {
    try { client.write(msg); } catch { obsClients.delete(client); }
  }
});
