# Chimera Lite — Current System State

**Last updated:** March 7, 2026

---

## What It Actually Is

A single-user real-time face-swap system running at **18–20 FPS** on a RunPod RTX 5090.

- **Electron client** captures your webcam, sends frames to the GPU, and displays the swapped result
- **Node.js backend** provisions/destroys the RunPod GPU pod on demand
- **Python inference server** on the GPU swaps your face with an uploaded identity photo

No WebRTC. No TURN server. No MediaPipe. No FaceShifter. No FOMM. All of that was the original design doc — none of it made it into the actual build.

---

## Architecture

```
Electron Client (your PC)
  │
  │  WebSocket (raw JPEG frames, 480×270 @ 70% quality, 20fps)
  │
  ▼
Python aiohttp server (RunPod GPU pod)
  │
  ├─ insightface inswapper_128.onnx   (face swap, CUDAExecutionProvider)
  └─ GFPGAN v1.4                      (face enhancement, torch.autocast fp16)
  │
  │  WebSocket (swapped JPEG frames back)
  │
  ▼
Electron Client (displays result in <img> tag)
```

Backend (Node.js, eventually Render) sits between the Electron client and RunPod API — it provisions the pod and returns the WebSocket URL.

---

## Infrastructure

| Component | Details |
|---|---|
| **GPU** | RunPod RTX 5090, Ubuntu 24.04 (`runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`) |
| **CUDA** | 12.8.1, PyTorch 2.8, sm_120 |
| **Python** | `/usr/bin/python3` 3.12.3, installed to system site-packages every boot |
| **Storage** | RunPod Network Volume — pip cache + model weights survive pod restarts |
| **Backend** | Node.js, runs locally (Render deploy pending) |
| **Client** | Electron |

---

## Bootstrap (`bootstrap.sh`)

Runs on every pod start via RunPod template command (curl from GitHub → bash).

1. Installs system packages (git, wget, libgl1, etc.) if missing
2. `unset PIP_CACHE_DIR` — overrides RunPod's env var that pointed to ephemeral storage
3. `pip install --cache-dir /workspace/.cache/pip` — installs to system Python, volume as download cache
   - First boot: ~5 min (downloads wheels)
   - Subsequent boots: ~60 sec (installs from cached wheels)
4. Applies `basicsr` torchvision compatibility fix (inline Python)
5. `git clone` or `git pull` latest code from GitHub to `/app`
6. Symlinks `/workspace/models` → `/app/models`
7. Downloads `GFPGANv1.4.pth` and `inswapper_128.onnx` to volume if missing
8. Starts `webrtc_server.py` (the WebSocket inference server)

**RunPod template command:**
```bash
bash -c "python -c \"import urllib.request; urllib.request.urlretrieve('https://raw.githubusercontent.com/saintheraldfaust/purplefinger/main/chimera-lite/gpu-node/bootstrap.sh', '/tmp/bs.sh')\" && bash /tmp/bs.sh"
```

---

## Inference Pipeline (`inference/`)

### `engine.py`

**`SwapEngine`**
- insightface `buffalo_l`, det_size=320×320
- `INSIGHTFACE_HOME=/workspace/.insightface` (volume cache, avoids re-download)
- `inswapper_128.onnx` on `CUDAExecutionProvider`
- Detects every frame (mouth moves too fast for stale landmarks)
- Blends swap result using face contour convex hull (lmk points 0–32), Gaussian feathered (51×51, σ=14)

**`EnhanceEngine`**
- GFPGAN v1.4, `has_aligned=True` fast path (skips internal RetinaFace)
- `torch.autocast('cuda')` for fp16 speed (avoids dtype mismatch from `.half()`)
- `ENHANCE_EVERY_N = 4` — enhances every 4th frame, passes raw swap on others
- `WEIGHT = 0.55` — blends GFPGAN output 55% with original

**`_apply_mouth_override`** (inside SwapEngine)
- Pastes real camera mouth over swapped result using kps[3]/kps[4]
- Soft elliptical Gaussian feather — prevents phantom/wrong teeth

### `pipeline.py`

- Runs SwapEngine + EnhanceEngine in sequence
- `_frame_idx` counter for ENHANCE_EVERY_N gating
- Logs per-stage timing every 30 frames: `swap=Xms enhance=Yms total=Zms`

### `webrtc_server.py`

- `aiohttp` WebSocket server
- `asyncio.Event` for immediate frame processing (no polling sleep)
- `_PROC_W, _PROC_H = 480, 270`
- Separate in/out FPS counters logged every second
- JPEG output quality 85
- Logs CUDA device at startup

---

## Client (`electron-client/`)

### `renderer/app.js`

- `SEND_W = 480, SEND_H = 270` — reduced from 640×360 to cut frame payload size
- JPEG encode quality `0.7` — ~15KB/frame vs ~60KB at 96% quality
- 20fps send timer, max 2 encodes in-flight
- Draws received frames into a `<canvas>` element

### `main.js` / `preload.js`

- Standard Electron shell
- IPC bridge: renderer ↔ main for WebSocket URL, start/stop controls

---

## Backend (`backend/`)

### `server.js`

- `POST /start` — provisions RunPod pod, polls until ready, returns `wsUrl`
- `GET /ready` — returns `{ ready: true, wsUrl }` when pod is up (non-blocking)
- `POST /stop` — terminates pod

### `gpuProvider.js`

- RunPod GraphQL API
- Attaches network volume (`RUNPOD_NETWORK_VOLUME_ID` from `.env`)
- GPU type: `NVIDIA GeForce RTX 5090`
- Template ID: `p7z3rvy5dl`

---

## Performance

| Metric | Value |
|---|---|
| Client send rate | 20 FPS |
| GPU in FPS | ~20 FPS |
| GPU out FPS | ~18–20 FPS |
| Swap time | ~26ms |
| Enhance time | ~33ms (every 4th frame) |
| Total GPU latency | ~59ms |

---

## What Works ✅

- WebSocket streaming (no TURN, no WebRTC complexity)
- 20fps OffscreenCanvas JPEG client
- Producer/consumer server (latest-frame-wins, no queue buildup)
- Bootstrap: system Python + volume pip cache, reliable every boot
- RTX 5090 compatible (sm_120, CUDA 12.8.1, PyTorch 2.8)
- GFPGAN on CUDA with autocast fp16
- Real camera mouth overlay (no phantom teeth)
- Non-blocking `/start` + `/ready` polling UI
- Network volume attached (models + pip cache persist)
- 18–20fps consistent end-to-end

## What Doesn't Work / Not Built Yet ❌

- **Audio** — no audio forwarding at all currently
- **Backend deploy** — still running locally, Render deploy not done
- **OBS virtual camera** — not implemented
- **Beard/hair transfer** — not solvable cleanly in real-time; warp approaches produce visible artifacts

---

## Known Issues & Decisions

| Issue | Root Cause | Fix |
|---|---|---|
| Corrupt pip wheel on every boot | RunPod bakes `PIP_CACHE_DIR` pointing at ephemeral storage into container env | `unset PIP_CACHE_DIR` in bootstrap |
| 3–8 FPS | Sending 640×360 @ 96% quality (~60KB/frame) saturated the WebSocket | Reduced to 480×270 @ 70% (~15KB/frame) |
| GFPGAN fp16 dtype mismatch | `.half()` on model caused "Input type (float) and bias type (c10::Half)" error | Replaced with `torch.autocast('cuda')` |
| insightface `buffalo_l` re-downloads every boot | Default `~/.insightface` is ephemeral container storage | `INSIGHTFACE_HOME=/workspace/.insightface` on volume |
| asyncio frame polling overhead | `await asyncio.sleep(0.001)` loop | Replaced with `asyncio.Event` signaling |

---

## Next Up

1. **Audio** — forward mic audio alongside video frames
2. **Backend deploy** — Render
3. **OBS virtual camera** — pipe output canvas into virtual cam device

