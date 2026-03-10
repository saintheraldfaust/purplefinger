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


def decode_latest_frame(frame_bytes: bytes):
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    runtime = pipeline.get_runtime_settings()
    proc_w = runtime['proc_w']
    proc_h = runtime['proc_h']
    jpeg_quality = runtime['jpeg_quality']

    h, w = img.shape[:2]
    if w != proc_w or h != proc_h:
        small = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR)
    else:
        small = img

    return {
        'small': small,
        'orig_w': w,
        'orig_h': h,
        'proc_w': proc_w,
        'proc_h': proc_h,
        'jpeg_quality': jpeg_quality,
        'decoded_at': time.perf_counter(),
    }


def process_decoded_frame(frame_packet):
    if frame_packet is None:
        return None

    t0 = time.perf_counter()
    swapped_small = pipeline.process_frame(frame_packet['small'])
    frame_packet['swapped_small'] = swapped_small
    frame_packet['frame_ms'] = (time.perf_counter() - t0) * 1000
    frame_packet['processed_at'] = time.perf_counter()
    return frame_packet


def encode_processed_frame(frame_packet):
    if frame_packet is None:
        return None

    out = (
        frame_packet['swapped_small']
        if (frame_packet['orig_w'] == frame_packet['proc_w'] and frame_packet['orig_h'] == frame_packet['proc_h'])
        else cv2.resize(
            frame_packet['swapped_small'],
            (frame_packet['orig_w'], frame_packet['orig_h']),
            interpolation=cv2.INTER_LINEAR,
        )
    )
    ok, buf = cv2.imencode('.jpg', out, [cv2.IMWRITE_JPEG_QUALITY, frame_packet['jpeg_quality']])
    if not ok:
        return None

    return {
        'buf': buf.tobytes(),
        'frame_ms': frame_packet['frame_ms'],
        'produced_at': time.perf_counter(),
    }


# --- WebSocket stream handler ---
async def handle_ws(request):
    global _fps_frame_count, _fps_window_start

    ws = web.WebSocketResponse(max_msg_size=5 * 1024 * 1024)
    await ws.prepare(request)
    log.info('WS connected from %s', request.remote)

    latest_in = [None]
    latest_decoded = [None]
    latest_processed = [None]
    latest_out = [None]
    recv_event = asyncio.Event()      # signals decode_loop immediately when frame bytes arrive
    decoded_event = asyncio.Event()   # signals process_loop immediately when a decoded frame is ready
    processed_event = asyncio.Event() # signals encode_loop immediately when a processed frame is ready
    send_event = asyncio.Event()      # signals send_loop immediately when a processed frame is ready

    _recv_count = 0
    _recv_t0 = [0.0]

    async def decode_loop():
        while not ws.closed:
            await recv_event.wait()
            recv_event.clear()

            frame_bytes = latest_in[0]
            if frame_bytes is None:
                continue
            latest_in[0] = None

            try:
                packet = await asyncio.to_thread(decode_latest_frame, frame_bytes)
            except Exception as e:
                log.warning('Decode error: %s', e)
                continue

            if packet is None:
                continue

            latest_decoded[0] = packet
            decoded_event.set()

    async def process_loop():
        while not ws.closed:
            await decoded_event.wait()
            decoded_event.clear()

            frame_packet = latest_decoded[0]
            if frame_packet is None:
                continue
            latest_decoded[0] = None

            try:
                packet = await asyncio.to_thread(process_decoded_frame, frame_packet)
            except Exception as e:
                log.warning('Process error: %s', e)
                continue

            if packet is None:
                continue

            latest_processed[0] = packet
            processed_event.set()

    async def encode_loop():
        while not ws.closed:
            await processed_event.wait()
            processed_event.clear()

            frame_packet = latest_processed[0]
            if frame_packet is None:
                continue
            latest_processed[0] = None

            try:
                packet = await asyncio.to_thread(encode_processed_frame, frame_packet)
            except Exception as e:
                log.warning('Encode error: %s', e)
                continue

            if packet is None:
                continue

            latest_out[0] = packet
            send_event.set()

    async def send_loop():
        global _fps_frame_count, _fps_window_start
        while not ws.closed:
            await send_event.wait()
            send_event.clear()

            packet = latest_out[0]
            if packet is None:
                continue
            latest_out[0] = None

            try:
                await ws.send_bytes(packet['buf'])
            except Exception:
                break

            _fps_frame_count += 1
            now = time.perf_counter()
            if _fps_window_start == 0.0:
                _fps_window_start = now
            elif _fps_frame_count % 30 == 0:
                fps = 30.0 / max(now - _fps_window_start, 1e-6)
                recv_fps = _recv_count / max(now - _recv_t0[0], 1e-6) if _recv_t0[0] else 0
                queue_ms = (now - packet['produced_at']) * 1000
                log.info(
                    'out FPS=%.1f  in FPS=%.1f  last_frame=%.0fms  send_wait=%.0fms',
                    fps,
                    recv_fps,
                    packet['frame_ms'],
                    queue_ms,
                )
                _fps_window_start = now

    decode_task = asyncio.create_task(decode_loop())
    proc_task = asyncio.create_task(process_loop())
    encode_task = asyncio.create_task(encode_loop())
    send_task = asyncio.create_task(send_loop())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                latest_in[0] = bytes(msg.data)
                _recv_count += 1
                if _recv_t0[0] == 0.0:
                    _recv_t0[0] = time.perf_counter()
                recv_event.set()  # wake decode_loop immediately
            elif msg.type == WSMsgType.ERROR:
                log.error('WS error: %s', ws.exception())
                break
    finally:
        decode_task.cancel()
        proc_task.cancel()
        encode_task.cancel()
        send_task.cancel()
        try:
            await decode_task
        except asyncio.CancelledError:
            pass
        try:
            await proc_task
        except asyncio.CancelledError:
            pass
        try:
            await encode_task
        except asyncio.CancelledError:
            pass
        try:
            await send_task
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
