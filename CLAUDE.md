# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Chimera Lite v1.1** — A single-user GPU-powered real-time face-swap streaming system. See [work.md](work.md) for the full architecture specification.

No code has been implemented yet. The repository is in the design/planning phase.

## Planned System Architecture

```
Electron Client
    |
    | HTTPS (Start/Stop, Upload Face)
    v
Minimal Express Backend (Node.js)
    |
    | Provision GPU via API
    v
RTX A10G GPU Node
    |
    | Advanced Face-Swap Pipeline
    | (FaceShifter TRT FP16 + optional FOMM)
    |
    | NVENC Encode -> WebRTC
    v
Electron -> OBS Virtual Camera
```

## Planned Folder Structure

```
chimera-lite/
├── backend/          # Express.js API server (Node.js, 1 vCPU VPS)
│   ├── server.js     # POST /start /stop /upload-face GET /status
│   ├── gpuProvider.js
│   └── config.js
├── electron-client/  # Desktop app
│   ├── main.js
│   ├── preload.js
│   ├── renderer/
│   └── obs-launcher.js
├── gpu-node/         # Python inference stack (RTX A10G Ubuntu 22.04)
│   ├── inference/
│   │   ├── pipeline.py    # Main FaceSwapPipeline class
│   │   ├── engine.py      # TensorRT wrappers (FaceShifterEngine, FOMMEngine)
│   │   └── webrtc_server.py
│   ├── models/       # TensorRT .plan files (not committed)
│   ├── bootstrap.sh
│   └── build_engine.py
└── deployment/       # Setup docs for VPS and GPU AMI
```

## Key Design Decisions

- **No database** — single active session tracked in memory (`activeSession`, `uploadedFace`)
- **No multi-user** — single static API token auth
- **GPU provisioned on-demand** — destroyed after session; 3-hour safety timeout kills it on client crash
- **Inference is ROI-only** — face region cropped with padding, reducing compute 60-70%
- **FP16 TensorRT** — all models converted via `build_engine.py` before deployment
- **FOMM is optional** — toggled via `PipelineConfig.USE_FOMM`

## GPU Node Pipeline (per frame)

RetinaFace detection (every N frames) -> MediaPipe FaceMesh landmarks -> temporal smoothing (alpha=0.7) -> padded ROI crop -> FaceShifter Core FP16 -> optional FOMM stabilization -> seamlessClone blending -> NVENC encode -> WebRTC

## Backend API

| Endpoint | Method | Purpose |
|---|---|---|
| `/start` | POST | Provision GPU node, return IP |
| `/stop` | POST | Destroy GPU node |
| `/upload-face` | POST | Send identity image to GPU for embedding |
| `/status` | GET | Active session info |

## Infrastructure

- **Backend**: Small VPS or Render (1 vCPU, 512MB–1GB RAM)
- **GPU**: Vagon RTX A10G — Ubuntu 22.04, CUDA 12.x, cuDNN, TensorRT, PyTorch (CUDA)
- **WebRTC TURN**: Daily.co or self-hosted coturn
- **GPU dependencies**: MediaPipe, ONNX, aiortc, OpenCV

## Environment Variables (backend)

```
API_TOKEN=
GPU_API_KEY=
GPU_IMAGE_ID=
```
