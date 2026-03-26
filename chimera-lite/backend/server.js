const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./config');
const { LicenseStore } = require('./licenseStore');
const { startPod, stopPod, getPodStatus, extractEndpoint } = require('./gpuProvider');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const sessionStatePath = path.resolve(process.cwd(), config.SESSION_STATE_FILE);
const licenseStore = new LicenseStore({
  adminUsername: config.ADMIN_USERNAME,
  adminPassword: config.ADMIN_PASSWORD,
  userSessionTtlMs: config.LICENSE_SESSION_TTL_MS,
  adminSessionTtlMs: config.ADMIN_SESSION_TTL_MS,
});

const adminUiDir = path.join(__dirname, 'public');
app.use('/admin-app', express.static(adminUiDir));

// --- Session State ---
let activeSession = null; // { podId, endpoint: { ip, port }, timeoutHandle }
let uploadedFaceBuffer = null;
let streamProfile = 'realtime';
let stopInFlight = null;
let lastActivityAt = null;   // Date.now() of last client interaction
let idleCheckInterval = null; // interval handle for idle-pod check
const CONTACT_SAINT_H_MESSAGE = 'Your account is unavailable right now. Please contact Saint H. on WhatsApp: 09065786976.';

function formatCooldownMessage(resetAt, prefix) {
  const date = resetAt ? new Date(resetAt) : null;
  return `${prefix} Please wait until ${date ? date.toLocaleString() : 'the reset window ends'} before trying again.`;
}

async function finalizeOwnedSessionUsage(session, endedAtMs = Date.now()) {
  const ownerUserId = String(session?.ownerUserId || '').trim();
  if (!ownerUserId) return null;
  try {
    return await licenseStore.finalizeSessionUsage(ownerUserId, {
      sessionMs: config.SESSION_MAX_MS,
      cooldownMs: config.SESSION_COOLDOWN_MS,
      endedAtMs,
    });
  } catch (err) {
    console.error('Failed to finalize session usage:', err.message);
    return null;
  }
}

function formatStartError(err) {
  const message = String(err?.message || 'Failed to start pod').trim();
  if (/no longer any instances|no gpu capacity|does not have the resources|insufficient resources|out of stock/i.test(message)) {
    return 'All GPU types are at capacity right now. Please wait a minute and retry.';
  }
  return message;
}

async function waitForStopInFlight() {
  if (!stopInFlight) return;
  try {
    await stopInFlight;
  } catch (_) {}
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (!auth.toLowerCase().startsWith('bearer ')) return '';
  return auth.slice(7).trim();
}

function isValidApiToken(req) {
  const token = String(req.headers['x-api-token'] || '').trim();
  return !!(token && config.API_TOKEN && token === config.API_TOKEN);
}

// --- Auth Middleware ---
async function requireAccess(req, res, next) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    const access = await licenseStore.inspectUserSessionToken(bearerToken);
    if (access.ok) {
      req.auth = { type: 'license', user: access.user };
      return next();
    }
    if (access.reason === 'inactive_user') {
      return res.status(403).json({ error: CONTACT_SAINT_H_MESSAGE, code: 'ACCOUNT_DISABLED' });
    }
  }

  if (isValidApiToken(req)) {
    req.auth = { type: 'api-token' };
    return next();
  }

  const user = await licenseStore.getUserBySessionToken(bearerToken);
  if (user) {
    req.auth = { type: 'license', user };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

async function requireLicensedUser(req, res, next) {
  const access = await licenseStore.inspectUserSessionToken(getBearerToken(req));
  if (!access.ok) {
    if (access.reason === 'inactive_user') {
      return res.status(403).json({ error: CONTACT_SAINT_H_MESSAGE, code: 'ACCOUNT_DISABLED' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.licenseUser = access.user;
  next();
}

function requireAdmin(req, res, next) {
  if (isValidApiToken(req)) {
    req.admin = { via: 'api-token' };
    return next();
  }

  const adminToken = String(req.headers['x-admin-token'] || '').trim();
  if (licenseStore.isValidAdminToken(adminToken)) {
    req.admin = { via: 'admin-token' };
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized admin request' });
}

// --- Routes ---

// Health check (no auth)
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(adminUiDir, 'admin.html'));
});

app.post('/auth/product-login', async (req, res) => {
  const productKey = String(req.body?.productKey || '').trim().toUpperCase();
  if (!productKey) {
    return res.status(400).json({ error: 'productKey is required' });
  }
  const candidate = await licenseStore.getUserByProductKey(productKey);
  if (candidate && !candidate.active) {
    return res.status(403).json({ error: CONTACT_SAINT_H_MESSAGE, code: 'ACCOUNT_DISABLED' });
  }
  try {
    const session = await licenseStore.createUserSession(productKey);
    res.json({
      ok: true,
      token: session.token,
      expiresInSec: session.expiresInSec,
      user: {
        id: session.user._id,
        name: session.user.name,
        email: session.user.email,
        productKey: session.user.productKey,
      },
    });
  } catch (_) {
    res.status(401).json({ error: 'Invalid or inactive product key' });
  }
});

app.post('/auth/product-logout', requireLicensedUser, (req, res) => {
  const token = getBearerToken(req);
  licenseStore.invalidateUserToken(token);
  res.json({ ok: true });
});

app.get('/me', requireLicensedUser, (req, res) => {
  const user = req.licenseUser;
  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    description: user.description,
    productKey: user.productKey,
    active: user.active,
  });
});

app.get('/me/usage', requireLicensedUser, async (req, res) => {
  try {
    const usage = await licenseStore.getUsageSnapshot(req.licenseUser._id, {
      voiceLimit: config.VOICE_CHAR_LIMIT,
      voiceWindowMs: config.VOICE_WINDOW_MS,
      sessionMs: config.SESSION_MAX_MS,
      activeSession,
    });
    res.json({ ok: true, usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/me/notifications', requireLicensedUser, async (req, res) => {
  const includeRead = String(req.query.includeRead || '').toLowerCase() === 'true';
  const limit = Number(req.query.limit || 100);
  const items = await licenseStore.listNotificationsForUser(req.licenseUser._id, { includeRead, limit });
  res.json({ ok: true, notifications: items });
});

app.post('/me/notifications/:id/read', requireLicensedUser, async (req, res) => {
  try {
    const item = await licenseStore.markNotificationRead(req.licenseUser._id, String(req.params.id || ''));
    res.json({ ok: true, notification: item });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/admin/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  try {
    const session = licenseStore.createAdminSession(username, password);
    res.json({ ok: true, token: session.token, expiresInSec: session.expiresInSec, username: session.username });
  } catch (_) {
    res.status(401).json({ error: 'Invalid admin credentials' });
  }
});

app.get('/admin/users', requireAdmin, async (_req, res) => {
  const users = await licenseStore.listUsers();
  res.json({ ok: true, users });
});

app.post('/admin/users', requireAdmin, async (req, res) => {
  const payload = {
    name: req.body?.name,
    email: req.body?.email,
    description: req.body?.description,
  };
  try {
    const user = await licenseStore.createUser(payload);
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/admin/users/:id', requireAdmin, async (req, res) => {
  const userId = String(req.params.id || '').trim();
  try {
    const user = await licenseStore.updateUser(userId, {
      name: req.body?.name,
      email: req.body?.email,
      description: req.body?.description,
      active: req.body?.active,
    });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/admin/users/:id/regenerate-key', requireAdmin, async (req, res) => {
  const userId = String(req.params.id || '').trim();
  try {
    const user = await licenseStore.regenerateProductKey(userId);
    res.json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/admin/notifications', requireAdmin, async (req, res) => {
  const message = req.body?.message;
  const category = req.body?.category || 'info';
  const target = {
    userId: req.body?.userId,
    email: req.body?.email,
    productKey: req.body?.productKey,
  };

  const user = await licenseStore.findUserByIdentifier(target);
  if (!user) {
    return res.status(404).json({ error: 'Target user not found (userId/email/productKey)' });
  }

  try {
    const notification = await licenseStore.createNotification({
      userId: user._id,
      message,
      category,
      createdBy: req.admin?.via || 'admin',
    });
    res.status(201).json({ ok: true, user, notification });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /status
app.get('/status', requireAccess, async (req, res) => {
  const session = await getOrRecoverActiveSession();
  if (!session) {
    return res.json({ active: false, streamProfile });
  }
  touchActivity();
  res.json({ active: true, podId: session.podId, endpoint: session.endpoint, streamProfile, reused: true });
});

// POST /start — provision GPU pod
app.post('/start', requireAccess, async (req, res) => {
  try {
    await waitForStopInFlight();

    const existingSession = await getOrRecoverActiveSession();
    if (existingSession) {
      if (
        req.auth?.type === 'license'
        && existingSession.ownerUserId
        && String(existingSession.ownerUserId) !== String(req.auth.user?._id || '')
      ) {
        return res.status(409).json({ error: 'Another licensed session is already active. Please wait for it to finish.' });
      }
      return res.json({ ok: true, reused: true, podId: existingSession.podId, endpoint: existingSession.endpoint });
    }

    let sessionWindow = null;
    if (req.auth?.type === 'license' && req.auth?.user?._id) {
      sessionWindow = await licenseStore.beginSessionWindow(req.auth.user._id, {
        sessionMs: config.SESSION_MAX_MS,
        cooldownMs: config.SESSION_COOLDOWN_MS,
      });
      if (!sessionWindow.ok) {
        return res.status(429).json({
          error: formatCooldownMessage(sessionWindow.cooldownUntil, 'Session limit reached.'),
          code: 'SESSION_RATE_LIMIT',
          resetAt: sessionWindow.cooldownUntil,
        });
      }
    }

    const { pod, gpuType } = await startPod();
    const podId = pod.id;

    // Poll until the pod is running and we have a public port (~1-2 min)
    const endpoint = await pollForEndpoint(podId);

    setActiveSession({
      podId,
      endpoint,
      serverReady: false,
      ownerUserId: req.auth?.type === 'license' ? String(req.auth.user?._id || '') : '',
      startedAt: sessionWindow?.sessionStartedAt || new Date(),
      endsAt: sessionWindow?.sessionEndsAt || new Date(Date.now() + config.SESSION_TIMEOUT_MS),
      cooldownUntil: sessionWindow?.cooldownUntil || null,
      maxDurationMs: req.auth?.type === 'license' ? config.SESSION_MAX_MS : config.SESSION_TIMEOUT_MS,
    });

    // Return endpoint immediately — client can show progress while server boots.
    // Inference server readiness check runs in background.
    res.json({ ok: true, podId, endpoint, gpuType });

    // Background: wait for inference server then forward face if needed
    ensureServerReadyBackground(activeSession);

  } catch (err) {
    console.error('Failed to start pod:', err.message);
    res.status(500).json({ error: formatStartError(err) });
  }
});

// POST /attach-pod — adopt an already-running pod as the managed warm pod
app.post('/attach-pod', requireAccess, async (req, res) => {
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
app.get('/ready', requireAccess, async (req, res) => {
  const session = await getOrRecoverActiveSession();
  if (!session) return res.json({ ready: false, reason: 'no_session' });
  touchActivity();
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
app.get('/stream-profile', requireAccess, (req, res) => {
  res.json({ profile: streamProfile });
});

// POST /stream-profile
app.post('/stream-profile', requireAccess, async (req, res) => {
  touchActivity();
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
app.post('/stop', requireAccess, async (req, res) => {
  await waitForStopInFlight();

  const session = await getOrRecoverActiveSession();
  if (!session) {
    return res.status(404).json({ error: 'No active session' });
  }

  const { podId } = session;
  await finalizeOwnedSessionUsage(session);
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
app.post('/upload-face', requireAccess, upload.single('face'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  touchActivity();

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

// --- ElevenLabs Voice Changer ---

// In-memory voice cache (refreshed every 30 min)
let _voiceCache = null;
let _voiceCacheAt = 0;
const VOICE_CACHE_TTL = 30 * 60 * 1000;

// GET /voices — list ElevenLabs premade voices with gender/accent metadata
app.get('/voices', requireAccess, async (req, res) => {
  if (!config.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'Voice changer not configured (missing ElevenLabs API key)' });
  }

  const now = Date.now();
  if (_voiceCache && (now - _voiceCacheAt) < VOICE_CACHE_TTL) {
    return res.json({ ok: true, voices: _voiceCache });
  }

  try {
    // Fetch all voices from ElevenLabs v1 API (no pagination, returns all at once)
    const resp = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
      timeout: 15000,
    });
    const allVoices = resp.data?.voices || [];

    // Flatten into a clean list the client needs
    const voices = allVoices.map(v => ({
      voice_id:    v.voice_id,
      name:        v.name,
      gender:      (v.labels?.gender || '').toLowerCase(),
      accent:      (v.labels?.accent || '').toLowerCase(),
      age:         (v.labels?.age || '').toLowerCase(),
      description: v.labels?.description || v.description || '',
      use_case:    (v.labels?.use_case || '').toLowerCase(),
      preview_url: v.preview_url || '',
    })).filter(v => v.voice_id && v.name);

    _voiceCache = voices;
    _voiceCacheAt = now;
    res.json({ ok: true, voices });
  } catch (err) {
    console.error('ElevenLabs /voices error:', err.message);
    res.status(502).json({ error: 'Failed to fetch voices from ElevenLabs' });
  }
});

// POST /voice-convert — accept audio chunk, convert via ElevenLabs STS streaming, return converted audio
app.post('/voice-convert', requireAccess, upload.single('audio'), async (req, res) => {
  if (!config.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'Voice changer not configured' });
  }

  const voiceId = String(req.body?.voice_id || '').trim();
  if (!voiceId) {
    return res.status(400).json({ error: 'voice_id is required' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  try {
    const form = new FormData();
    form.append('audio', req.file.buffer, {
      filename: 'chunk.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model_id', 'eleven_multilingual_sts_v2');
    form.append('voice_settings', JSON.stringify({
      stability: 0.35,
      similarity_boost: 0.8,
      style: 0.0,
      use_speaker_boost: false,
    }));

    // Stream the response back to client in real time
    const stsResp = await axios.post(
      `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}/stream?output_format=mp3_22050_32&optimize_streaming_latency=4`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'xi-api-key': config.ELEVENLABS_API_KEY,
        },
        responseType: 'stream',
        timeout: 15000,
      },
    );

    res.set({
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked',
    });
    stsResp.data.pipe(res);
  } catch (err) {
    const status = err?.response?.status || 502;
    let msg = err.message;
    if (err?.response?.data) {
      try {
        // When responseType is 'stream', error data may be a stream or buffer
        if (Buffer.isBuffer(err.response.data)) {
          msg = err.response.data.toString('utf8').slice(0, 300);
        } else if (typeof err.response.data === 'string') {
          msg = err.response.data.slice(0, 300);
        } else if (typeof err.response.data.read === 'function') {
          const chunks = [];
          for await (const c of err.response.data) chunks.push(c);
          msg = Buffer.concat(chunks).toString('utf8').slice(0, 300);
        }
      } catch (_) {}
    }
    console.error('ElevenLabs STS error:', msg);
    if (!res.headersSent) {
      res.status(status).json({ error: 'Voice conversion failed: ' + msg });
    }
  }
});

// POST /tts-generate — Generate TTS audio with word-level timestamps for teleprompter
app.post('/tts-generate', requireAccess, async (req, res) => {
  if (!config.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'ElevenLabs not configured' });
  }

  const { text, voice_id, model_id } = req.body || {};
  if (!text || !voice_id) {
    return res.status(400).json({ error: 'text and voice_id are required' });
  }

  if (req.auth?.type === 'license' && req.auth?.user?._id) {
    const quota = await licenseStore.reserveVoiceCharacters(req.auth.user._id, String(text).length, {
      limit: config.VOICE_CHAR_LIMIT,
      windowMs: config.VOICE_WINDOW_MS,
    });
    if (!quota.ok) {
      return res.status(429).json({
        error: formatCooldownMessage(quota.resetAt, 'Voice limit reached (5,000 characters per hour).'),
        code: 'VOICE_RATE_LIMIT',
        resetAt: quota.resetAt,
        used: quota.used,
        limit: quota.limit,
      });
    }
  }

  try {
    const ttsResp = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/with-timestamps?output_format=mp3_44100_128`,
      {
        text,
        model_id: model_id || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    const { audio_base64, alignment, normalized_alignment } = ttsResp.data;

    // Build word-level timing from character-level data
    const words = _buildWordTimings(text, alignment || normalized_alignment);

    res.json({
      ok: true,
      audio_base64,
      words,
      duration: words.length > 0 ? words[words.length - 1].end : 0,
    });
  } catch (err) {
    const status = err?.response?.status || 502;
    let msg = err.message;
    try {
      if (err?.response?.data) {
        msg = typeof err.response.data === 'string'
          ? err.response.data.slice(0, 400)
          : JSON.stringify(err.response.data).slice(0, 400);
      }
    } catch (_) {}
    console.error('ElevenLabs TTS error:', msg);
    res.status(status).json({ error: 'TTS generation failed: ' + msg });
  }
});

// Build word-level timing from character-level alignment
function _buildWordTimings(text, alignment) {
  if (!alignment || !alignment.characters) return [];

  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const words = [];
  let wordStart = -1;
  let wordChars = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      if (wordChars.length > 0) {
        words.push({ word: wordChars, start: wordStart, end: ends[i - 1] });
        wordChars = '';
        wordStart = -1;
      }
    } else {
      if (wordStart < 0) wordStart = starts[i];
      wordChars += ch;
    }
  }
  // Last word
  if (wordChars.length > 0 && wordStart >= 0) {
    words.push({ word: wordChars, start: wordStart, end: ends[chars.length - 1] });
  }
  return words;
}

// --- Helpers ---

function getSessionSnapshot(session) {
  if (!session) return null;
  return {
    podId: session.podId,
    endpoint: session.endpoint,
    serverReady: !!session.serverReady,
    ownerUserId: session.ownerUserId || '',
    startedAt: session.startedAt || null,
    endsAt: session.endsAt || null,
    cooldownUntil: session.cooldownUntil || null,
    maxDurationMs: Number(session.maxDurationMs || config.SESSION_TIMEOUT_MS),
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

function scheduleSessionTimeout(podId, timeoutMs) {
  return setTimeout(async () => {
    console.log('Session timeout — terminating pod', podId);
    await stopPod(podId).catch(console.error);
    if (activeSession?.podId === podId) {
      await finalizeOwnedSessionUsage(activeSession);
      clearActiveSession();
    }
  }, timeoutMs);
}

// --- Idle-pod auto-termination ---
function touchActivity() {
  lastActivityAt = Date.now();
}

function startIdleCheck() {
  stopIdleCheck(); // clear any existing interval
  touchActivity();
  idleCheckInterval = setInterval(async () => {
    if (!activeSession) { stopIdleCheck(); return; }
    const idleMs = Date.now() - (lastActivityAt || 0);
    if (idleMs >= config.IDLE_TIMEOUT_MS) {
      const { podId } = activeSession;
      console.log(`Pod ${podId} idle for ${Math.round(idleMs / 1000)}s — auto-terminating.`);
      await finalizeOwnedSessionUsage(activeSession);
      clearActiveSession();
      await stopPod(podId).catch(err => console.error('Idle stop failed:', err.message));
    }
  }, 60 * 1000); // check every 60 s
}

function stopIdleCheck() {
  if (idleCheckInterval) { clearInterval(idleCheckInterval); idleCheckInterval = null; }
  lastActivityAt = null;
}

function setActiveSession(session) {
  if (activeSession?.timeoutHandle) {
    clearTimeout(activeSession.timeoutHandle);
  }
  const endsAtMs = session.endsAt ? new Date(session.endsAt).getTime() : 0;
  const timeoutMs = endsAtMs ? Math.max(1000, endsAtMs - Date.now()) : Number(session.maxDurationMs || config.SESSION_TIMEOUT_MS);
  activeSession = {
    ...session,
    serverReady: !!session.serverReady,
    timeoutHandle: scheduleSessionTimeout(session.podId, timeoutMs),
  };
  saveSessionState(activeSession);
  startIdleCheck();
  return activeSession;
}

function clearActiveSession() {
  if (activeSession?.timeoutHandle) {
    clearTimeout(activeSession.timeoutHandle);
  }
  stopIdleCheck();
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

  const session = setActiveSession({
    podId,
    endpoint,
    serverReady: false,
    ownerUserId: options.meta?.ownerUserId || '',
    startedAt: options.meta?.startedAt || new Date(),
    endsAt: options.meta?.endsAt || new Date(Date.now() + config.SESSION_TIMEOUT_MS),
    cooldownUntil: options.meta?.cooldownUntil || null,
    maxDurationMs: Number(options.meta?.maxDurationMs || config.SESSION_TIMEOUT_MS),
  });
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
      await finalizeOwnedSessionUsage(session);
      clearActiveSession();
      return null;
    }

    session.endpoint = endpoint;
    saveSessionState(session);
    return session;
  } catch (err) {
    console.error('Failed to verify session state:', err.message);
    await finalizeOwnedSessionUsage(session);
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
      const session = await adoptExistingPod(podId, { meta: persistedSession });
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
async function boot() {
  try {
    await mongoose.connect(config.MONGODB_URI, { dbName: 'purplefinger' });
    console.log('Connected to MongoDB (purplefinger)');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }

  app.listen(config.PORT, () => {
    console.log(`Chimera Lite backend running on port ${config.PORT}`);
    getOrRecoverActiveSession().catch(err => console.error('Warm pod recovery failed:', err.message));
  });
}

boot();
