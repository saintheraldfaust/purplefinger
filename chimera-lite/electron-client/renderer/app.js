const btnUpload   = document.getElementById('btn-upload');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const faceInput   = document.getElementById('face-input');
const facePreview = document.getElementById('face-preview');
const statusBadge = document.getElementById('status-badge');
const log         = document.getElementById('log');
const videoCard   = document.getElementById('video-card');
const localVideo  = document.getElementById('local-video');

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

// --- WebSocket stream state ---
let ws           = null;
let localStream  = null;
let captureVideo = null;  // hidden <video> to draw from
let captureTimer = null;
let gpuIp        = null;
let gpuPort      = null;

// Send at 480x270 — OffscreenCanvas hardware-encodes JPEG much faster than
// regular canvas.toBlob() at 640x360. Server normalises to its proc size anyway.
const SEND_W = 480, SEND_H = 270;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;

  setLog('Requesting camera...');
  localStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:     { ideal: 640 },
      height:    { ideal: 360 },
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
  const offscreen = new OffscreenCanvas(SEND_W, SEND_H);
  const offCtx    = offscreen.getContext('2d');

  // Display canvas for inbound swapped frames
  const displayCanvas = document.getElementById('remote-canvas');
  displayCanvas.width  = 640;
  displayCanvas.height = 360;
  const displayCtx = displayCanvas.getContext('2d');

  ws = new WebSocket(`ws://${ip}:${port}/ws`);
  ws.binaryType = 'arraybuffer';

  // Cap concurrent in-flight encodes — prevents buildup if GPU is slower than camera
  let _encodes = 0;

  ws.onopen = () => {
    videoCard.style.display = 'flex';
    setLog(`Streaming — ${ip}:${port}`);

    // Fire at 20fps; server always processes the latest frame so extra sends just
    // update the queue — no lockstep stall waiting for a reply.
    captureTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (_encodes > 1) return;                // at most 2 encodes in flight
      if (captureVideo.readyState < 2) return;

      _encodes++;
      offCtx.drawImage(captureVideo, 0, 0, SEND_W, SEND_H);
      offscreen.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
        .then((blob) => {
          _encodes--;
          if (blob && ws && ws.readyState === WebSocket.OPEN)
            blob.arrayBuffer().then((buf) => ws.send(buf));
        })
        .catch(() => _encodes--);
    }, 1000 / 20);
  };

  ws.onmessage = (event) => {
    const blob = new Blob([event.data], { type: 'image/jpeg' });
    createImageBitmap(blob).then((bitmap) => {
      displayCtx.drawImage(bitmap, 0, 0, displayCanvas.width, displayCanvas.height);
      bitmap.close();
    });
  };

  ws.onerror = () => setLog('Stream error — check GPU pod');
  ws.onclose = () => { if (gpuIp) setLog('Stream disconnected'); };
}

function stopStreaming() {
  gpuIp = null;
  clearInterval(captureTimer);
  captureTimer = null;

  if (ws) { ws.close(); ws = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (captureVideo) { captureVideo.srcObject = null; captureVideo = null; }

  localVideo.srcObject = null;

  const displayCanvas = document.getElementById('remote-canvas');
  if (displayCanvas) {
    displayCanvas.getContext('2d').clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  }

  videoCard.style.display = 'none';
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
  setLog('Provisioning GPU — this takes 1-3 minutes...');
  setLoading(true);

  try {
    const data = await window.chimera.startSession();
    setStatus('Active', 'active');
    btnStart.style.display = 'none';
    btnStop.style.display  = 'block';
    btnStop.disabled       = false;
    btnUpload.disabled     = false;

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
  try {
    const data = await window.chimera.getStatus();
    if (data.active) {
      setStatus('Active', 'active');
      btnStart.style.display = 'none';
      btnStop.style.display  = 'block';
      setLog('Reconnecting...');
      await startStreaming(data.endpoint.ip, data.endpoint.port);
    }
  } catch (_) {}
})();

