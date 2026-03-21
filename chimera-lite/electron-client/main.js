const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

function normalizePodId(value) {
  return String(value || '').trim();
}

function formatBackendError(err, fallback = 'Request failed') {
  const responseError = err?.response?.data?.error;
  const status = err?.response?.status;
  const message = String(responseError || err?.message || fallback).trim();

  if (status && responseError) {
    return `${responseError}`;
  }

  return message || fallback;
}

let appConfig = {
  backendUrl: normalizeBaseUrl(process.env.BACKEND_URL || 'https://purplefinger-chimera.onrender.com'),
  apiToken: String(process.env.API_TOKEN || '').trim(),
  licenseKey: String(process.env.LICENSE_KEY || '').trim().toUpperCase(),
  obsPort: normalizePort(process.env.OBS_PORT, 7891),
  warmPodId: normalizePodId(process.env.WARM_POD_ID || ''),
};

let licenseSessionToken = '';
let licenseSessionUser = null;

function getAuthHeaders() {
  const headers = {};
  if (appConfig.apiToken) {
    headers['x-api-token'] = appConfig.apiToken;
  }
  if (licenseSessionToken) {
    headers.authorization = `Bearer ${licenseSessionToken}`;
  }
  return headers;
}

function ensureBackendConfig() {
  if (!appConfig.backendUrl) {
    throw new Error('Missing BACKEND_URL. Add it to electron-client/.env or beside the EXE.');
  }
}

function validateConfig(nextConfig) {
  const backendUrl = normalizeBaseUrl(nextConfig.backendUrl);
  const apiToken = String(nextConfig.apiToken || '').trim();
  const licenseKey = String(nextConfig.licenseKey || '').trim().toUpperCase();
  const obsPort = normalizePort(nextConfig.obsPort, 7891);
  const warmPodId = normalizePodId(nextConfig.warmPodId || '');

  if (!backendUrl || !/^https?:\/\//i.test(backendUrl)) {
    throw new Error('Backend URL must start with http:// or https://');
  }

  return { backendUrl, apiToken, licenseKey, obsPort, warmPodId };
}

function writeConfigFile(nextConfig) {
  const envPath = resolveWritableEnvPath();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  const content = [
    `BACKEND_URL=${nextConfig.backendUrl}`,
    `API_TOKEN=${nextConfig.apiToken}`,
    `LICENSE_KEY=${nextConfig.licenseKey || ''}`,
    `OBS_PORT=${nextConfig.obsPort}`,
    `WARM_POD_ID=${nextConfig.warmPodId || ''}`,
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
  axios.post(`${appConfig.backendUrl}/stop`, {}, { headers: getAuthHeaders() }).catch(() => {});
  app.quit();
});

// --- IPC Handlers ---

ipcMain.handle('get-status', async () => {
  ensureBackendConfig();
  try {
    const res = await axios.get(`${appConfig.backendUrl}/status`, { headers: getAuthHeaders() });
    return res.data;
  } catch (err) {
    throw new Error(formatBackendError(err, 'Failed to get status'));
  }
});

ipcMain.handle('start-session', async () => {
  ensureBackendConfig();
  try {
    const res = await axios.post(
      `${appConfig.backendUrl}/start`,
      {},
      { headers: getAuthHeaders(), timeout: 30 * 60 * 1000 },
    );
    return res.data;
  } catch (err) {
    throw new Error(formatBackendError(err, 'Failed to start session'));
  }
});

ipcMain.handle('check-ready', async () => {
  ensureBackendConfig();
  try {
    const res = await axios.get(`${appConfig.backendUrl}/ready`, { headers: getAuthHeaders(), timeout: 5000 });
    return res.data;
  } catch (err) {
    throw new Error(formatBackendError(err, 'Failed to check readiness'));
  }
});

ipcMain.handle('stop-session', async () => {
  ensureBackendConfig();
  try {
    const res = await axios.post(`${appConfig.backendUrl}/stop`, {}, { headers: getAuthHeaders(), timeout: 120000 });
    return res.data;
  } catch (err) {
    throw new Error(formatBackendError(err, 'Failed to stop session'));
  }
});

ipcMain.handle('get-stream-profile', async () => {
  ensureBackendConfig();
  const res = await axios.get(`${appConfig.backendUrl}/stream-profile`, { headers: getAuthHeaders() });
  return res.data;
});

ipcMain.handle('set-stream-profile', async (_event, profile) => {
  ensureBackendConfig();
  const res = await axios.post(`${appConfig.backendUrl}/stream-profile`, { profile }, { headers: getAuthHeaders() });
  return res.data;
});

ipcMain.handle('upload-face', async (_event, buffer, filename) => {
  ensureBackendConfig();
  const FormData = require('form-data');
  const form = new FormData();
  form.append('face', Buffer.from(buffer), { filename, contentType: 'image/jpeg' });
  const res = await axios.post(`${appConfig.backendUrl}/upload-face`, form, {
    headers: { ...getAuthHeaders(), ...form.getHeaders() },
  });
  return res.data;
});

ipcMain.handle('license-login', async (_event, inputProductKey) => {
  ensureBackendConfig();
  const productKey = String(inputProductKey || appConfig.licenseKey || '').trim().toUpperCase();
  if (!productKey) {
    throw new Error('Product key is required');
  }

  const res = await axios.post(`${appConfig.backendUrl}/auth/product-login`, { productKey }, {
    headers: { 'Content-Type': 'application/json', ...(appConfig.apiToken ? { 'x-api-token': appConfig.apiToken } : {}) },
    timeout: 10000,
  });

  licenseSessionToken = String(res.data?.token || '').trim();
  licenseSessionUser = res.data?.user || null;
  appConfig.licenseKey = productKey;

  // Auto-fill API token from backend so user never has to enter it
  if (res.data?.apiToken) {
    appConfig.apiToken = String(res.data.apiToken).trim();
  }
  writeConfigFile(appConfig);

  return {
    ok: true,
    user: licenseSessionUser,
    productKey: appConfig.licenseKey,
  };
});

ipcMain.handle('license-logout', async () => {
  ensureBackendConfig();
  if (licenseSessionToken) {
    try {
      await axios.post(`${appConfig.backendUrl}/auth/product-logout`, {}, {
        headers: { authorization: `Bearer ${licenseSessionToken}` },
        timeout: 5000,
      });
    } catch (_) {}
  }
  licenseSessionToken = '';
  licenseSessionUser = null;
  return { ok: true };
});

ipcMain.handle('get-license-session', async () => ({
  loggedIn: !!licenseSessionToken,
  productKey: appConfig.licenseKey || '',
  user: licenseSessionUser,
}));

ipcMain.handle('get-user-notifications', async (_event, includeRead = false) => {
  ensureBackendConfig();
  if (!licenseSessionToken) {
    throw new Error('Please log in with your product key first');
  }
  const res = await axios.get(`${appConfig.backendUrl}/me/notifications`, {
    headers: { authorization: `Bearer ${licenseSessionToken}` },
    params: { includeRead: !!includeRead, limit: 100 },
  });
  return res.data;
});

ipcMain.handle('mark-notification-read', async (_event, notificationId) => {
  ensureBackendConfig();
  if (!licenseSessionToken) {
    throw new Error('Please log in with your product key first');
  }
  const id = String(notificationId || '').trim();
  if (!id) throw new Error('notificationId is required');

  const res = await axios.post(`${appConfig.backendUrl}/me/notifications/${id}/read`, {}, {
    headers: { authorization: `Bearer ${licenseSessionToken}` },
  });
  return res.data;
});

ipcMain.handle('get-app-config', async () => ({
  backendUrl: appConfig.backendUrl,
  apiToken: appConfig.apiToken,
  licenseKey: appConfig.licenseKey || '',
  obsPort: appConfig.obsPort,
  warmPodId: appConfig.warmPodId,
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
    licenseKey: appConfig.licenseKey || '',
    obsPort: appConfig.obsPort,
    warmPodId: appConfig.warmPodId,
    configPath: resolveWritableEnvPath(),
    obsUrl: `http://localhost:${appConfig.obsPort}`,
  };
});

ipcMain.handle('attach-warm-pod', async (_event, podId) => {
  ensureBackendConfig();
  const normalizedPodId = normalizePodId(podId);
  if (!normalizedPodId) {
    throw new Error('Pod ID is required');
  }

  let res;
  try {
    res = await axios.post(
      `${appConfig.backendUrl}/attach-pod`,
      { podId: normalizedPodId },
      { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, timeout: 30000 },
    );
  } catch (err) {
    throw new Error(formatBackendError(err, 'Failed to attach warm pod'));
  }

  appConfig.warmPodId = normalizedPodId;
  writeConfigFile(appConfig);

  return res.data;
});

// Open the bundled DroidCam drivers folder in system file explorer
ipcMain.handle('open-drivers-folder', async () => {
  // In dev: droidcamdrivers is in __dirname.  In prod: it's in process.resourcesPath.
  const candidates = [
    path.join(process.resourcesPath, 'droidcamdrivers'),
    path.join(__dirname, 'droidcamdrivers'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return { ok: true, path: dir };
    }
  }
  throw new Error('DroidCam drivers folder not found. Reinstall the app.');
});

// Renderer sends each swapped JPEG frame as a raw ArrayBuffer.
// We base64-encode here (Node.js Buffer is faster than renderer FileReader) and push to OBS SSE clients.
ipcMain.on('obs-frame', (_event, data) => {
  if (obsClients.size === 0) return;
  const b64 = Buffer.from(data).toString('base64');
  const msg = `event: frame\ndata: data:image/jpeg;base64,${b64}\n\n`;
  for (const client of obsClients) {
    try { client.write(msg); } catch { obsClients.delete(client); }
  }
});
