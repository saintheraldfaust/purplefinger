const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { startPod, stopPod, getPodStatus, extractEndpoint } = require('./gpuProvider');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const sessionStatePath = path.resolve(process.cwd(), config.SESSION_STATE_FILE);

// --- Session State ---
let activeSession = null; // { podId, endpoint: { ip, port }, timeoutHandle }
let uploadedFaceBuffer = null;
let streamProfile = 'realtime';
let stopInFlight = null;

function normalizeGpuType(value) {
  const normalized = String(value || '').trim();
  if (config.RUNPOD_ALLOWED_GPU_TYPES.includes(normalized)) {
    return normalized;
  }
  return config.RUNPOD_GPU_TYPE;
}

function formatStartError(err, gpuType) {
  const message = String(err?.message || 'Failed to start pod').trim();
  if (/no longer any instances available/i.test(message)) {
    return `RunPod has no capacity for ${gpuType} right now. Try the other GPU type or wait and retry.`;
  }
  return message;
}

async function waitForStopInFlight() {
  if (!stopInFlight) return;
  try {
    await stopInFlight;
  } catch (_) {}
}

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
app.get('/status', requireToken, async (req, res) => {
  const session = await getOrRecoverActiveSession();
  if (!session) {
    return res.json({ active: false, streamProfile });
  }
  res.json({ active: true, podId: session.podId, endpoint: session.endpoint, streamProfile, reused: true });
});

// POST /start — provision GPU pod
app.post('/start', requireToken, async (req, res) => {
  try {
    await waitForStopInFlight();

    const existingSession = await getOrRecoverActiveSession();
    if (existingSession) {
      return res.json({ ok: true, reused: true, podId: existingSession.podId, endpoint: existingSession.endpoint });
    }

    const gpuType = normalizeGpuType(req.body?.gpuType);
    const pod = await startPod(gpuType);
    const podId = pod.id;

    // Poll until the pod is running and we have a public port (~1-2 min)
    const endpoint = await pollForEndpoint(podId);

    setActiveSession({ podId, endpoint, serverReady: false });

    // Return endpoint immediately — client can show progress while server boots.
    // Inference server readiness check runs in background.
    res.json({ ok: true, podId, endpoint, gpuType });

    // Background: wait for inference server then forward face if needed
    ensureServerReadyBackground(activeSession);

  } catch (err) {
    console.error('Failed to start pod:', err.message);
    res.status(500).json({ error: formatStartError(err, normalizeGpuType(req.body?.gpuType)) });
  }
});

// POST /attach-pod — adopt an already-running pod as the managed warm pod
app.post('/attach-pod', requireToken, async (req, res) => {
  const podId = String(req.body?.podId || '').trim();
  if (!podId) {
    return res.status(400).json({ error: 'podId is required' });
  }

  try {
    const session = await adoptExistingPod(podId, { persistWarmPodId: true });
    if (!session) {
      return res.status(404).json({ error: 'Pod is not reachable on port 8765' });
    }
    res.json({ ok: true, podId: session.podId, endpoint: session.endpoint, attached: true });
  } catch (err) {
    console.error('Failed to attach pod:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /ready — is the inference server actually accepting connections?
app.get('/ready', requireToken, async (req, res) => {
  const session = await getOrRecoverActiveSession();
  if (!session) return res.json({ ready: false, reason: 'no_session' });
  if (session.serverReady) return res.json({ ready: true, reused: true });
  // Do a live check in case the background task already finished
  const url = `http://${session.endpoint.ip}:${session.endpoint.port}/health`;
  try {
    const r = await axios.get(url, { timeout: 3000 });
    if (r.data.ok) {
      session.serverReady = true;
      saveSessionState(session);
      // Forward face now if it was uploaded before server was ready
      if (uploadedFaceBuffer) {
        forwardFaceToGpu(session.endpoint, uploadedFaceBuffer).catch(console.error);
      }
      forwardProfileToGpu(session.endpoint, streamProfile).catch(console.error);
      return res.json({ ready: true, reused: true });
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

  const session = await getOrRecoverActiveSession();
  if (session && session.serverReady) {
    try {
      await forwardProfileToGpu(session.endpoint, streamProfile);
    } catch (err) {
      console.error('Failed to forward stream profile to GPU:', err.message);
      return res.status(502).json({ error: 'Stored locally but failed to forward to GPU' });
    }
  }

  res.json({ ok: true, profile: streamProfile, forwarded: !!(session && session.serverReady) });
});

// POST /stop — destroy GPU pod
app.post('/stop', requireToken, async (req, res) => {
  await waitForStopInFlight();

  const session = await getOrRecoverActiveSession();
  if (!session) {
    return res.status(404).json({ error: 'No active session' });
  }

  const { podId } = session;
  clearActiveSession();

  const stopPromise = stopPod(podId)
    .catch(err => {
      console.error('Failed to terminate pod (may already be gone):', err.message);
      throw err;
    })
    .finally(() => {
      if (stopInFlight === stopPromise) {
        stopInFlight = null;
      }
    });

  stopInFlight = stopPromise;

  try {
    await stopPromise;
    res.json({ ok: true, podId });
  } catch (err) {
    res.status(502).json({ error: `Failed to terminate pod ${podId}: ${err.message}` });
  }
});

// POST /upload-face — store face image and forward to GPU if running
app.post('/upload-face', requireToken, upload.single('face'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  uploadedFaceBuffer = req.file.buffer;

  const session = await getOrRecoverActiveSession();
  if (session && session.serverReady) {
    try {
      await forwardFaceToGpu(session.endpoint, uploadedFaceBuffer);
    } catch (err) {
      console.error('Failed to forward face to GPU:', err.message);
      return res.status(502).json({ error: 'Stored locally but failed to forward to GPU' });
    }
  }

  res.json({ ok: true, forwarded: !!(session && session.serverReady) });
});

// --- Helpers ---

function getSessionSnapshot(session) {
  if (!session) return null;
  return {
    podId: session.podId,
    endpoint: session.endpoint,
    serverReady: !!session.serverReady,
  };
}

function readSessionState() {
  try {
    if (!fs.existsSync(sessionStatePath)) return null;
    return JSON.parse(fs.readFileSync(sessionStatePath, 'utf8'));
  } catch (err) {
    console.error('Failed to read session state:', err.message);
    return null;
  }
}

function saveSessionState(session) {
  try {
    fs.writeFileSync(sessionStatePath, JSON.stringify(getSessionSnapshot(session), null, 2));
  } catch (err) {
    console.error('Failed to write session state:', err.message);
  }
}

function clearSessionState() {
  try {
    if (fs.existsSync(sessionStatePath)) {
      fs.unlinkSync(sessionStatePath);
    }
  } catch (err) {
    console.error('Failed to clear session state:', err.message);
  }
}

function scheduleSessionTimeout(podId) {
  return setTimeout(async () => {
    console.log('Session timeout — terminating pod', podId);
    await stopPod(podId).catch(console.error);
    if (activeSession?.podId === podId) {
      clearActiveSession();
    }
  }, config.SESSION_TIMEOUT_MS);
}

function setActiveSession(session) {
  if (activeSession?.timeoutHandle) {
    clearTimeout(activeSession.timeoutHandle);
  }
  activeSession = {
    ...session,
    serverReady: !!session.serverReady,
    timeoutHandle: scheduleSessionTimeout(session.podId),
  };
  saveSessionState(activeSession);
  return activeSession;
}

function clearActiveSession() {
  if (activeSession?.timeoutHandle) {
    clearTimeout(activeSession.timeoutHandle);
  }
  activeSession = null;
  clearSessionState();
}

async function adoptExistingPod(podId, options = {}) {
  const pod = await getPodStatus(podId);
  const endpoint = extractEndpoint(pod);
  const desiredStatus = String(pod?.desiredStatus || '').toUpperCase();
  if (!endpoint || ['EXITED', 'FAILED', 'TERMINATED'].includes(desiredStatus)) {
    return null;
  }

  const session = setActiveSession({ podId, endpoint, serverReady: false });
  if (options.persistWarmPodId) {
    console.log(`Warm pod attached manually: ${podId}`);
  } else {
    console.log(`Warm pod recovered: ${podId}`);
  }
  ensureServerReadyBackground(session);
  return session;
}

async function verifySessionStillLive(session) {
  try {
    const pod = await getPodStatus(session.podId);
    const endpoint = extractEndpoint(pod);
    const desiredStatus = String(pod?.desiredStatus || '').toUpperCase();
    if (!endpoint || ['EXITED', 'FAILED', 'TERMINATED'].includes(desiredStatus)) {
      clearActiveSession();
      return null;
    }

    session.endpoint = endpoint;
    saveSessionState(session);
    return session;
  } catch (err) {
    console.error('Failed to verify session state:', err.message);
    clearActiveSession();
    return null;
  }
}

async function getOrRecoverActiveSession() {
  if (activeSession) {
    return verifySessionStillLive(activeSession);
  }

  const persistedSession = readSessionState();
  const candidatePodIds = [persistedSession?.podId, config.RUNPOD_WARM_POD_ID].filter(Boolean);
  for (const podId of [...new Set(candidatePodIds)]) {
    try {
      const session = await adoptExistingPod(podId);
      if (session) return session;
    } catch (err) {
      console.error(`Failed to recover warm pod ${podId}:`, err.message);
    }
  }

  clearSessionState();
  return null;
}

function ensureServerReadyBackground(session) {
  const { podId, endpoint } = session;
  waitForInferenceServer(endpoint)
    .then(async () => {
      if (!activeSession || activeSession.podId !== podId) return;
      activeSession.serverReady = true;
      saveSessionState(activeSession);
      console.log('Inference server ready.');
      await forwardProfileToGpu(endpoint, streamProfile).catch(console.error);
      if (uploadedFaceBuffer) {
        await forwardFaceToGpu(endpoint, uploadedFaceBuffer).catch(console.error);
      }
    })
    .catch(err => console.error('Inference server never became ready:', err.message));
}

async function pollForEndpoint(podId, maxWaitMs = 30 * 60 * 1000, intervalMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const pod = await getPodStatus(podId);
    const endpoint = extractEndpoint(pod);
    if (endpoint) return endpoint;
  }
  throw new Error('Pod did not become ready in time');
}

async function waitForInferenceServer(endpoint, maxWaitMs = 25 * 60 * 1000, intervalMs = 10000) {
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
    timeout: 60000,
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
  getOrRecoverActiveSession().catch(err => console.error('Warm pod recovery failed:', err.message));
});
