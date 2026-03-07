const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');
const { startPod, stopPod, getPodStatus, extractEndpoint } = require('./gpuProvider');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// --- Session State ---
let activeSession = null; // { podId, endpoint: { ip, port }, timeoutHandle }
let uploadedFaceBuffer = null;
let streamProfile = 'realtime';

// --- Auth Middleware ---
function requireToken(req, res, next) {
  const token = req.headers['x-api-token'];
  if (!token || token !== config.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// --- Routes ---

// Health check (no auth)
app.get('/health', (req, res) => res.json({ ok: true }));

// GET /status
app.get('/status', requireToken, (req, res) => {
  if (!activeSession) {
    return res.json({ active: false, streamProfile });
  }
  res.json({ active: true, podId: activeSession.podId, endpoint: activeSession.endpoint, streamProfile });
});

// POST /start — provision GPU pod
app.post('/start', requireToken, async (req, res) => {
  if (activeSession) {
    return res.status(409).json({ error: 'Session already active', endpoint: activeSession.endpoint });
  }

  try {
    const pod = await startPod();
    const podId = pod.id;

    // Poll until the pod is running and we have a public port (~1-2 min)
    const endpoint = await pollForEndpoint(podId);

    // Safety timeout — kill pod after 3 hours even if client crashes
    const timeoutHandle = setTimeout(async () => {
      console.log('Session timeout — terminating pod', podId);
      await stopPod(podId).catch(console.error);
      activeSession = null;
    }, config.SESSION_TIMEOUT_MS);

    activeSession = { podId, endpoint, timeoutHandle, serverReady: false };

    // Return endpoint immediately — client can show progress while server boots.
    // Inference server readiness check runs in background.
    res.json({ ok: true, podId, endpoint });

    // Background: wait for inference server then forward face if needed
    waitForInferenceServer(endpoint)
      .then(async () => {
        if (activeSession) activeSession.serverReady = true;
        console.log('Inference server ready.');
        await forwardProfileToGpu(endpoint, streamProfile).catch(console.error);
        if (uploadedFaceBuffer) {
          await forwardFaceToGpu(endpoint, uploadedFaceBuffer).catch(console.error);
        }
      })
      .catch(err => console.error('Inference server never became ready:', err.message));

  } catch (err) {
    console.error('Failed to start pod:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /ready — is the inference server actually accepting connections?
app.get('/ready', requireToken, async (req, res) => {
  if (!activeSession) return res.json({ ready: false, reason: 'no_session' });
  if (activeSession.serverReady) return res.json({ ready: true });
  // Do a live check in case the background task already finished
  const url = `http://${activeSession.endpoint.ip}:${activeSession.endpoint.port}/health`;
  try {
    const r = await axios.get(url, { timeout: 3000 });
    if (r.data.ok) {
      activeSession.serverReady = true;
      // Forward face now if it was uploaded before server was ready
      if (uploadedFaceBuffer) {
        forwardFaceToGpu(activeSession.endpoint, uploadedFaceBuffer).catch(console.error);
      }
      forwardProfileToGpu(activeSession.endpoint, streamProfile).catch(console.error);
      return res.json({ ready: true });
    }
  } catch (_) {}
  res.json({ ready: false, reason: 'starting' });
});

// GET /stream-profile
app.get('/stream-profile', requireToken, (req, res) => {
  res.json({ profile: streamProfile });
});

// POST /stream-profile
app.post('/stream-profile', requireToken, async (req, res) => {
  const profile = String(req.body?.profile || '').trim().toLowerCase();
  if (!['realtime', 'quality'].includes(profile)) {
    return res.status(400).json({ error: 'Invalid profile' });
  }

  streamProfile = profile;

  if (activeSession && activeSession.serverReady) {
    try {
      await forwardProfileToGpu(activeSession.endpoint, streamProfile);
    } catch (err) {
      console.error('Failed to forward stream profile to GPU:', err.message);
      return res.status(502).json({ error: 'Stored locally but failed to forward to GPU' });
    }
  }

  res.json({ ok: true, profile: streamProfile, forwarded: !!(activeSession && activeSession.serverReady) });
});

// POST /stop — destroy GPU pod
app.post('/stop', requireToken, async (req, res) => {
  if (!activeSession) {
    return res.status(404).json({ error: 'No active session' });
  }

  const { podId, timeoutHandle } = activeSession;
  clearTimeout(timeoutHandle);
  activeSession = null;

  res.json({ ok: true });
  stopPod(podId).catch(err => console.error('Failed to terminate pod (may already be gone):', err.message));
});

// POST /upload-face — store face image and forward to GPU if running
app.post('/upload-face', requireToken, upload.single('face'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  uploadedFaceBuffer = req.file.buffer;

  if (activeSession) {
    try {
      await forwardFaceToGpu(activeSession.endpoint, uploadedFaceBuffer);
    } catch (err) {
      console.error('Failed to forward face to GPU:', err.message);
      return res.status(502).json({ error: 'Stored locally but failed to forward to GPU' });
    }
  }

  res.json({ ok: true, forwarded: !!activeSession });
});

// --- Helpers ---

async function pollForEndpoint(podId, maxWaitMs = 20 * 60 * 1000, intervalMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const pod = await getPodStatus(podId);
    const endpoint = extractEndpoint(pod);
    if (endpoint) return endpoint;
  }
  throw new Error('Pod did not become ready in time');
}

async function waitForInferenceServer(endpoint, maxWaitMs = 15 * 60 * 1000, intervalMs = 10000) {
  const deadline = Date.now() + maxWaitMs;
  const url = `http://${endpoint.ip}:${endpoint.port}/health`;
  console.log(`Waiting for inference server at ${url}...`);
  while (Date.now() < deadline) {
    try {
      const res = await axios.get(url, { timeout: 5000 });
      if (res.data.ok) {
        console.log('Inference server ready.');
        return;
      }
    } catch (_) {}
    await sleep(intervalMs);
  }
  throw new Error('Inference server did not become ready in time');
}

async function forwardFaceToGpu(endpoint, buffer) {
  const form = new FormData();
  form.append('face', buffer, { filename: 'face.jpg', contentType: 'image/jpeg' });
  await axios.post(`http://${endpoint.ip}:${endpoint.port}/set-face`, form, {
    headers: form.getHeaders(),
    timeout: 15000,
  });
}

async function forwardProfileToGpu(endpoint, profile) {
  await axios.post(`http://${endpoint.ip}:${endpoint.port}/set-mode`, { profile }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Start ---
app.listen(config.PORT, () => {
  console.log(`Chimera Lite backend running on port ${config.PORT}`);
});
