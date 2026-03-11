"""
Chimera Lite v1.1 — GPU Node WebSocket + HTTP Server

Client sends raw camera frames as binary JPEG over WebSocket.
Server runs face-swap pipeline and returns processed JPEG.
No TURN/STUN needed — plain TCP over the port RunPod already maps.

Endpoints:
  WS   /ws        — bidirectional JPEG frame stream
  POST /set-face  — receive identity image from backend
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
from aiohttp import web, WSMsgType
import aiohttp_cors

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

# FPS tracking (module-level so it persists across frames)
_fps_frame_count = 0
_fps_window_start = 0.0
# Cache JPEG encode param lists to avoid repeated list allocation
_jpeg_params_cache: dict = {}


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


# --- WebSocket stream handler ---
async def handle_ws(request):
    global _fps_frame_count, _fps_window_start

    ws = web.WebSocketResponse(max_msg_size=5 * 1024 * 1024)
    await ws.prepare(request)
    log.info('WS connected from %s', request.remote)

    # Single-slot buffer: newest frame always wins, stale frames are dropped.
    latest = [None]
    frame_event = asyncio.Event()

    _recv_count = 0
    _recv_t0 = [0.0]

    async def process_loop():
        global _fps_frame_count, _fps_window_start
        while not ws.closed:
            await frame_event.wait()
            frame_event.clear()
            raw_bytes = latest[0]
            if raw_bytes is None:
                continue
            latest[0] = None

            try:
                t_submit = time.perf_counter()
                buf, frame_ms = await asyncio.to_thread(_full_pipeline, raw_bytes)
            except Exception as e:
                log.warning('Frame error: %s', e)
                continue

            if buf is None:
                continue

            # If a newer frame arrived while we were processing, skip sending
            # this stale result — the client will receive the fresher frame next.
            if latest[0] is not None:
                continue

            try:
                await ws.send_bytes(buf)
            except Exception:
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

    proc_task = asyncio.create_task(process_loop())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                # Store raw bytes — decode happens inside the thread, not on the event loop
                latest[0] = bytes(msg.data)
                _recv_count += 1
                if _recv_t0[0] == 0.0:
                    _recv_t0[0] = time.perf_counter()
                frame_event.set()
            elif msg.type == WSMsgType.ERROR:
                log.error('WS error: %s', ws.exception())
                break
    finally:
        proc_task.cancel()
        try:
            await proc_task
        except asyncio.CancelledError:
            pass

    log.info('WS client disconnected')
    return ws


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


# --- App setup ---
def build_app():
    app = web.Application(client_max_size=10 * 1024 * 1024)

    cors = aiohttp_cors.setup(app, defaults={
        '*': aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers='*', allow_headers='*')
    })

    cors.add(app.router.add_get('/ws', handle_ws))
    cors.add(app.router.add_post('/set-face', handle_set_face))
    cors.add(app.router.add_post('/set-mode', handle_set_mode))
    cors.add(app.router.add_get('/health', handle_health))

    return app


if __name__ == '__main__':
    app = build_app()
    log.info('Chimera Lite GPU node starting on port 8765')
    web.run_app(app, host='0.0.0.0', port=8765)
