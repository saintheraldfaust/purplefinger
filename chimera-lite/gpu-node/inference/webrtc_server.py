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

# Fallback: add volume pyprefix to path in case bootstrap used --prefix
import asyncio
import logging
import time

import cv2
import numpy as np
from aiohttp import web, WSMsgType
import aiohttp_cors

# Pipeline lives in the same directory as this file
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

# FPS tracking (module-level so it persists across frames)
_fps_frame_count = 0
_fps_window_start = 0.0


# Processing resolution — lower = faster detection/swap, same quality for webcam faces
_PROC_W, _PROC_H = 480, 270


# --- WebSocket stream handler ---
async def handle_ws(request):
    global _fps_frame_count, _fps_window_start

    ws = web.WebSocketResponse(max_msg_size=5 * 1024 * 1024)
    await ws.prepare(request)
    log.info('WS connected from %s', request.remote)

    latest = [None]
    frame_event = asyncio.Event()  # signals process_loop immediately when frame arrives

    _recv_count = 0
    _recv_t0 = [0.0]

    async def process_loop():
        global _fps_frame_count, _fps_window_start
        while not ws.closed:
            await frame_event.wait()
            frame_event.clear()
            img = latest[0]
            if img is None:
                continue
            latest[0] = None

            h, w = img.shape[:2]
            if w != _PROC_W or h != _PROC_H:
                small = cv2.resize(img, (_PROC_W, _PROC_H), interpolation=cv2.INTER_LINEAR)
            else:
                small = img

            try:
                t0 = time.perf_counter()
                swapped_small = await asyncio.to_thread(pipeline.process_frame, small)
                frame_ms = (time.perf_counter() - t0) * 1000
                out = swapped_small if (w == _PROC_W and h == _PROC_H) else \
                    cv2.resize(swapped_small, (w, h), interpolation=cv2.INTER_LINEAR)
                _, buf = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, 85])
            except Exception as e:
                log.warning('Frame error: %s', e)
                continue

            try:
                await ws.send_bytes(buf.tobytes())
            except Exception:
                break

            _fps_frame_count += 1
            now = time.perf_counter()
            if _fps_window_start == 0.0:
                _fps_window_start = now
            elif _fps_frame_count % 30 == 0:
                fps = 30.0 / max(now - _fps_window_start, 1e-6)
                recv_fps = _recv_count / max(now - _recv_t0[0], 1e-6) if _recv_t0[0] else 0
                log.info('out FPS=%.1f  in FPS=%.1f  last_frame=%.0fms', fps, recv_fps, frame_ms)
                _fps_window_start = now

    proc_task = asyncio.create_task(process_loop())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                arr = np.frombuffer(msg.data, dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is not None:
                    latest[0] = img
                    _recv_count += 1
                    if _recv_t0[0] == 0.0:
                        _recv_t0[0] = time.perf_counter()
                    frame_event.set()  # wake process_loop immediately
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


# --- Health ---
async def handle_health(request):
    return web.json_response({'ok': True, 'face_set': pipeline.ready})


# --- App setup ---
def build_app():
    app = web.Application(client_max_size=10 * 1024 * 1024)

    cors = aiohttp_cors.setup(app, defaults={
        '*': aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers='*', allow_headers='*')
    })

    cors.add(app.router.add_get('/ws', handle_ws))
    cors.add(app.router.add_post('/set-face', handle_set_face))
    cors.add(app.router.add_get('/health', handle_health))

    return app


if __name__ == '__main__':
    app = build_app()
    log.info('Chimera Lite GPU node starting on port 8765')
    web.run_app(app, host='0.0.0.0', port=8765)
