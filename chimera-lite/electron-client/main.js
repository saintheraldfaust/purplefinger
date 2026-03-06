const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || 'kdieoqwiasmsoalkw';

const headers = { 'x-api-token': API_TOKEN };

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 900,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

ipcMain.handle('upload-face', async (_event, buffer, filename) => {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('face', Buffer.from(buffer), { filename, contentType: 'image/jpeg' });
  const res = await axios.post(`${BACKEND_URL}/upload-face`, form, {
    headers: { ...headers, ...form.getHeaders() },
  });
  return res.data;
});
