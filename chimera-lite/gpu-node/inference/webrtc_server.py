"""
Chimera Lite v1.1 — GPU Node WebRTC DataChannel + HTTP Server

Client sends raw camera JPEG frames over a WebRTC DataChannel (unreliable,
unordered — UDP semantics). Server runs face-swap pipeline and sends back
processed JPEG over the same channel. No TURN needed for RunPod pods with a
direct public IP.

Endpoints:
  POST /offer     — SDP offer/answer exchange (vanilla ICE)
  POST /set-face  — receive identity image from backend
  POST /set-mode  — switch stream profile
  GET  /health    — liveness check
"""

import sys
import os
import asyncio
import logging
import time
import threading

import cv2
import numpy as np
from aiohttp import web
import aiohttp_cors
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import FaceSwapPipeline, PipelineConfig

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('chimera')

# --- GPU check ---
import torch
if torch.cuda.is_available():
    log.info('CUDA available: %s (device 0: %s)', torch.version.cuda, torch.cuda.get_device_name(0))
else:
    log.warning('CUDA NOT available — running on CPU, expect slow performance')

# --- Global state ---
pipeline = FaceSwapPipeline(PipelineConfig())
pcs: set = set()  # active RTCPeerConnections

# Pre-warm CUDA allocator so the first client frame doesn't pay JIT cost
def _cuda_warmup():
    try:
        if torch.cuda.is_available():
            d = torch.zeros(1, 3, 128, 128, device='cuda')
            _ = d * d
            torch.cuda.synchronize()
            del d
            torch.cuda.empty_cache()
            log.info('CUDA warmup complete')
    except Exception as e:
        log.warning('CUDA warmup skipped: %s', e)

threading.Thread(target=_cuda_warmup, daemon=True).start()

# Cache JPEG encode param lists to avoid repeated list allocation
_jpeg_params_cache: dict = {}

# FPS tracking (module-level, resets per 30-frame window)
_fps_frame_count = 0
_fps_window_start = 0.0


def _full_pipeline(raw_bytes: bytes):
    """
    Runs entirely off the event loop (called via asyncio.to_thread).
    decode → resize → GPU swap → resize → JPEG encode
    Returns (buf_bytes, frame_ms) or (None, 0) on failure.
    """
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None, 0.0

    runtime = pipeline.get_runtime_settings()
    proc_w = runtime['proc_w']
    proc_h = runtime['proc_h']
    jpeg_quality = runtime['jpeg_quality']

    orig_h, orig_w = img.shape[:2]
    small = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR) \
        if (orig_w != proc_w or orig_h != proc_h) else img

    t0 = time.perf_counter()
    swapped = pipeline.process_frame(small)
    frame_ms = (time.perf_counter() - t0) * 1000

    out = cv2.resize(swapped, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR) \
        if (orig_w != proc_w or orig_h != proc_h) else swapped

    jpeg_params = _jpeg_params_cache.get(jpeg_quality)
    if jpeg_params is None:
        jpeg_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
        _jpeg_params_cache[jpeg_quality] = jpeg_params

    ok, buf = cv2.imencode('.jpg', out, jpeg_params)
    if not ok:
        return None, 0.0

    return buf.tobytes(), frame_ms


# --- WebRTC signalling ---

_RTC_CONFIG = RTCConfiguration(
    iceServers=[RTCIceServer(urls=['stun:stun.l.google.com:19302'])]
)


async def handle_offer(request):
    global _fps_frame_count, _fps_window_start

    try:
        params = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    offer = RTCSessionDescription(sdp=params['sdp'], type=params['type'])

    pc = RTCPeerConnection(configuration=_RTC_CONFIG)
    pc_id = f'pc-{id(pc)}'
    pcs.add(pc)
    log.info('%s created', pc_id)

    @pc.on('connectionstatechange')
    async def on_connectionstatechange():
        log.info('%s state → %s', pc_id, pc.connectionState)
        if pc.connectionState in ('failed', 'closed', 'disconnected'):
            await pc.close()
            pcs.discard(pc)

    @pc.on('datachannel')
    def on_datachannel(channel):
        global _fps_frame_count, _fps_window_start
        log.info('%s datachannel "%s" opened', pc_id, channel.label)

        # Single-slot frame buffer: newest frame wins, stale frames are dropped.
        latest: list = [None]
        frame_event = asyncio.Event()
        _recv_count = 0
        _recv_t0: list = [0.0]

        async def process_loop():
            global _fps_frame_count, _fps_window_start
            while True:
                # Wait for a new frame with a keepalive timeout
                try:
                    await asyncio.wait_for(frame_event.wait(), timeout=10.0)
                except asyncio.TimeoutError:
                    if channel.readyState != 'open':
                        break
                    continue

                frame_event.clear()
                raw_bytes = latest[0]
                if raw_bytes is None:
                    continue
                latest[0] = None

                t_submit = time.perf_counter()
                try:
                    buf, frame_ms = await asyncio.to_thread(_full_pipeline, raw_bytes)
                except Exception as e:
                    log.warning('Frame error: %s', e)
                    continue

                if buf is None:
                    continue

                try:
                    channel.send(buf)
                except Exception as e:
                    log.warning('Send error: %s', e)
                    break

                _fps_frame_count += 1
                now = time.perf_counter()
                if _fps_window_start == 0.0:
                    _fps_window_start = now
                elif _fps_frame_count % 30 == 0:
                    fps = 30.0 / max(now - _fps_window_start, 1e-6)
                    recv_fps = _recv_count / max(now - _recv_t0[0], 1e-6) if _recv_t0[0] else 0
                    total_ms = (now - t_submit) * 1000
                    log.info(
                        'out FPS=%.1f  in FPS=%.1f  process=%.0fms  total=%.0fms',
                        fps, recv_fps, frame_ms, total_ms,
                    )
                    _fps_window_start = now

        # Start the process loop immediately — it waits for frame_event
        asyncio.ensure_future(process_loop())

        @channel.on('message')
        def on_message(message):
            nonlocal _recv_count
            if not isinstance(message, (bytes, bytearray)):
                return
            latest[0] = bytes(message)
            _recv_count += 1
            if _recv_t0[0] == 0.0:
                _recv_t0[0] = time.perf_counter()
            frame_event.set()

        @channel.on('close')
        def on_close():
            log.info('%s datachannel closed', pc_id)

    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.json_response({
        'sdp': pc.localDescription.sdp,
        'type': pc.localDescription.type,
    })


# --- Face upload ---
async def handle_set_face(request):
    reader = await request.multipart()
    field = await reader.next()
    data = await field.read()

    img_array = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        return web.json_response({'error': 'Invalid image'}, status=400)

    pipeline.set_identity(img)
    log.info('Identity face set (%dx%d)', img.shape[1], img.shape[0])
    return web.json_response({'ok': True})


async def handle_set_mode(request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)

    profile = data.get('profile')
    if not isinstance(profile, str):
        return web.json_response({'error': 'Missing profile'}, status=400)

    try:
        pipeline.set_profile(profile)
    except ValueError as e:
        return web.json_response({'error': str(e)}, status=400)

    return web.json_response({'ok': True, 'profile': pipeline.profile})


# --- Health ---
async def handle_health(request):
    return web.json_response({'ok': True, 'face_set': pipeline.ready, 'profile': pipeline.profile})


# --- Shutdown ---
async def on_shutdown(app):
    await asyncio.gather(*[pc.close() for pc in pcs], return_exceptions=True)
    pcs.clear()


# --- App setup ---
def build_app():
    app = web.Application(client_max_size=10 * 1024 * 1024)
    app.on_shutdown.append(on_shutdown)

    cors = aiohttp_cors.setup(app, defaults={
        '*': aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers='*',
            allow_headers='*',
            allow_methods=['POST', 'GET', 'OPTIONS'],
        )
    })

    cors.add(app.router.add_post('/offer', handle_offer))
    cors.add(app.router.add_post('/set-face', handle_set_face))
    cors.add(app.router.add_post('/set-mode', handle_set_mode))
    cors.add(app.router.add_get('/health', handle_health))

    return app


if __name__ == '__main__':
    app = build_app()
    log.info('Chimera Lite GPU node starting on port 8765')
    web.run_app(app, host='0.0.0.0', port=8765)
