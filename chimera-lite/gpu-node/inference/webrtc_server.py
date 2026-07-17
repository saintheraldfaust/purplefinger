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

# PyAV (ships with aiortc) gives us an H.264 decoder for the WebCodecs uplink: the client
# encodes the webcam as H.264 (inter-frame compression → ~5-10x fewer bytes than per-frame
# JPEG), streams it over /ws-h264, and we decode → swap → JPEG back. Inert if av is absent.
try:
    import av
    import av.error
    _HAVE_H264 = 'h264' in av.codecs_available
except Exception:
    av = None
    _HAVE_H264 = False

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
    JPEG-decode → resize → GPU swap → resize → JPEG encode
    Returns (buf_bytes, frame_ms) or (None, 0) on failure.
    """
    if pipeline is None:
        return None, 0.0

    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None, 0.0
    return _process_bgr(img)


def _process_bgr(img):
    """resize → GPU swap → JPEG encode at proc res. Shared by the JPEG-uplink path
    (_full_pipeline, after cv2.imdecode) and the H.264-uplink path (after PyAV decode →
    to_ndarray('bgr24')). The downlink JPEG is emitted at proc res — NOT the input res —
    so an H.264 uplink at camera size (640x360) doesn't inflate the downlink; the client
    scales it on its display canvas. Returns (jpeg_bytes, frame_ms) or (None, 0)."""
    if pipeline is None or img is None:
        return None, 0.0

    runtime = pipeline.get_runtime_settings()
    proc_w = runtime['proc_w']
    proc_h = runtime['proc_h']
    jpeg_quality = runtime['jpeg_quality']

    orig_h, orig_w = img.shape[:2]
    small = cv2.resize(img, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR) \
        if (orig_w != proc_w or orig_h != proc_h) else img

    t0 = time.perf_counter()
    out = pipeline.process_frame(small)   # swapped, at proc res — encode directly
    frame_ms = (time.perf_counter() - t0) * 1000

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

    # compress=False: frames are already-compressed JPEG, so permessage-deflate burns
    # event-loop CPU (the thread that dispatches the GPU) for ~0% size gain. Disable it.
    ws = web.WebSocketResponse(max_msg_size=5 * 1024 * 1024, compress=False)
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


# --- H.264 (WebCodecs) uplink stream handler ---
# Client sends one Annex-B access unit per WS BINARY message (WebCodecs emits exactly one
# EncodedVideoChunk per frame). We decode EVERY message in arrival order (P-frames depend
# on predecessors) but only swap the NEWEST decoded frame. Downlink stays JPEG (robust to
# the newest-wins frame dropping; inter-frame video would break on a dropped frame).
async def handle_ws_h264(request):
    if not _HAVE_H264:
        return web.json_response({'error': 'H.264 decode not available on this node'}, status=501)
    if pipeline is None:
        return web.json_response({'error': 'Pipeline not initialised (GPU failure)'}, status=503)

    # max_msg_size=0 (unlimited): a keyframe access unit can spike past aiohttp's 4 MiB
    # default and an oversize message would close the socket. compress=False: H.264 is
    # already entropy-coded.
    ws = web.WebSocketResponse(max_msg_size=0, compress=False)
    await ws.prepare(request)
    log.info('H264 WS connected from %s', request.remote)

    # One decoder context per connection — it carries reference-frame state; never shared,
    # never touched concurrently (we await each decode sequentially).
    ctx = av.CodecContext.create('h264', 'r')
    latest = [None]                 # newest decoded BGR frame (newest-wins)
    frame_event = asyncio.Event()
    stats = {'msgs': 0, 'decoded': 0, 'out': 0, 't0': time.perf_counter()}

    def _decode_latest(data):
        """Decode one access unit; return the newest BGR ndarray or None. Runs in a thread."""
        try:
            frames = ctx.decode(av.packet.Packet(data))
        except av.error.InvalidDataError:
            return None            # corrupt AU — decoder resyncs at the next IDR on its own
        except Exception as e:
            log.warning('H264 decode error: %s', e)
            return None
        if not frames:
            return None            # e.g. before the first keyframe → []
        return frames[-1].to_ndarray(format='bgr24')

    async def process_loop():
        while not ws.closed:
            await frame_event.wait()
            frame_event.clear()
            bgr = latest[0]
            latest[0] = None
            if bgr is None:
                continue
            try:
                buf, _ms = await asyncio.to_thread(_process_bgr, bgr)
            except Exception as e:
                log.warning('H264 frame error: %s', e)
                continue
            if buf is None:
                continue
            stats['out'] += 1
            if stats['out'] % 30 == 0:
                dt = max(time.perf_counter() - stats['t0'], 1e-6)
                log.info('H264 out FPS=%.1f  msgs=%d decoded=%d out=%d',
                         stats['out'] / dt, stats['msgs'], stats['decoded'], stats['out'])
            try:
                await ws.send_bytes(buf)
            except Exception:
                break

    proc_task = asyncio.create_task(process_loop())
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                stats['msgs'] += 1
                # Decode in arrival order (sequential await keeps the ctx single-threaded).
                bgr = await asyncio.to_thread(_decode_latest, msg.data)
                if stats['msgs'] == 1:
                    log.info('H264 first message received (%d bytes)', len(msg.data))
                if bgr is not None:
                    stats['decoded'] += 1
                    latest[0] = bgr
                    frame_event.set()
            elif msg.type == WSMsgType.ERROR:
                log.error('H264 WS error: %s', ws.exception())
                break
    finally:
        proc_task.cancel()
        try:
            await proc_task
        except asyncio.CancelledError:
            pass

    log.info('H264 WS client disconnected')
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
                              'h264': _HAVE_H264,
                              'ice_servers': _ice_servers_dicts()})


# --- WebRTC data-channel transport (UDP — robust on high-RTT / lossy / mobile links) ---
_rtc_pcs = set()


_ice_cache = {'servers': None, 'ts': 0.0}


def _ice_servers_dicts():
    """ICE servers as plain dicts. RunPod's symmetric NAT needs a TURN relay; STUN alone
    can't traverse it. Configured via env (pod-config, not a rebuild); inert (STUN-only)
    if nothing is set. Two options:
      METERED_API_URL — a Metered credentials URL (.../api/v1/turn/credentials?apiKey=...).
                        The pod fetches the full, fresh ICE list (cached ~30 min).
      TURN_URL / TURN_USER / TURN_PASS — a single static TURN server.
    The same list is handed to the client via /health."""
    # --- Cloudflare Realtime TURN (preferred: anycast = close relay = low latency) ---
    cf_key = os.environ.get('CLOUDFLARE_TURN_KEY_ID')
    cf_token = os.environ.get('CLOUDFLARE_TURN_TOKEN')
    if cf_key and cf_token:
        now = time.monotonic()
        if _ice_cache['servers'] is not None and (now - _ice_cache['ts'] < 1800):
            return _ice_cache['servers']
        try:
            import urllib.request
            import json as _json
            req = urllib.request.Request(
                'https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate' % cf_key,
                data=_json.dumps({'ttl': 86400}).encode(),
                headers={'Authorization': 'Bearer %s' % cf_token,
                         'Content-Type': 'application/json'},
                method='POST')
            with urllib.request.urlopen(req, timeout=8) as r:
                data = _json.loads(r.read().decode())
            ice = data.get('iceServers')
            if ice:
                servers = ice if isinstance(ice, list) else [ice]
                _ice_cache['servers'] = servers
                _ice_cache['ts'] = now
                log.info('Fetched Cloudflare TURN credentials (%d entries)', len(servers))
                return servers
        except Exception as e:
            log.warning('Cloudflare TURN fetch failed (%s) — trying next option', e)

    api_url = os.environ.get('METERED_API_URL')
    if api_url:
        now = time.monotonic()
        if _ice_cache['servers'] is not None and (now - _ice_cache['ts'] < 1800):
            return _ice_cache['servers']
        try:
            import urllib.request
            import json as _json
            with urllib.request.urlopen(api_url, timeout=8) as r:
                data = _json.loads(r.read().decode())
            if isinstance(data, list) and data:
                _ice_cache['servers'] = data
                _ice_cache['ts'] = now
                log.info('Fetched %d ICE servers from TURN provider', len(data))
                return data
        except Exception as e:
            log.warning('TURN credential fetch failed (%s) — STUN only', e)

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
    cors.add(app.router.add_get('/ws-h264', handle_ws_h264))
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
