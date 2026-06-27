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

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer
    _HAVE_AIORTC = True
except Exception:
    _HAVE_AIORTC = False

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
_init_error = None
try:
    pipeline = FaceSwapPipeline(PipelineConfig())
except Exception as e:
    log.error('Pipeline init failed (CUDA / GPU issue): %s', e)
    pipeline = None
    _init_error = str(e)

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

if pipeline is not None:
    threading.Thread(target=_cuda_warmup, daemon=True).start()

# FPS tracking (module-level so it persists across frames)
_fps_frame_count = 0
_fps_window_start = 0.0
_last_out_fps = 0.0   # exposed via /stats
# Cache JPEG encode param lists to avoid repeated list allocation
_jpeg_params_cache: dict = {}


def _full_pipeline(raw_bytes: bytes):
    """
    Runs entirely off the event loop (called via asyncio.to_thread).
    decode → resize → GPU swap → resize → JPEG encode
    Returns (buf_bytes, frame_ms) or (None, 0) on failure.
    """
    if pipeline is None:
        return None, 0.0

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
        global _fps_frame_count, _fps_window_start, _last_out_fps
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
                _last_out_fps = fps
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
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised (GPU failure)'}, status=503)
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
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised (GPU failure)'}, status=503)
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


# --- Swapper model selection (inswapper / hyperswap / ghost) ---
async def handle_set_swapper(request):
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised'}, status=503)
    try:
        data = await request.json()
    except Exception:
        return web.json_response({'error': 'Invalid JSON'}, status=400)
    name = data.get('swapper')
    try:
        applied = pipeline.set_swapper(name)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=400)
    return web.json_response({'ok': True, 'swapper': applied})


# --- Stats (rolling timings, so tuning doesn't require log scraping) ---
async def handle_stats(request):
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised'}, status=503)
    s = pipeline.get_stats()
    s['out_fps'] = round(_last_out_fps, 1)
    s['face_set'] = pipeline.ready
    return web.json_response(s)


# --- Health ---
async def handle_health(request):
    if _init_error or pipeline is None:
        return web.json_response({'ok': False, 'gpu': False, 'error': _init_error or 'Pipeline not initialised'})
    return web.json_response({'ok': True, 'gpu': True, 'face_set': pipeline.ready,
                              'profile': pipeline.profile, 'webrtc': _HAVE_AIORTC,
                              'ice_servers': _ice_servers_dicts()})


# --- WebRTC data-channel transport (UDP — robust on high-RTT / lossy / mobile links) ---
_rtc_pcs = set()


def _ice_servers_dicts():
    """ICE servers as plain dicts. STUN alone can't traverse RunPod's symmetric NAT, so
    a TURN relay is required — configured via env (TURN_URL/TURN_USER/TURN_PASS) so it's a
    pod-config change, not a rebuild. The same list is handed to the client via /health."""
    servers = [{'urls': ['stun:stun.l.google.com:19302']}]
    turn = os.environ.get('TURN_URL')
    if turn:
        s = {'urls': [turn]}
        if os.environ.get('TURN_USER'):
            s['username'] = os.environ['TURN_USER']
        if os.environ.get('TURN_PASS'):
            s['credential'] = os.environ['TURN_PASS']
        servers.append(s)
    return servers


async def handle_offer(request):
    """Client opens a datachannel and sends JPEG frames over it; we run the SAME pipeline
    and send swapped JPEG back. Same single-slot 'newest wins' processing as the WS path."""
    if not _HAVE_AIORTC:
        return web.json_response({'error': 'WebRTC not built on this node'}, status=501)
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised'}, status=503)

    params = await request.json()
    config = RTCConfiguration(iceServers=[RTCIceServer(**s) for s in _ice_servers_dicts()])
    pc = RTCPeerConnection(configuration=config)
    _rtc_pcs.add(pc)
    log.info('WebRTC offer from %s', request.remote)

    @pc.on('connectionstatechange')
    async def _on_state():
        log.info('WebRTC connection state: %s', pc.connectionState)
        if pc.connectionState in ('failed', 'closed', 'disconnected'):
            await pc.close()
            _rtc_pcs.discard(pc)

    @pc.on('datachannel')
    def _on_datachannel(channel):
        latest = [None]
        ev = asyncio.Event()

        async def _proc_loop():
            while True:
                await ev.wait()
                ev.clear()
                raw = latest[0]
                latest[0] = None
                if raw is None:
                    continue
                try:
                    buf, _ms = await asyncio.to_thread(_full_pipeline, raw)
                except Exception as e:
                    log.warning('WebRTC frame error: %s', e)
                    continue
                if buf and channel.readyState == 'open':
                    try:
                        channel.send(buf)
                    except Exception:
                        break

        task = asyncio.ensure_future(_proc_loop())

        @channel.on('message')
        def _on_message(message):
            if isinstance(message, (bytes, bytearray)):
                latest[0] = bytes(message)   # newest frame wins
                ev.set()

        @channel.on('close')
        def _on_close():
            task.cancel()

    await pc.setRemoteDescription(RTCSessionDescription(sdp=params['sdp'], type=params['type']))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    return web.json_response({'sdp': pc.localDescription.sdp, 'type': pc.localDescription.type})


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
    cors.add(app.router.add_get('/stats', handle_stats))
    cors.add(app.router.add_post('/set-swapper', handle_set_swapper))
    if _HAVE_AIORTC:
        cors.add(app.router.add_post('/offer', handle_offer))

    return app


if __name__ == '__main__':
    app = build_app()
    log.info('Chimera Lite GPU node starting on port 8765')
    web.run_app(app, host='0.0.0.0', port=8765)
