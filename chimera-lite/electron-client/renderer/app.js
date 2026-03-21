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
const btnNotificationsRefresh = document.getElementById('btn-notifications-refresh');
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
const launchOverlay   = document.getElementById('launch-overlay');
const launchStatus    = document.getElementById('launch-status');
const launchAscii     = document.getElementById('launch-ascii');
const launchLoader    = document.getElementById('launch-loader');
const cfgBackendUrl   = document.getElementById('cfg-backend-url');
const cfgApiToken     = document.getElementById('cfg-api-token');
const cfgLicenseKey   = document.getElementById('cfg-license-key');
const cfgObsPort      = document.getElementById('cfg-obs-port');
const cfgWarmPodId    = document.getElementById('cfg-warm-pod-id');
const cfgRunpodGpuType = document.getElementById('cfg-runpod-gpu-type');
const cfgCamera       = document.getElementById('cfg-camera');
const licenseStatus   = document.getElementById('license-status');
const notificationsList = document.getElementById('notifications-list');
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
const ovSendFps       = document.getElementById('ov-send-fps');
const ovRecvFps       = document.getElementById('ov-recv-fps');
const ovLatency       = document.getElementById('ov-latency');
const ovMode          = document.getElementById('ov-mode');
const modeSummary     = document.getElementById('mode-summary');

function setStatus(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className = cls || '';
}

function setLog(msg) {
  log.textContent = msg;
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
  if (cfgRunpodGpuType) cfgRunpodGpuType.value = config.runpodGpuType || 'NVIDIA GeForce RTX 5090';
  if (obsUrlLabel) obsUrlLabel.textContent = config.obsUrl || `http://localhost:${config.obsPort || 7891}`;
  const pathHint = config.configPath ? `Saved locally at ${config.configPath}` : 'Saved locally on this machine.';
  setConfigNote(`${pathHint}\nProduct key is used for customer login each run. API token is optional for admin/service usage. Stop any active session before changing these values.`);
}

let licenseLoggedIn = false;
let licenseUser = null;

function setLicenseStatus(text) {
  if (licenseStatus) licenseStatus.textContent = text;
}

function updateLicenseUI() {
  if (licenseLoggedIn && licenseUser) {
    const who = licenseUser.email ? `${licenseUser.name} (${licenseUser.email})` : licenseUser.name;
    setLicenseStatus(`Logged in: ${who}`);
  } else {
    setLicenseStatus('Not logged in. Enter product key below.');
  }
}

function renderNotifications(items) {
  if (!notificationsList) return;
  notificationsList.innerHTML = '';
  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-copy';
    empty.textContent = 'No notifications yet.';
    notificationsList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'notif-item';
    const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString() : '—';
    el.innerHTML = `
      <div class="notif-meta"><span>${item.category || 'info'}</span><span>${createdAt}</span></div>
      <div class="notif-msg"></div>
    `;
    const msg = el.querySelector('.notif-msg');
    if (msg) msg.textContent = item.message || '';
    notificationsList.appendChild(el);
  });
}

async function refreshNotifications() {
  if (!licenseLoggedIn) {
    renderNotifications([]);
    return;
  }
  try {
    const data = await window.chimera.getUserNotifications(false);
    renderNotifications(data.notifications || []);
  } catch (err) {
    setLog(`Notification fetch failed: ${err.message}`);
  }
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
      runpodGpuType: cfgRunpodGpuType?.value,
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
      runpodGpuType: cfgRunpodGpuType?.value,
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
      runpodGpuType: cfgRunpodGpuType?.value,
    });
    applyConfigToUI(saved);
    setLog('Product key login successful.');
    await refreshNotifications();
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
    renderNotifications([]);
    setLog('Product key session logged out.');
  } catch (err) {
    setLog(`Logout failed: ${err.message}`);
  } finally {
    btnLicenseLogout.disabled = false;
  }
});

btnNotificationsRefresh.addEventListener('click', () => {
  refreshNotifications().catch(() => {});
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
let offscreen    = null;
let offCtx       = null;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;

  setLog('Requesting camera...');
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
    videoEmpty.style.display = 'none';
    setLog(`Streaming — ${ip}:${port}`);
    startStats();
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

  ws.onerror = () => setLog('Stream error — check GPU pod');
  ws.onclose = () => { if (gpuIp) setLog('Stream disconnected'); };
}

function stopStreaming() {
  gpuIp = null;
  _captureLoopActive = false;
  stopStats();

  if (ws) { ws.close(); ws = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }

  localVideo.srcObject = null;
  offscreen = null;
  offCtx = null;

  if (remoteCanvas) {
    remoteCanvas.getContext('2d').clearRect(0, 0, remoteCanvas.width, remoteCanvas.height);
  }

  videoEmpty.style.display = 'flex';
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
  if (!licenseLoggedIn && !String(cfgApiToken?.value || '').trim()) {
    setStatus('Locked', 'error');
    setLog('Login with product key first (or configure API token for admin/service mode).');
    return;
  }

  setStatus('Starting...', 'loading');
  setLog('Checking for a reusable warm pod...');
  setLoading(true);

  try {
    const configuredWarmPodId = String(cfgWarmPodId?.value || '').trim();
    if (configuredWarmPodId) {
      setLog(`Attaching configured warm pod ${configuredWarmPodId}...`);
      await window.chimera.attachWarmPod(configuredWarmPodId);
    }

    const existingStatus = await window.chimera.getStatus();
    if (existingStatus?.active) {
      setLog('Reusable warm pod found. Connecting to it...');
    } else {
      setLog('No reusable warm pod found. Provisioning a new GPU pod...');
    }

    // /start now reuses a live warm pod when one already exists.
    const data = await window.chimera.startSession(cfgRunpodGpuType?.value);
    setCurrentPod(data.podId, data.endpoint);

    btnStart.style.display = 'none';
    btnStop.style.display  = 'block';
    btnStop.disabled       = false;

    if (data.reused) {
      setLog('Warm pod found. Checking server readiness...');
    } else {
      setLog(`Warm pod not available. Waiting for a new ${cfgRunpodGpuType?.value === 'NVIDIA GeForce RTX 4090' ? 'RTX 4090' : 'RTX 5090'} pod to finish booting...`);
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

    setStatus('Active', 'active');
    setLog(`Streaming — ${data.endpoint.ip}:${data.endpoint.port}`);
    btnUpload.disabled = false;

    await startStreaming(data.endpoint.ip, data.endpoint.port);
  } catch (err) {
    setStatus('Error', 'error');
    setLog('Failed to start: ' + err.message);
    setLoading(false);
  }
});

// --- Stop Session ---
btnStop.addEventListener('click', async () => {
  setStatus('Stopping...', 'loading');
  setLog('Terminating GPU pod...');
  setLoading(true);

  stopStreaming();

  try {
    await window.chimera.stopSession();
    setCurrentPod(null);
    setStatus('Idle', '');
    setLog('Session stopped.');
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
      await refreshNotifications();
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

