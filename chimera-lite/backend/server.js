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
    return res.json({ active: false });
  }
  res.json({ active: true, podId: activeSession.podId, endpoint: activeSession.endpoint });
});

// POST /start — provision GPU pod
app.post('/start', requireToken, async (req, res) => {
  if (activeSession) {
    return res.status(409).json({ error: 'Session already active', endpoint: activeSession.endpoint });
  }

  try {
    const pod = await startPod();
    const podId = pod.id;

    // Poll until the pod is running and we have a public port
    const endpoint = await pollForEndpoint(podId);

    // Wait for the inference server to finish bootstrapping
    await waitForInferenceServer(endpoint);

    // Safety timeout — kill pod after 3 hours even if client crashes
    const timeoutHandle = setTimeout(async () => {
      console.log('Session timeout — terminating pod', podId);
      await stopPod(podId).catch(console.error);
      activeSession = null;
    }, config.SESSION_TIMEOUT_MS);

    activeSession = { podId, endpoint, timeoutHandle };

    // If a face was uploaded before start, forward it now
    if (uploadedFaceBuffer) {
      await forwardFaceToGpu(endpoint, uploadedFaceBuffer).catch(console.error);
    }

    res.json({ ok: true, podId, endpoint });
  } catch (err) {
    console.error('Failed to start pod:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /stop — destroy GPU pod
app.post('/stop', requireToken, async (req, res) => {
  if (!activeSession) {
    return res.status(404).json({ error: 'No active session' });
  }

  const { podId, timeoutHandle } = activeSession;
  clearTimeout(timeoutHandle);
  activeSession = null;

  try {
    await stopPod(podId);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to stop pod:', err.message);
    res.status(500).json({ error: err.message });
  }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Start ---
app.listen(config.PORT, () => {
  console.log(`Chimera Lite backend running on port ${config.PORT}`);
});
