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

import asyncio
import logging
import os
import sys
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

# --- Global state ---
pipeline = FaceSwapPipeline(PipelineConfig())

# FPS tracking (module-level so it persists across frames)
_fps_frame_count = 0
_fps_window_start = 0.0


# --- WebSocket stream handler ---
async def handle_ws(request):
    global _fps_frame_count, _fps_window_start

    ws = web.WebSocketResponse(max_msg_size=10 * 1024 * 1024)
    await ws.prepare(request)
    log.info('WebSocket client connected from %s', request.remote)

    async for msg in ws:
        if msg.type == WSMsgType.BINARY:
            try:
                # Decode incoming JPEG
                arr = np.frombuffer(msg.data, dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is None:
                    continue

                # Downscale to 360p for faster pipeline processing
                h, w = img.shape[:2]
                target_h = 360
                if h > target_h:
                    scale = target_h / h
                    small = cv2.resize(img, (int(w * scale), target_h), interpolation=cv2.INTER_LINEAR)
                else:
                    small = img
                    scale = 1.0

                t0 = time.perf_counter()
                swapped_small = await asyncio.to_thread(pipeline.process_frame, small)
                frame_ms = (time.perf_counter() - t0) * 1000

                # Scale back to original resolution
                if scale < 1.0:
                    swapped = cv2.resize(swapped_small, (w, h), interpolation=cv2.INTER_LINEAR)
                else:
                    swapped = swapped_small

                # Encode to JPEG and send back
                _, buf = cv2.imencode('.jpg', swapped, [cv2.IMWRITE_JPEG_QUALITY, 80])
                await ws.send_bytes(buf.tobytes())

                # FPS log every 30 frames
                _fps_frame_count += 1
                now = time.perf_counter()
                if _fps_window_start == 0.0:
                    _fps_window_start = now
                elif _fps_frame_count % 30 == 0:
                    fps = 30.0 / max(now - _fps_window_start, 1e-6)
                    log.info('Pipeline  FPS=%.1f  last_frame=%.0fms', fps, frame_ms)
                    _fps_window_start = now

            except Exception as e:
                log.warning('Frame error: %s', e)

        elif msg.type == WSMsgType.ERROR:
            log.error('WebSocket error: %s', ws.exception())
            break

    log.info('WebSocket client disconnected')
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
