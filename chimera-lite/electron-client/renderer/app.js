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
let captureVideo = null;   // hidden <video> to pull frames from
let captureCanvas = null;  // off-screen canvas for JPEG encoding
let captureCtx   = null;
let captureTimer = null;
let waitingReply = false;  // lockstep: don't send until last frame returns
let gpuIp        = null;
let gpuPort      = null;

async function startStreaming(ip, port) {
  gpuIp = ip;
  gpuPort = port;

  setLog('Requesting camera...');
  localStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:     { ideal: 640 },
      height:    { ideal: 360 },
      frameRate: { ideal: 15, max: 15 },
    },
    audio: false,
  });

  // PiP preview
  localVideo.srcObject = localStream;

  // Hidden video element — canvas reads from this, avoids re-capturing stream
  captureVideo = document.createElement('video');
  captureVideo.srcObject = localStream;
  captureVideo.muted = true;
  captureVideo.playsInline = true;
  await captureVideo.play();

  // Off-screen canvas for encoding outbound frames
  captureCanvas = document.createElement('canvas');
  captureCanvas.width  = 640;
  captureCanvas.height = 360;
  captureCtx = captureCanvas.getContext('2d');

  // Display canvas for inbound (swapped) frames
  const displayCanvas = document.getElementById('remote-canvas');
  displayCanvas.width  = 640;
  displayCanvas.height = 360;
  const displayCtx = displayCanvas.getContext('2d');

  ws = new WebSocket(`ws://${ip}:${port}/ws`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    videoCard.style.display = 'flex';
    setLog(`Streaming — ${ip}:${port}`);

    // Tick at 15 fps; natural back-pressure via waitingReply keeps it paced to GPU speed
    captureTimer = setInterval(() => {
      if (waitingReply || ws.readyState !== WebSocket.OPEN) return;
      captureCtx.drawImage(captureVideo, 0, 0, 640, 360);
      captureCanvas.toBlob((blob) => {
        if (!blob || ws.readyState !== WebSocket.OPEN) return;
        blob.arrayBuffer().then((buf) => {
          ws.send(buf);
          waitingReply = true;
        });
      }, 'image/jpeg', 0.80);
    }, 1000 / 15);
  };

  ws.onmessage = (event) => {
    waitingReply = false;
    // Decode returned JPEG and paint onto display canvas
    const blob = new Blob([event.data], { type: 'image/jpeg' });
    createImageBitmap(blob).then((bitmap) => {
      displayCtx.drawImage(bitmap, 0, 0, displayCanvas.width, displayCanvas.height);
    });
  };

  ws.onerror = () => setLog('Stream error — check GPU pod');
  ws.onclose = () => {
    waitingReply = false;
    if (gpuIp) setLog('Stream disconnected');
  };
}

function stopStreaming() {
  gpuIp = null;
  clearInterval(captureTimer);
  captureTimer = null;
  waitingReply = false;

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

