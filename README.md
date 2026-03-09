# Purplefinger

![Purplefinger preview](purplefingermedia/purplefinger%20v1.png)

Purplefinger is my open-source live face-swap system for calls, streams, recordings, and real-time identity transformation experiments.

I built it to push toward a near-instant pipeline: faster streaming, better swap quality, stronger identity consistency, and a setup that can actually be used in live social environments.

At its core, Purplefinger is designed for:
- live face swap calls
- real-time avatar and character performance
- parody, cosplay, roleplay, and entertainment
- private visual effects experiments
- livestream overlays and OBS workflows
- social app testing on platforms like WhatsApp, Telegram, Discord, and similar tools

This project should be used responsibly and with consent. It is not intended for deception, fraud, impersonation abuse, or non-consensual misuse.

## What it is

Purplefinger is made of three parts:

1. A local Electron client
   - captures webcam video
   - sends frames to the GPU node
   - displays the swapped output
   - exposes a local OBS browser source

2. A Node.js backend
   - runs as a hosted control plane
   - starts and stops RunPod GPU sessions
   - stores the selected stream mode and uploaded identity image
   - forwards configuration to the GPU node

3. A Python GPU node
   - runs on RunPod
   - receives live frames over WebSocket
   - performs the face swap
   - returns processed frames back to the client

## Current architecture

```text
Local Electron Client
  ├─ webcam capture
  ├─ UI and preview
  ├─ OBS local browser source
  └─ direct frame stream to RunPod GPU node

Hosted Backend (Render)
  ├─ session orchestration
  ├─ RunPod lifecycle control
  └─ face/profile forwarding

RunPod GPU Node
  ├─ aiohttp WebSocket server
  ├─ InsightFace inswapper_128
  ├─ GFPGAN enhancement path
  └─ real-time swap pipeline
```

## Main capabilities

- Hosted backend support through Render
- Local Windows Electron client for end users
- Portable EXE build flow
- In-app connection settings for backend URL, API token, and OBS port
- Local OBS Browser Source relay on `http://localhost:7891`
- RunPod-backed GPU inference
- Realtime and quality modes
- Low-light capture compensation in realtime mode
- Identity upload flow for source face selection
- Custom launch screen, app icon, and packaged metadata

## Primary use cases

### 1. Live social calls
Purplefinger was primarily built for real-time face-swapped calls in social apps. That includes platforms such as WhatsApp, Telegram, Discord, and similar video-call tools.

### 2. Streaming and OBS workflows
Because the client exposes a local browser source, it works naturally with OBS-based capture and live production setups.

### 3. Character performance
It can be used for stylized identity transformation, virtual persona performance, parody, satire, and creative demos.

### 4. Research and iteration
It is also a working playground for improving latency, transport reliability, and identity realism in practical real-time face-swap systems.

## My goal

My goal with Purplefinger is simple:

- make the pipeline feel near instant
- improve streaming stability
- improve swap fidelity and identity realism
- keep the system practical enough for real live use
- make the software easy to run, share, and extend

This project is still actively being refined in exactly those directions.

## Repository layout

- [chimera-lite/backend](chimera-lite/backend) — Node.js backend for Render / RunPod orchestration
- [chimera-lite/electron-client](chimera-lite/electron-client) — Windows Electron app and packaging
- [chimera-lite/gpu-node](chimera-lite/gpu-node) — Python inference node for RunPod
- [render.yaml](render.yaml) — Render deployment blueprint
- [chimera-lite/electron-client/SHARING.md](chimera-lite/electron-client/SHARING.md) — EXE sharing notes

## Hosted backend

The backend is designed to run as a web service on Render.

Expected environment variables include:
- `API_TOKEN`
- `RUNPOD_API_KEY`
- `RUNPOD_TEMPLATE_ID`
- optional `RUNPOD_NETWORK_VOLUME_ID`
- optional `RUNPOD_GPU_TYPE`

The Render blueprint lives in [render.yaml](render.yaml).

## Electron client

The Electron client runs locally on the end-user machine.

It can:
- save connection settings locally
- talk to the hosted backend
- upload the identity face image
- stream frames directly to the GPU node
- feed OBS locally through `localhost`

For packaged sharing, see [chimera-lite/electron-client/SHARING.md](chimera-lite/electron-client/SHARING.md).

## OBS integration

Purplefinger exposes a local browser source for OBS.

Use this in OBS Browser Source:

```text
http://localhost:7891
```

That keeps the final preview and broadcast path local to the user machine.

## Building the Windows app

From [chimera-lite/electron-client](chimera-lite/electron-client):

```bash
npm install
npm run dist
```

Portable output:

```text
dist/Chimera-Lite-1.0.0-Portable.exe
```

## Configuration

The client can be configured either:
- through the in-app connection settings screen
- or through a local `.env` file beside the EXE

Example values:

```dotenv
BACKEND_URL=https://purplefinger-chimera.onrender.com
API_TOKEN=replace-with-your-token
OBS_PORT=7891
```

## Contributing

I want contributors.

If you care about:
- lower latency
- stronger identity preservation
- better transport design
- cleaner UI/UX
- packaging and deployment
- GPU pipeline optimization
- face detail quality
- better live-call usability

then contribute.

Open issues, suggest architecture improvements, submit pull requests, or help test on real networks and real hardware.

Areas where help is especially valuable:
- transport improvements beyond JPEG-over-WebSocket
- better queue control and recovery behavior
- faster startup and lower end-to-end latency
- quality improvements without motion instability
- packaging, updater flow, and release automation
- self-hosting documentation

## Responsible use

Please use Purplefinger responsibly.

Do not use it for:
- impersonation abuse
- deception without consent
- fraud
- harassment
- identity misuse

Use it for creative, consensual, and legitimate workflows.

## Notes

Purplefinger is evolving quickly. Expect iteration. The current priority is making the live pipeline faster, cleaner, and more convincing.
