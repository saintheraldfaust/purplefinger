const btnUpload       = document.getElementById('btn-upload');
const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const btnResetPreview = document.getElementById('btn-reset-preview');
const btnModeRealtime = document.getElementById('btn-mode-realtime');
const btnModeQuality  = document.getElementById('btn-mode-quality');
const faceInput       = document.getElementById('face-input');
const facePreview     = document.getElementById('face-preview');
const statusBadge     = document.getElementById('status-badge');
const log             = document.getElementById('log');
const localVideo      = document.getElementById('local-video');
const remoteCanvas    = document.getElementById('remote-canvas');
const videoEmpty      = document.getElementById('video-empty');
const launchOverlay   = document.getElementById('launch-overlay');
const launchStatus    = document.getElementById('launch-status');
const launchLines     = Array.from(document.querySelectorAll('.launch-line'));
const launchTexts     = Array.from(document.querySelectorAll('.launch-text'));

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

function setLoading(loading) {
  btnStart.disabled = loading;
  btnStop.disabled = loading;
  btnUpload.disabled = loading;
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

  launchStatus.textContent = 'Initializing live face swap interface...';
  launchTexts.forEach((el) => {
    el.textContent = '';
    el.classList.remove('done');
  });

  launchLines.forEach((line) => line.classList.remove('visible'));

  await sleep(1400);

  for (let i = 0; i < launchLines.length; i++) {
    const line = launchLines[i];
    const textEl = launchTexts[i];
    const text = textEl.dataset.text || '';
    line.classList.add('visible');
    launchStatus.textContent = `Bootstrapping ${text}...`;
    await sleep(900);
    await typeLaunchText(textEl, text, i === 0 ? 220 : i === 1 ? 185 : 170);
    await sleep(i === launchLines.length - 1 ? 2200 : 1400);
  }

  launchStatus.textContent = 'Interface ready.';
  await sleep(4200);
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
let currentSendFps = 15;
let currentSendQuality = 0.72;
let currentSendW = 576;
let currentSendH = 324;
let lightProbe = null;
let lightProbeCtx = null;
let currentCaptureFilter = 'none';
let lastLightProbeAt = 0;

const STREAM_PROFILES = {
  realtime: {
    label: 'Realtime',
    sendFps: 15,
    minFps: 10,
    headroom: 1,
    quality: 0.72,
    width: 576,
    height: 324,
    summary: 'Realtime mode keeps enhancement off, but now uses a sharper working resolution and stronger detection for better detail.',
  },
  quality: {
    label: 'Quality',
    sendFps: 10,
    minFps: 6,
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

function restartCaptureTimer() {
  if (!captureTimer) return;
  clearInterval(captureTimer);
  captureTimer = setInterval(doCapture, 1000 / currentSendFps);
}

function doCapture() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (_encodes > 1) return;
  if (!captureVideo || captureVideo.readyState < 2) return;

  _encodes++;
  lastSentAt = Date.now();
  ensureOffscreenCanvas();
  updateCaptureFilter();
  offCtx.filter = currentCaptureFilter;
  offCtx.drawImage(captureVideo, 0, 0, currentSendW, currentSendH);
  offCtx.filter = 'none';
  offscreen.convertToBlob({ type: 'image/jpeg', quality: currentSendQuality })
    .then((blob) => {
      _encodes--;
      sentFrames++;
      if (blob && ws && ws.readyState === WebSocket.OPEN)
        blob.arrayBuffer().then((buf) => ws.send(buf));
    })
    .catch(() => _encodes--);
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

// --- WebSocket stream state ---
let ws           = null;
let localStream  = null;
let captureVideo = null;  // hidden <video> to draw from
let captureTimer = null;
let gpuIp        = null;
let gpuPort      = null;
let offscreen    = null;
let offCtx       = null;
let _encodes     = 0;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;

  setLog('Requesting camera...');
  localStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:     { ideal: 960, max: 1280 },
      height:    { ideal: 540, max: 720 },
      frameRate: { ideal: 20, max: 20 },
    },
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
    _encodes = 0;

    // Fire at 20fps; server always processes the latest frame so extra sends just
    // update the queue — no lockstep stall waiting for a reply.
    captureTimer = setInterval(doCapture, 1000 / currentSendFps);
  };

  ws.onmessage = (event) => {
    recvFrames++;
    const blob = new Blob([event.data], { type: 'image/jpeg' });

    // Display in the Electron window
    createImageBitmap(blob).then((bitmap) => {
      displayCtx.drawImage(bitmap, 0, 0, remoteCanvas.width, remoteCanvas.height);
      bitmap.close();
    });

    // Push to OBS Browser Source (localhost:7891) via main process
    // OBS captures your real mic separately — no audio work needed here
    const reader = new FileReader();
    reader.onload = () => window.chimera.obsFrame(reader.result);
    reader.readAsDataURL(blob);
  };

  ws.onerror = () => setLog('Stream error — check GPU pod');
  ws.onclose = () => { if (gpuIp) setLog('Stream disconnected'); };
}

function stopStreaming() {
  gpuIp = null;
  clearInterval(captureTimer);
  captureTimer = null;
  stopStats();
  _encodes = 0;

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
  setStatus('Starting...', 'loading');
  setLog('Provisioning GPU pod...');
  setLoading(true);

  try {
    // /start returns as soon as the pod has an IP — usually ~1-2 min.
    // The inference server (pip install + model load) may still be booting.
    const data = await window.chimera.startSession();

    btnStart.style.display = 'none';
    btnStop.style.display  = 'block';
    btnStop.disabled       = false;

    // Poll /ready until the inference server is accepting connections.
    // Show elapsed time so the user knows it's working, not frozen.
    const startedAt = Date.now();
    let dots = 0;
    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      dots = (dots + 1) % 4;
      const d = '.'.repeat(dots + 1);
      setLog(`Server starting${d}  ${elapsed}s  (first boot installs packages — ~5-10 min)`);
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

// --- Init: reconnect to existing session ---
(async () => {
  runLaunchSequence().catch(() => {});
  setPreviewDefaults();
  try {
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
      setStatus('Active', 'active');
      btnStart.style.display = 'none';
      btnStop.style.display  = 'block';
      setLog('Reconnecting...');
      await startStreaming(data.endpoint.ip, data.endpoint.port);
    }
  } catch (_) {}
})();

