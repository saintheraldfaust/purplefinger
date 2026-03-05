const btnUpload   = document.getElementById('btn-upload');
const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const faceInput   = document.getElementById('face-input');
const facePreview = document.getElementById('face-preview');
const statusBadge = document.getElementById('status-badge');
const log         = document.getElementById('log');
const videoCard   = document.getElementById('video-card');
const remoteVideo = document.getElementById('remote-video');
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

// --- WebRTC state ---
let pc          = null;
let localStream = null;
let gpuIp       = null;
let gpuPort     = null;

async function startWebRTC(ip, port) {
  gpuIp = ip;
  gpuPort = port;
  const GPU_URL = `http://${ip}:${port}`;

  setLog('Requesting camera...');
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  localVideo.srcObject = localStream;

  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: 'turn:global.relay.metered.ca:80',               username: '4f5aec68a87bea53ff28aba4', credential: '1kfKtDRUDxLPNhrT' },
      { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '4f5aec68a87bea53ff28aba4', credential: '1kfKtDRUDxLPNhrT' },
      { urls: 'turn:global.relay.metered.ca:443',              username: '4f5aec68a87bea53ff28aba4', credential: '1kfKtDRUDxLPNhrT' },
    ],
  });

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  // Force H264 — aiortc's VP8 decoder (libvpx) is broken on the GPU image
  const videoTx = pc.getTransceivers().find(t => t.sender.track?.kind === 'video');
  if (videoTx && RTCRtpSender.getCapabilities) {
    const caps = RTCRtpSender.getCapabilities('video');
    const h264 = caps.codecs.filter(c => c.mimeType === 'video/H264');
    if (h264.length > 0) videoTx.setCodecPreferences(h264);
  }

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering (max 3s)
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { if (pc.iceGatheringState === 'complete') resolve(); };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 3000);
  });

  setLog('Connecting to GPU node...');
  const res = await fetch(`${GPU_URL}/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
  });

  if (!res.ok) throw new Error(`GPU signaling failed: ${res.status}`);

  const answer = await res.json();
  await pc.setRemoteDescription(new RTCSessionDescription(answer));

  videoCard.style.display = 'flex';
  setLog(`Streaming — ${ip}:${port}`);
}

function stopWebRTC() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  remoteVideo.srcObject = null;
  localVideo.srcObject  = null;
  videoCard.style.display = 'none';
  gpuIp = null;
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

    await startWebRTC(data.endpoint.ip, data.endpoint.port);
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

  stopWebRTC();

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

// --- Init: check existing session ---
(async () => {
  try {
    const data = await window.chimera.getStatus();
    if (data.active) {
      setStatus('Active', 'active');
      btnStart.style.display = 'none';
      btnStop.style.display  = 'block';
      setLog('Reconnecting WebRTC...');
      await startWebRTC(data.endpoint.ip, data.endpoint.port);
    }
  } catch (_) {}
})();
