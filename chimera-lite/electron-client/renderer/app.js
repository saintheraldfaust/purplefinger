const btnUpload       = document.getElementById('btn-upload');
const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const btnSaveConfig   = document.getElementById('btn-save-config');
const btnAttachPod    = document.getElementById('btn-attach-pod');
const btnResetPreview = document.getElementById('btn-reset-preview');
const btnModeRealtime = document.getElementById('btn-mode-realtime');
const btnModeQuality  = document.getElementById('btn-mode-quality');
const btnLicenseLogin = document.getElementById('btn-license-login');
const btnLicenseLogout = document.getElementById('btn-license-logout');
const btnNotifBell    = document.getElementById('btn-notif-bell');
const btnCloseNotif   = document.getElementById('btn-close-notif');
const notifBadge      = document.getElementById('notif-badge');
const notifOverlay    = document.getElementById('notif-overlay');
const notifPopupBody  = document.getElementById('notif-popup-body');
const btnOpenTutorial = document.getElementById('btn-open-tutorial');
const btnCloseTutorial = document.getElementById('btn-close-tutorial');
const btnOpenDrivers  = document.getElementById('btn-open-drivers');
const tutorialOverlay = document.getElementById('tutorial-overlay');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const statusBadge     = document.getElementById('status-badge');
const currentPodLabel = document.getElementById('current-pod');
const log             = document.getElementById('log');
const localVideo      = document.getElementById('local-video');
const remoteCanvas    = document.getElementById('remote-canvas');
const videoEmpty      = document.getElementById('video-empty');
const idleState       = document.getElementById('idle-state');
const sessionLoader   = document.getElementById('session-loader');
const loaderText      = document.getElementById('loader-text');
const loaderSub       = document.getElementById('loader-sub');
const loaderElapsed   = document.getElementById('loader-elapsed');
const camPlaceholder  = document.getElementById('cam-placeholder');
const launchOverlay   = document.getElementById('launch-overlay');
const launchStatus    = document.getElementById('launch-status');
const launchAscii     = document.getElementById('launch-ascii');
const launchLoader    = document.getElementById('launch-loader');
const cfgBackendUrl   = document.getElementById('cfg-backend-url');
const cfgApiToken     = document.getElementById('cfg-api-token');
const cfgLicenseKey   = document.getElementById('cfg-license-key');
const cfgObsPort      = document.getElementById('cfg-obs-port');
const cfgWarmPodId    = document.getElementById('cfg-warm-pod-id');
const cfgCamera       = document.getElementById('cfg-camera');
const licenseStatus   = document.getElementById('license-status');
const configNote      = document.getElementById('config-note');
const obsUrlLabel     = document.getElementById('obs-url');

const ctrlBrightness  = document.getElementById('ctrl-brightness');
const ctrlContrast    = document.getElementById('ctrl-contrast');
const ctrlSaturation  = document.getElementById('ctrl-saturation');
const valBrightness   = document.getElementById('val-brightness');
const valContrast     = document.getElementById('val-contrast');
const valSaturation   = document.getElementById('val-saturation');

const stSendFps       = document.getElementById('st-send-fps');
const stRecvFps       = document.getElementById('st-recv-fps');
const stLatency       = document.getElementById('st-latency');
const stMode          = document.getElementById('st-mode');
const stConnScore     = document.getElementById('st-conn-score');
const ovSendFps       = document.getElementById('ov-send-fps');
const ovRecvFps       = document.getElementById('ov-recv-fps');
const ovLatency       = document.getElementById('ov-latency');
const ovMode          = document.getElementById('ov-mode');
const connScorePill   = document.getElementById('conn-score-pill');
const scoreRingFg     = document.getElementById('score-ring-fg');
const scorePct        = document.getElementById('score-pct');
const connGrade       = document.getElementById('conn-grade');
const connHint        = document.getElementById('conn-hint');
const reconnectBanner = document.getElementById('reconnect-banner');
const reconnectMsg    = document.getElementById('reconnect-msg');
const btnReconnect    = document.getElementById('btn-reconnect');
const privacyShield   = document.getElementById('privacy-shield');
const shieldTitle     = document.getElementById('shield-title');
const shieldSub       = document.getElementById('shield-sub');
const shieldScore     = document.getElementById('shield-score');
const btnPrivacyShield = document.getElementById('btn-privacy-shield');
const modeSummary     = document.getElementById('mode-summary');

function setStatus(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className = cls || '';
}

function setLog(msg) {
  log.textContent = msg;
}

// --- Video area state management ---
let _elapsedTimer = null;

function showIdleState() {
  videoEmpty.style.display = 'flex';
  idleState.style.display = 'flex';
  sessionLoader.classList.remove('visible');
  camPlaceholder.style.display = 'flex';
  if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
  loaderElapsed.textContent = '';
}

function showLoadingState(title, subtitle) {
  videoEmpty.style.display = 'flex';
  idleState.style.display = 'none';
  sessionLoader.classList.add('visible');
  camPlaceholder.style.display = 'flex';
  loaderText.textContent = title || 'Starting session...';
  loaderSub.textContent = subtitle || 'Provisioning a GPU pod. This usually takes 30–90 seconds.';
  loaderElapsed.textContent = '0s';

  const t0 = Date.now();
  if (_elapsedTimer) clearInterval(_elapsedTimer);
  _elapsedTimer = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    loaderElapsed.textContent = min > 0 ? `${min}m ${s}s` : `${sec}s`;
  }, 1000);
}

function updateLoaderText(title, subtitle) {
  if (title) loaderText.textContent = title;
  if (subtitle) loaderSub.textContent = subtitle;
}

function hideVideoEmpty() {
  videoEmpty.style.display = 'none';
  camPlaceholder.style.display = 'none';
  if (_elapsedTimer) { clearInterval(_elapsedTimer); _elapsedTimer = null; }
}

function setCurrentPod(podId, endpoint) {
  if (!currentPodLabel) return;
  if (!podId) {
    currentPodLabel.textContent = 'Pod: —';
    currentPodLabel.title = 'No active pod';
    return;
  }

  const endpointText = endpoint?.ip && endpoint?.port ? ` · ${endpoint.ip}:${endpoint.port}` : '';
  currentPodLabel.textContent = `Pod: ${podId}${endpointText}`;
  currentPodLabel.title = `Pod ID: ${podId}${endpointText}`;
}

function setLoading(loading) {
  btnStart.disabled = loading;
  btnStop.disabled = loading;
  btnUpload.disabled = loading;
  if (btnSaveConfig) btnSaveConfig.disabled = loading;
  if (btnAttachPod) btnAttachPod.disabled = loading;
}

function setConfigNote(message) {
  if (configNote) configNote.textContent = message;
}

function applyConfigToUI(config) {
  if (!config) return;
  if (cfgBackendUrl) cfgBackendUrl.value = config.backendUrl || '';
  if (cfgApiToken) cfgApiToken.value = config.apiToken || '';
  if (cfgLicenseKey) cfgLicenseKey.value = config.licenseKey || '';
  if (cfgObsPort) cfgObsPort.value = String(config.obsPort || 7891);
  if (cfgWarmPodId) cfgWarmPodId.value = config.warmPodId || '';
  if (obsUrlLabel) obsUrlLabel.textContent = config.obsUrl || `http://localhost:${config.obsPort || 7891}`;
  const pathHint = config.configPath ? `Saved locally at ${config.configPath}` : 'Saved locally on this machine.';
  setConfigNote(`${pathHint}\nAPI token is auto-filled when you login with your product key. Stop any active session before changing these values.`);
}

let licenseLoggedIn = false;
let licenseUser = null;

function setLicenseStatus(text) {
  if (licenseStatus) licenseStatus.textContent = text;
}

function isSessionUnlocked() {
  return licenseLoggedIn || !!String(cfgApiToken?.value || '').trim();
}

function updateLicenseUI() {
  const unlocked = isSessionUnlocked();
  btnStart.disabled = !unlocked;
  btnUpload.disabled = !unlocked;
  btnLicenseLogin.style.display = licenseLoggedIn ? 'none' : 'block';
  btnLicenseLogout.style.display = licenseLoggedIn ? 'block' : 'none';

  if (licenseLoggedIn && licenseUser) {
    const who = licenseUser.email ? `${licenseUser.name} (${licenseUser.email})` : licenseUser.name;
    setLicenseStatus(`✅ Logged in: ${who}`);
  } else if (unlocked) {
    setLicenseStatus('Using API token (admin mode).');
  } else {
    setLicenseStatus('⛔ Not logged in. Enter product key to unlock.');
  }
}

// --- Notification sound (short chime via Web Audio API) ---
let _audioCtx = null;
function playNotifSound() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.08);
    osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
  } catch (_) {}
}

// --- Session beep sounds (Web Audio API) ---
let _beepInterval = null;

function _ensureAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playBeep(freq = 660, duration = 0.12, volume = 0.15) {
  try {
    const ctx = _ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function playDoubleBeep() {
  playBeep(880, 0.1, 0.15);
  setTimeout(() => playBeep(880, 0.1, 0.15), 160);
}

function startBeeping() {
  stopBeeping();
  playBeep(520, 0.08, 0.10);
  _beepInterval = setInterval(() => playBeep(520, 0.08, 0.10), 800);
}

function stopBeeping() {
  if (_beepInterval) { clearInterval(_beepInterval); _beepInterval = null; }
}

// --- Audio Level Meter (microphone visualizer) ---
let _micStream = null;
let _micSource = null;
let _micAnalyser = null;
let _micAnimFrame = null;
const METER_BAR_COUNT = 8;
// Frequency bands to sample (low-to-high voice range)
const METER_BANDS = [2, 4, 6, 9, 12, 16, 20, 25];

async function startAudioMeter() {
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const ctx = _ensureAudioCtx();
    _micSource = ctx.createMediaStreamSource(_micStream);
    _micAnalyser = ctx.createAnalyser();
    _micAnalyser.fftSize = 128;
    _micAnalyser.smoothingTimeConstant = 0.7;
    _micSource.connect(_micAnalyser);
    // Do NOT connect to destination — we only visualize, no playback

    if (audioMeter) audioMeter.classList.add('visible');
    _drawMeter();
  } catch (err) {
    console.log('Audio meter unavailable:', err.message);
  }
}

function _drawMeter() {
  if (!_micAnalyser) return;
  const data = new Uint8Array(_micAnalyser.frequencyBinCount);
  _micAnalyser.getByteFrequencyData(data);

  for (let i = 0; i < METER_BAR_COUNT; i++) {
    const bin = METER_BANDS[i] || i;
    const val = data[bin] || 0;
    const pct = Math.max(3, (val / 255) * 100);
    const bar = meterBars[i];
    if (bar) {
      bar.style.height = `${pct}%`;
      // Color: green → yellow → red
      if (pct > 75) bar.style.background = '#f87171';
      else if (pct > 50) bar.style.background = '#fbbf24';
      else bar.style.background = '#34d399';
    }
  }

  _micAnimFrame = requestAnimationFrame(_drawMeter);
}

function stopAudioMeter() {
  if (_micAnimFrame) { cancelAnimationFrame(_micAnimFrame); _micAnimFrame = null; }
  if (_micSource) { try { _micSource.disconnect(); } catch (_) {} _micSource = null; }
  if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
  _micAnalyser = null;
  if (audioMeter) audioMeter.classList.remove('visible');
  // Reset bars
  meterBars.forEach(b => { if (b) { b.style.height = '3px'; b.style.background = '#34d399'; } });
}
let _unreadCount = 0;

function updateNotifBadge(count) {
  _unreadCount = count;
  if (notifBadge) {
    notifBadge.textContent = count > 99 ? '99+' : String(count);
    notifBadge.classList.toggle('visible', count > 0);
  }
}

function renderNotificationsPopup(items) {
  if (!notifPopupBody) return;
  notifPopupBody.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No notifications yet.';
    notifPopupBody.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'notif-item' + (item.readAt ? '' : ' unread');
    const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : '—';
    el.innerHTML = `
      <div class="notif-meta"><span>${item.category || 'info'}</span><span>${createdAt}</span></div>
      <div class="notif-msg"></div>
    `;
    const msg = el.querySelector('.notif-msg');
    if (msg) msg.textContent = item.message || '';
    notifPopupBody.appendChild(el);
  });
}

async function refreshNotifications(playSound = false) {
  if (!licenseLoggedIn) {
    _cachedNotifications = [];
    updateNotifBadge(0);
    return;
  }
  try {
    // Fetch ALL notifications (including read) so we can show full history in popup
    const data = await window.chimera.getUserNotifications(true);
    const items = data.notifications || [];
    _cachedNotifications = items;
    const unread = items.filter(n => !n.readAt);
    updateNotifBadge(unread.length);
    if (playSound && unread.length > 0) {
      playNotifSound();
    }
  } catch (err) {
    setLog(`Notification fetch failed: ${err.message}`);
  }
}

async function markAllNotificationsRead() {
  const unread = _cachedNotifications.filter(n => !n.readAt);
  if (!unread.length) return;
  // Mark each unread notification as read
  const promises = unread.map(n => {
    const id = n._id || n.id;
    if (!id) return Promise.resolve();
    return window.chimera.markNotificationRead(id).catch(() => {});
  });
  await Promise.all(promises);
  // Refresh to update state
  await refreshNotifications(false);
}

async function openNotificationsPopup() {
  renderNotificationsPopup(_cachedNotifications);
  notifOverlay.classList.add('visible');
  // Mark all as read when user opens the popup
  await markAllNotificationsRead();
  // Re-render to clear unread styling
  renderNotificationsPopup(_cachedNotifications);
}

function closeNotificationsPopup() {
  notifOverlay.classList.remove('visible');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeLaunchText(el, text, speed = 180) {
  el.textContent = '';
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    await sleep(speed);
  }
  el.classList.add('done');
}

async function runLaunchSequence() {
  if (!launchOverlay) return;

  const sequenceStartedAt = Date.now();
  const minSequenceMs = 15000;

  const loaderSteps = [
    'Loading core systems...',
    'Linking hosted backend...',
    'Priming live swap interface...',
  ];

  launchStatus.textContent = 'Initializing Purplefinger...';
  if (launchAscii) launchAscii.classList.remove('visible');
  if (launchLoader) launchLoader.textContent = '';

  await sleep(350);
  if (launchAscii) launchAscii.classList.add('visible');

  for (const step of loaderSteps) {
    launchStatus.textContent = step;
    if (launchLoader) await typeLaunchText(launchLoader, step, 32);
    await sleep(360);
  }

  launchStatus.textContent = 'Purplefinger ready.';
  if (launchLoader) launchLoader.textContent = 'Opening interface...';

  const remainingMs = Math.max(0, minSequenceMs - (Date.now() - sequenceStartedAt));
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }

  launchOverlay.classList.add('hidden');
}

let fBrightness = 1;
let fContrast = 1;
let fSaturation = 1;

let sentFrames = 0;
let recvFrames = 0;
let lastSentFrames = 0;
let lastRecvFrames = 0;
let lastSentAt = 0;
let statsTimer = null;
let currentProfile = 'realtime';
let currentSendFps = 12;
let currentSendQuality = 0.68;
let currentSendW = 512;
let currentSendH = 288;
let lightProbe = null;
let lightProbeCtx = null;
let currentCaptureFilter = 'none';
let lastLightProbeAt = 0;

const STREAM_PROFILES = {
  realtime: {
    label: 'Realtime',
    sendFps: 20,
    minFps: 6,
    headroom: 2,
    quality: 0.65,
    width: 512,
    height: 288,
    summary: 'Realtime mode prioritizes steadier motion with lighter detection cadence, mild low-light compensation, and no enhancement overhead.',
  },
  quality: {
    label: 'Quality',
    sendFps: 15,
    minFps: 10,
    headroom: 1,
    quality: 0.78,
    width: 480,
    height: 270,
    summary: 'Quality mode keeps enhancement enabled and trims send rate so the GPU can keep up more consistently.',
  },
};

function ensureOffscreenCanvas() {
  if (!offscreen || offscreen.width !== currentSendW || offscreen.height !== currentSendH) {
    offscreen = new OffscreenCanvas(currentSendW, currentSendH);
    offCtx = offscreen.getContext('2d');
  }
}

function ensureLightProbeCanvas() {
  if (!lightProbe) {
    lightProbe = document.createElement('canvas');
    lightProbe.width = 32;
    lightProbe.height = 18;
    lightProbeCtx = lightProbe.getContext('2d', { willReadFrequently: true });
  }
}

function updateCaptureFilter() {
  if (currentProfile !== 'realtime' || !captureVideo || captureVideo.readyState < 2) {
    currentCaptureFilter = 'none';
    return;
  }

  const now = Date.now();
  if (now - lastLightProbeAt < 300) return;
  lastLightProbeAt = now;

  ensureLightProbeCanvas();
  if (!lightProbeCtx) {
    currentCaptureFilter = 'none';
    return;
  }

  lightProbeCtx.filter = 'none';
  lightProbeCtx.drawImage(captureVideo, 0, 0, lightProbe.width, lightProbe.height);

  const { data } = lightProbeCtx.getImageData(0, 0, lightProbe.width, lightProbe.height);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total += (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
  }

  const avgLuma = total / (data.length / 4);
  if (avgLuma < 72) {
    currentCaptureFilter = 'brightness(1.24) contrast(1.12) saturate(1.05)';
  } else if (avgLuma < 96) {
    currentCaptureFilter = 'brightness(1.12) contrast(1.06) saturate(1.03)';
  } else {
    currentCaptureFilter = 'none';
  }
}

function applyPreviewFilter() {
  remoteCanvas.style.filter =
    `brightness(${fBrightness}) contrast(${fContrast}) saturate(${fSaturation})`;
}

function setPreviewDefaults() {
  fBrightness = 1;
  fContrast = 1;
  fSaturation = 1;
  ctrlBrightness.value = '1.00';
  ctrlContrast.value = '1.00';
  ctrlSaturation.value = '1.00';
  valBrightness.textContent = '1.00';
  valContrast.textContent = '1.00';
  valSaturation.textContent = '1.00';
  applyPreviewFilter();
}

function resetStats() {
  sentFrames = 0;
  recvFrames = 0;
  lastSentFrames = 0;
  lastRecvFrames = 0;
  lastSentAt = 0;
  stSendFps.textContent = '—';
  stRecvFps.textContent = '—';
  stLatency.textContent = '—';
  stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
  ovSendFps.textContent = '—';
  ovRecvFps.textContent = '—';
  ovLatency.textContent = '—';
  ovMode.textContent = STREAM_PROFILES[currentProfile].label;
}

function updateModeUI() {
  btnModeRealtime.classList.toggle('active', currentProfile === 'realtime');
  btnModeQuality.classList.toggle('active', currentProfile === 'quality');
  modeSummary.textContent = STREAM_PROFILES[currentProfile].summary;
  stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
  ovMode.textContent = STREAM_PROFILES[currentProfile].label;
}

// Self-pacing capture loop: fires next encode immediately after previous one
// completes, then waits only if encode was faster than the target interval.
// Eliminates the setInterval + _encodes backpressure drop problem where slow
// encodes caused most timer ticks to be thrown away.
let _captureLoopActive = false;

function restartCaptureTimer() {
  // No-op: loop reads currentSendFps dynamically, no restart needed.
}

async function _captureLoop() {
  while (_captureLoopActive) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !captureVideo || captureVideo.readyState < 2) {
      await new Promise((r) => setTimeout(r, 33));
      continue;
    }

    const t0 = performance.now();

    ensureOffscreenCanvas();
    updateCaptureFilter();
    offCtx.filter = currentCaptureFilter;
    offCtx.drawImage(captureVideo, 0, 0, currentSendW, currentSendH);
    offCtx.filter = 'none';

    try {
      const blob = await offscreen.convertToBlob({ type: 'image/jpeg', quality: currentSendQuality });
      sentFrames++;
      lastSentAt = Date.now();
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(blob);
    } catch (_) { /* ignore */ }

    // Pace to at most currentSendFps; if encode took longer just continue immediately.
    const elapsed = performance.now() - t0;
    const minInterval = 1000 / currentSendFps;
    if (elapsed < minInterval) {
      await new Promise((r) => setTimeout(r, minInterval - elapsed));
    }
  }
}

async function setProfile(profile, pushToBackend = true) {
  if (!STREAM_PROFILES[profile]) return;
  currentProfile = profile;
  currentSendFps = STREAM_PROFILES[profile].sendFps;
  currentSendQuality = STREAM_PROFILES[profile].quality;
  currentSendW = STREAM_PROFILES[profile].width;
  currentSendH = STREAM_PROFILES[profile].height;
  ensureOffscreenCanvas();
  updateModeUI();
  restartCaptureTimer();

  if (pushToBackend) {
    try {
      await window.chimera.setStreamProfile(profile);
    } catch (err) {
      setLog('Failed to set mode: ' + err.message);
    }
  }
}

function startStats() {
  if (statsTimer) clearInterval(statsTimer);
  resetStats();
  showConnScore();
  _connHistory = [];
  _stallCount = 0;
  hideReconnectBanner();
  statsTimer = setInterval(() => {
    const sendFps = sentFrames - lastSentFrames;
    const recvFps = recvFrames - lastRecvFrames;
    lastSentFrames = sentFrames;
    lastRecvFrames = recvFrames;

    const latency = lastSentAt ? Date.now() - lastSentAt : 0;

    stSendFps.textContent = `${sendFps} fps`;
    stRecvFps.textContent = `${recvFps} fps`;
    stLatency.textContent = latency ? `${latency} ms` : '—';
    stMode.textContent = `${STREAM_PROFILES[currentProfile].label} · ${currentSendFps} cap`;
    ovSendFps.textContent = `${sendFps} fps`;
    ovRecvFps.textContent = `${recvFps} fps`;
    ovLatency.textContent = latency ? `${latency} ms` : '—';

    // --- Connectivity score ---
    updateConnScore(sendFps, recvFps, latency);

    if (recvFps > 0) {
      const profile = STREAM_PROFILES[currentProfile];
      const recommendedFps = Math.max(
        profile.minFps,
        Math.min(profile.sendFps, recvFps + profile.headroom),
      );
      if (Math.abs(recommendedFps - currentSendFps) >= 1) {
        currentSendFps = recommendedFps;
        stMode.textContent = `${profile.label} · ${currentSendFps} cap`;
        restartCaptureTimer();
      }
    }
  }, 1000);
}

// --- Connectivity Score Engine ---
const CONN_RING_CIRCUMFERENCE = 97.4; // 2 * π * 15.5
let _connHistory = [];      // last N snapshots: { score }
let _stallCount = 0;        // consecutive seconds with 0 recv
const CONN_HISTORY_LEN = 8; // smoothing window (seconds)

function computeConnScore(sendFps, recvFps, latencyMs) {
  const profile = STREAM_PROFILES[currentProfile];
  const targetFps = profile.sendFps;

  // Component 1: Throughput ratio (0-40 pts)
  // How many frames come back vs what we send
  const ratio = sendFps > 0 ? Math.min(recvFps / sendFps, 1) : (recvFps > 0 ? 1 : 0);
  const throughputScore = ratio * 40;

  // Component 2: Recv FPS vs target (0-30 pts)
  // Penalise if recv is well below what the mode expects
  const fpsScore = Math.min(recvFps / Math.max(targetFps * 0.6, 1), 1) * 30;

  // Component 3: Latency (0-20 pts)
  // <80ms = perfect, >500ms = 0
  let latScore = 20;
  if (latencyMs > 500) latScore = 0;
  else if (latencyMs > 300) latScore = 5;
  else if (latencyMs > 200) latScore = 10;
  else if (latencyMs > 120) latScore = 15;
  else if (latencyMs > 80) latScore = 18;

  // Component 4: Stall penalty (0-10 pts)
  // Consecutive zero-recv seconds
  const stallScore = Math.max(0, 10 - _stallCount * 5);

  return Math.round(Math.min(100, throughputScore + fpsScore + latScore + stallScore));
}

function getGrade(score) {
  if (score >= 80) return { label: 'Excellent', cls: 'excellent', hint: '' };
  if (score >= 60) return { label: 'Good', cls: 'good', hint: 'Stable connection' };
  if (score >= 35) return { label: 'Fair', cls: 'fair', hint: 'Check your internet speed' };
  return { label: 'Poor', cls: 'poor', hint: 'High packet loss — consider reconnecting' };
}

function updateConnScore(sendFps, recvFps, latencyMs) {
  // Track stalls
  if (recvFps === 0 && sendFps > 0) {
    _stallCount++;
  } else {
    _stallCount = Math.max(0, _stallCount - 1);
  }

  const raw = computeConnScore(sendFps, recvFps, latencyMs);
  _connHistory.push(raw);
  if (_connHistory.length > CONN_HISTORY_LEN) _connHistory.shift();

  // Smoothed average
  const avg = Math.round(_connHistory.reduce((a, b) => a + b, 0) / _connHistory.length);

  // Update ring
  const offset = CONN_RING_CIRCUMFERENCE - (CONN_RING_CIRCUMFERENCE * avg / 100);
  if (scoreRingFg) {
    scoreRingFg.style.strokeDashoffset = offset;
    const grade = getGrade(avg);
    scoreRingFg.style.stroke = avg >= 80 ? '#34d399' : avg >= 60 ? '#60a5fa' : avg >= 35 ? '#fbbf24' : '#f87171';
    scorePct.textContent = `${avg}`;
    connGrade.textContent = grade.label;
    connGrade.className = `conn-grade ${grade.cls}`;
    connHint.textContent = grade.hint;
  }

  // Update sidebar stat
  if (stConnScore) {
    const grade = getGrade(avg);
    stConnScore.textContent = `${avg}% ${grade.label}`;
  }

  // Show reconnect banner if score critically low for sustained period
  if (avg <= 20 && _connHistory.length >= 4) {
    showReconnectBanner('Feed stalled — connection degraded');
  } else if (_stallCount >= 5) {
    showReconnectBanner('No frames received — stream may be frozen');
  } else {
    hideReconnectBanner();
  }

  // Privacy Shield — hide video output when connection is poor
  updatePrivacyShield(avg);
}

function showConnScore() {
  if (connScorePill) connScorePill.classList.add('visible');
}

function hideConnScore() {
  if (connScorePill) connScorePill.classList.remove('visible');
  if (scoreRingFg) scoreRingFg.style.strokeDashoffset = CONN_RING_CIRCUMFERENCE;
  if (scorePct) scorePct.textContent = '—';
  if (connGrade) { connGrade.textContent = '—'; connGrade.className = 'conn-grade'; }
  if (connHint) connHint.textContent = '';
  if (stConnScore) stConnScore.textContent = '—';
}

function showReconnectBanner(msg) {
  if (reconnectMsg) reconnectMsg.textContent = msg;
  if (reconnectBanner) reconnectBanner.classList.add('visible');
}

function hideReconnectBanner() {
  if (reconnectBanner) reconnectBanner.classList.remove('visible');
}

// --- Privacy Shield ---
let _shieldActive = false;
const SHIELD_ENGAGE_THRESHOLD = 25;  // score at or below → engage
const SHIELD_RELEASE_THRESHOLD = 50; // score at or above → release
const SHIELD_MIN_SAMPLES = 3;        // need this many history entries

function updatePrivacyShield(score) {
  if (!_privacyShieldEnabled) {
    if (_shieldActive) hidePrivacyShield();
    return;
  }

  if (!_shieldActive && score <= SHIELD_ENGAGE_THRESHOLD && _connHistory.length >= SHIELD_MIN_SAMPLES) {
    showPrivacyShield(score);
  } else if (_shieldActive && score >= SHIELD_RELEASE_THRESHOLD) {
    hidePrivacyShield();
  } else if (_shieldActive) {
    // Update the score readout while shield is showing
    if (shieldScore) shieldScore.textContent = `Connection quality: ${score}% — waiting for improvement`;
  }
}

function showPrivacyShield(score) {
  _shieldActive = true;
  if (privacyShield) privacyShield.classList.add('visible');
  if (shieldTitle) shieldTitle.textContent = 'Video Hidden — Poor Connection';
  if (shieldSub) shieldSub.textContent = 'Your stream is temporarily hidden to protect your identity while the connection recovers. Video will resume automatically when quality improves.';
  if (shieldScore) shieldScore.textContent = `Connection quality: ${score}%`;
}

function hidePrivacyShield() {
  _shieldActive = false;
  if (privacyShield) privacyShield.classList.remove('visible');
}

async function doReconnect() {
  // Grab the endpoint before we tear things down
  const ip = gpuIp || _lastGpuIp;
  const port = gpuPort || _lastGpuPort;
  if (!ip || !port) return;

  hideReconnectBanner();
  hidePrivacyShield();
  setLog('Reconnecting stream...');
  setStatus('Reconnecting...', 'loading');

  // Tear down current WS + camera
  _captureLoopActive = false;
  stopStats();
  stopAudioMeter();
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }
  localVideo.srcObject = null;
  offscreen = null;
  offCtx = null;
  gpuIp = null;
  gpuPort = null;

  // Small pause to let the WS fully close
  await new Promise(r => setTimeout(r, 500));

  try {
    await startStreaming(ip, port);
    setStatus('Active', 'active');
  } catch (err) {
    setStatus('Error', 'error');
    setLog('Reconnect failed: ' + err.message);
    // Keep the endpoint available for another retry
    _lastGpuIp = ip;
    _lastGpuPort = port;
    showReconnectBanner('Reconnect failed — tap to try again');
  }
}

function stopStats() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  resetStats();
}

ctrlBrightness.addEventListener('input', (e) => {
  fBrightness = parseFloat(e.target.value);
  valBrightness.textContent = fBrightness.toFixed(2);
  applyPreviewFilter();
});

ctrlContrast.addEventListener('input', (e) => {
  fContrast = parseFloat(e.target.value);
  valContrast.textContent = fContrast.toFixed(2);
  applyPreviewFilter();
});

ctrlSaturation.addEventListener('input', (e) => {
  fSaturation = parseFloat(e.target.value);
  valSaturation.textContent = fSaturation.toFixed(2);
  applyPreviewFilter();
});

btnResetPreview.addEventListener('click', () => setPreviewDefaults());
btnModeRealtime.addEventListener('click', () => setProfile('realtime'));
btnModeQuality.addEventListener('click', () => setProfile('quality'));
btnReconnect.addEventListener('click', () => doReconnect());

// --- Privacy Shield toggle (header button) ---
let _privacyShieldEnabled = true;
btnPrivacyShield.addEventListener('click', () => {
  _privacyShieldEnabled = !_privacyShieldEnabled;
  btnPrivacyShield.classList.toggle('shield-active', _privacyShieldEnabled);
  btnPrivacyShield.title = _privacyShieldEnabled
    ? 'Privacy Shield — auto-hide video on poor connection (ON)'
    : 'Privacy Shield — auto-hide video on poor connection (OFF)';
  if (!_privacyShieldEnabled) hidePrivacyShield();
});
btnSaveConfig.addEventListener('click', async () => {
  if (ws || localStream || gpuIp) {
    setConfigNote('Stop the current session before changing connection settings.');
    return;
  }

  btnSaveConfig.disabled = true;
  setConfigNote('Saving connection settings...');
  try {
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: cfgLicenseKey.value,
      obsPort: cfgObsPort.value,
      warmPodId: cfgWarmPodId.value,
    });
    applyConfigToUI(saved);
    setLog('Connection settings saved.');
  } catch (err) {
    setConfigNote(`Failed to save settings: ${err.message}`);
  } finally {
    btnSaveConfig.disabled = false;
  }
});

btnAttachPod.addEventListener('click', async () => {
  const podId = String(cfgWarmPodId.value || '').trim();
  if (!podId) {
    setConfigNote('Enter a warm pod ID before attaching it.');
    return;
  }
  if (ws || localStream || gpuIp) {
    setConfigNote('Stop the current session before attaching a different pod.');
    return;
  }

  btnAttachPod.disabled = true;
  setConfigNote('Attaching warm pod...');
  try {
    const result = await window.chimera.attachWarmPod(podId);
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: cfgLicenseKey.value,
      obsPort: cfgObsPort.value,
      warmPodId: podId,
    });
    applyConfigToUI(saved);
    setCurrentPod(result.podId, result.endpoint);
    setLog(`Warm pod attached — ${result.endpoint.ip}:${result.endpoint.port}`);
    setConfigNote(`Warm pod attached: ${podId}`);
  } catch (err) {
    setConfigNote(`Failed to attach warm pod: ${err.message}`);
  } finally {
    btnAttachPod.disabled = false;
  }
});

btnLicenseLogin.addEventListener('click', async () => {
  const key = String(cfgLicenseKey?.value || '').trim().toUpperCase();
  if (!key) {
    setLog('Enter your product key first.');
    return;
  }
  btnLicenseLogin.disabled = true;
  try {
    const result = await window.chimera.licenseLogin(key);
    licenseLoggedIn = true;
    licenseUser = result.user || null;
    updateLicenseUI();
    const saved = await window.chimera.saveAppConfig({
      backendUrl: cfgBackendUrl.value,
      apiToken: cfgApiToken.value,
      licenseKey: key,
      obsPort: cfgObsPort.value,
      warmPodId: cfgWarmPodId.value,
    });
    applyConfigToUI(saved);
    setLog('Product key login successful.');
    await refreshNotifications(true);
  } catch (err) {
    licenseLoggedIn = false;
    licenseUser = null;
    updateLicenseUI();
    setLog(`Product key login failed: ${err.message}`);
  } finally {
    btnLicenseLogin.disabled = false;
  }
});

btnLicenseLogout.addEventListener('click', async () => {
  btnLicenseLogout.disabled = true;
  try {
    await window.chimera.licenseLogout();
    licenseLoggedIn = false;
    licenseUser = null;
    updateLicenseUI();
    _cachedNotifications = [];
    updateNotifBadge(0);
    renderNotificationsPopup([]);
    setLog('Product key session logged out.');
  } catch (err) {
    setLog(`Logout failed: ${err.message}`);
  } finally {
    btnLicenseLogout.disabled = false;
  }
});

btnNotifBell.addEventListener('click', () => {
  openNotificationsPopup().catch(() => {});
});

btnCloseNotif.addEventListener('click', () => {
  closeNotificationsPopup();
});

// Close notification popup on backdrop click
notifOverlay.addEventListener('click', (e) => {
  if (e.target === notifOverlay) closeNotificationsPopup();
});

// Close notification popup on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && notifOverlay.classList.contains('visible')) {
    closeNotificationsPopup();
  }
});

// --- Camera enumeration ---
// Virtual camera names to deprioritize (pushed to bottom of dropdown).
const VIRTUAL_CAM_KEYWORDS = ['droidcam', 'obs virtual', 'obs-camera', 'virtual', 'snap camera', 'manycam', 'xsplit'];

function isVirtualCam(label) {
  const lower = (label || '').toLowerCase();
  return VIRTUAL_CAM_KEYWORDS.some(kw => lower.includes(kw));
}

async function enumerateCameras() {
  try {
    // Need a brief getUserMedia to get labelled devices on first load
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tempStream.getTracks().forEach(t => t.stop());
  } catch (_) {}

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter(d => d.kind === 'videoinput');

  // Sort: real cameras first, virtual cameras last
  cameras.sort((a, b) => {
    const aVirt = isVirtualCam(a.label) ? 1 : 0;
    const bVirt = isVirtualCam(b.label) ? 1 : 0;
    return aVirt - bVirt;
  });

  // Populate dropdown
  cfgCamera.innerHTML = '';
  cameras.forEach((cam, idx) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    const label = cam.label || `Camera ${idx + 1}`;
    opt.textContent = isVirtualCam(label) ? `⚠ ${label}` : label;
    cfgCamera.appendChild(opt);
  });

  // Auto-select first non-virtual camera
  const firstReal = cameras.find(c => !isVirtualCam(c.label));
  if (firstReal) {
    cfgCamera.value = firstReal.deviceId;
  }
}

// --- WebSocket stream state ---
let ws           = null;
let localStream  = null;
let captureVideo = null;  // hidden <video> to draw from
let captureTimer = null;  // unused but kept to avoid reference errors in restartCaptureTimer
let gpuIp        = null;
let gpuPort      = null;
let _lastGpuIp   = null;
let _lastGpuPort = null;
let offscreen    = null;
let offCtx       = null;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;
  _lastGpuIp = ip;
  _lastGpuPort = port;

  setLog('Requesting camera...');
  startBeeping(); // beep while waiting for camera + stream connection
  const videoConstraints = {
    width:     { ideal: 960, max: 1280 },
    height:    { ideal: 540, max: 720 },
    frameRate: { ideal: 20, max: 20 },
  };
  // Use user-selected camera; fall back to default if none selected
  const selectedDeviceId = cfgCamera?.value;
  if (selectedDeviceId) {
    videoConstraints.deviceId = { exact: selectedDeviceId };
  }
  localStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });

  localVideo.srcObject = localStream;
  camPlaceholder.style.display = 'none';

  // Hidden video element — OffscreenCanvas draws from this
  captureVideo = document.createElement('video');
  captureVideo.srcObject = localStream;
  captureVideo.muted = true;
  captureVideo.playsInline = true;
  await captureVideo.play();

  // OffscreenCanvas — hardware-accelerated JPEG encoding in Chromium
  ensureOffscreenCanvas();

  // Display canvas for inbound swapped frames
  remoteCanvas.width  = 640;
  remoteCanvas.height = 360;
  const displayCtx = remoteCanvas.getContext('2d');

  ws = new WebSocket(`ws://${ip}:${port}/ws`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    stopBeeping();
    hideVideoEmpty();
    setLog(`Streaming — ${ip}:${port}`);
    startStats();
    startAudioMeter();
    _captureLoopActive = true;
    _captureLoop();
  };

  ws.onmessage = (event) => {
    recvFrames++;
    // Display in the Electron window — event.data is already ArrayBuffer
    createImageBitmap(new Blob([event.data], { type: 'image/jpeg' })).then((bitmap) => {
      displayCtx.drawImage(bitmap, 0, 0, remoteCanvas.width, remoteCanvas.height);
      bitmap.close();
    });

    // Push to OBS Browser Source — send raw ArrayBuffer, main process base64-encodes it.
    // Eliminates the async FileReader + dataURL string overhead on the render process.
    window.chimera.obsFrame(event.data);
  };

  ws.onerror = () => {
    setLog('Stream error — check GPU pod');
    showReconnectBanner('Stream error — tap to reconnect');
  };
  ws.onclose = () => {
    if (gpuIp) {
      setLog('Stream disconnected');
      showReconnectBanner('Stream disconnected — tap to reconnect');
    }
  };
}

function stopStreaming() {
  gpuIp = null;
  gpuPort = null;
  _lastGpuIp = null;
  _lastGpuPort = null;
  _captureLoopActive = false;
  stopStats();
  stopAudioMeter();
  hideConnScore();
  hideReconnectBanner();
  hidePrivacyShield();

  if (ws) { ws.close(); ws = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }

  localVideo.srcObject = null;
  offscreen = null;
  offCtx = null;

  if (remoteCanvas) {
    remoteCanvas.getContext('2d').clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  }

  showIdleState();
}

// --- Face Upload ---
btnUpload.addEventListener('click', () => faceInput.click());

faceInput.addEventListener('change', async () => {
  const file = faceInput.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  facePreview.src = url;
  facePreview.style.display = 'block';

  setLog('Uploading face...');
  try {
    const buffer = await file.arrayBuffer();
    await window.chimera.uploadFace(buffer, file.name);
    setLog('Face uploaded.');
  } catch (err) {
    setLog('Face upload failed: ' + err.message);
  }
});

// --- Start Session ---
btnStart.addEventListener('click', async () => {
  if (!isSessionUnlocked()) {
    setLog('Login with product key first.');
    return;
  }

  setStatus('Starting...', 'loading');
  setLog('Checking for a reusable warm pod...');
  setLoading(true);
  showLoadingState('Starting session...', 'Looking for a reusable warm pod...');
  playBeep(660, 0.15, 0.18); // single beep — session starting

  try {
    const configuredWarmPodId = String(cfgWarmPodId?.value || '').trim();
    if (configuredWarmPodId) {
      setLog(`Attaching configured warm pod ${configuredWarmPodId}...`);
      updateLoaderText('Attaching warm pod...', `Connecting to pod ${configuredWarmPodId}`);
      await window.chimera.attachWarmPod(configuredWarmPodId);
    }

    const existingStatus = await window.chimera.getStatus();
    if (existingStatus?.active) {
      setLog('Reusable warm pod found. Connecting to it...');
      updateLoaderText('Warm pod found', 'Reconnecting to existing session...');
    } else {
      setLog('No reusable warm pod found. Provisioning a new GPU pod...');
      updateLoaderText('Provisioning GPU...', 'Requesting a new GPU pod. This usually takes 30–90 seconds.');
    }

    // /start now reuses a live warm pod when one already exists.
    const data = await window.chimera.startSession();
    setCurrentPod(data.podId, data.endpoint);

    btnStart.style.display = 'none';
    btnStop.style.display  = 'block';
    btnStop.disabled       = false;

    if (data.reused) {
      setLog('Warm pod found. Checking server readiness...');
      updateLoaderText('Waking warm pod...', 'The inference server is booting up.');
    } else {
      const gpuLabel = (data.gpuType || '').replace('NVIDIA ', '').replace('GeForce ', '') || 'GPU';
      setLog(`Warm pod not available. Waiting for a new ${gpuLabel} pod to finish booting...`);
      updateLoaderText('Booting inference server...', `New ${gpuLabel} pod is starting. Models are loading.`);
    }

    // Poll /ready until the inference server is accepting connections.
    // Show elapsed time so the user knows it's working, not frozen.
    const startedAt = Date.now();
    let dots = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      dots = (dots + 1) % 4;
      const d = '.'.repeat(dots + 1);
      const prefix = data.reused ? 'Warm pod waking' : 'Provisioning and starting server';
      setLog(`${prefix}${d}  ${elapsed}s`);
      try {
        const r = await window.chimera.checkReady();
        if (r.ready) break;
      } catch (_) {}
    }

    updateLoaderText('Connecting stream...', 'GPU pod is ready. Opening camera and WebSocket...');

    setStatus('Active', 'active');
    setLog(`Streaming — ${data.endpoint.ip}:${data.endpoint.port}`);
    btnUpload.disabled = false;

    await startStreaming(data.endpoint.ip, data.endpoint.port);
  } catch (err) {
    stopBeeping();
    setStatus('Error', 'error');
    setLog('Failed to start: ' + err.message);
    showIdleState();
    setLoading(false);
  }
});

// --- Stop Session ---
btnStop.addEventListener('click', async () => {
  setStatus('Stopping...', 'loading');
  setLog('Terminating GPU pod...');
  setLoading(true);
  stopBeeping();

  stopStreaming();

  try {
    await window.chimera.stopSession();
    setCurrentPod(null);
    setStatus('Idle', '');
    setLog('Session stopped.');
    playDoubleBeep(); // two beeps — session ended
    btnStop.style.display  = 'none';
    btnStart.style.display = 'block';
  } catch (err) {
    setStatus('Error', 'error');
    setLog('Failed to stop: ' + err.message);
  }

  setLoading(false);
});

// --- Tutorial / Setup Guide ---
btnOpenTutorial.addEventListener('click', () => {
  tutorialOverlay.classList.add('visible');
  // Update the OBS URL references inside the tutorial
  const obsUrl = obsUrlLabel.textContent || 'http://localhost:7891';
  const tutUrl1 = document.getElementById('tut-obs-url');
  const tutUrl2 = document.getElementById('tut-obs-url-2');
  if (tutUrl1) tutUrl1.textContent = obsUrl;
  if (tutUrl2) tutUrl2.textContent = obsUrl;
});

btnCloseTutorial.addEventListener('click', () => {
  tutorialOverlay.classList.remove('visible');
});

btnOpenDrivers.addEventListener('click', async () => {
  try {
    await window.chimera.openDriversFolder();
  } catch (err) {
    setLog('Could not open drivers folder: ' + err.message);
  }
});

// Close tutorial on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tutorialOverlay.classList.contains('visible')) {
    tutorialOverlay.classList.remove('visible');
  }
});

// --- Init: reconnect to existing session ---
(async () => {
  runLaunchSequence().catch(() => {});
  setPreviewDefaults();
  await enumerateCameras().catch(() => {});
  try {
    const appConfig = await window.chimera.getAppConfig();
    applyConfigToUI(appConfig);

    const licenseSession = await window.chimera.getLicenseSession();
    licenseLoggedIn = !!licenseSession?.loggedIn;
    licenseUser = licenseSession?.user || null;
    updateLicenseUI();
    if (licenseLoggedIn) {
      await refreshNotifications(true);
    }

    const profileData = await window.chimera.getStreamProfile();
    if (profileData?.profile) {
      await setProfile(profileData.profile, false);
    } else {
      updateModeUI();
    }

    const data = await window.chimera.getStatus();
    if (data.active) {
      if (data.streamProfile) {
        await setProfile(data.streamProfile, false);
      }
      setCurrentPod(data.podId, data.endpoint);
      setStatus('Active', 'active');
      btnStart.style.display = 'none';
      btnStop.style.display  = 'block';
      setLog('Reconnecting...');
      await startStreaming(data.endpoint.ip, data.endpoint.port);
    } else {
      setCurrentPod(null);
    }
  } catch (_) {}
})();

