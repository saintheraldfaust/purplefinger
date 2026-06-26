# Purplefinger GPU node

The inference node that runs the face-swap pipeline (InsightFace `inswapper_128`
+ GFPGAN) on an NVIDIA GPU and serves a WebSocket on port **8765**. The desktop
client connects to it directly at `ws://<host>:8765`.

You can run this on any machine/host with an NVIDIA GPU — your own box, a rented
GPU server, or a cloud GPU provider (e.g. RunPod). There is no control plane;
you start the node and point the client at it.

## Run the prebuilt image

```bash
docker run --gpus all -p 8765:8765 \
  ghcr.io/saintheraldfaust/purplefinger-gpu:latest
```

On boot it pulls the latest inference code, downloads the models on first run
(cache them on a volume to skip this next time), and starts the server. Healthy
startup logs end with `Chimera Lite GPU node starting on port 8765`.

Then enter `ws://<host>:8765` in the client's **GPU node** field.

> Hosting on a remote box (or RunPod): expose TCP port `8765`. Providers often
> remap it to a public `IP:PORT` — use that, e.g. `ws://203.0.113.5:40123`.

## Build it yourself

The heavy CUDA/PyTorch deps are baked into the image, so it's a big build:

```bash
cd chimera-lite/gpu-node
docker build -f docker/Dockerfile -t purplefinger-gpu .
docker run --gpus all -p 8765:8765 purplefinger-gpu
```

To publish to your own registry:

```bash
PURPLEFINGER_GPU_IMAGE=ghcr.io/<you>/purplefinger-gpu ./build-and-push.sh
```

Rebuild the image only when dependencies (`docker/requirements.txt`), the
`Dockerfile`, or `bootstrap.sh` change — plain inference-code edits are picked up
by the node's `git pull` on boot.

## API (port 8765)

- `GET  /health` — readiness (`{ ok, gpu }`)
- `POST /set-face` — multipart `face` image (the identity to swap to)
- `POST /set-mode` — `{ profile }` quality/stream profile
- `WS   /ws` — JPEG frame stream (client sends camera frames, receives swapped)
