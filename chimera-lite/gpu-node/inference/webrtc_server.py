"""
Chimera Lite v1.1 — GPU Node WebRTC + HTTP Server
Receives video frames via WebRTC, runs face swap pipeline, streams output back.
Also exposes HTTP endpoints for:
  POST /set-face  — receive identity image from backend
  GET  /health    — liveness check
"""

import asyncio
import logging
import sys
import fractions
import time
from io import BytesIO

import cv2
import numpy as np
from aiohttp import web
import aiohttp_cors
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack, RTCConfiguration, RTCIceServer
from aiortc.contrib.media import MediaRelay
from av import VideoFrame
from PIL import Image

sys.path.insert(0, '/app/inference')
from pipeline import FaceSwapPipeline, PipelineConfig

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('chimera')

# --- Global state ---
pipeline = FaceSwapPipeline(PipelineConfig())
relay = MediaRelay()
peer_connections = set()

TURN_CONFIG = RTCConfiguration(iceServers=[
    RTCIceServer(urls=['stun:stun.relay.metered.ca:80']),
    RTCIceServer(
        urls=[
            'turn:global.relay.metered.ca:80',
            'turn:global.relay.metered.ca:80?transport=tcp',
            'turn:global.relay.metered.ca:443',
            'turns:global.relay.metered.ca:443?transport=tcp',
        ],
        username='4f5aec68a87bea53ff28aba4',
        credential='1kfKtDRUDxLPNhrT',
    ),
])


# --- Transformed video track ---
class SwappedVideoTrack(VideoStreamTrack):
    """Wraps an incoming video track and applies the face swap pipeline per frame."""

    kind = 'video'

    def __init__(self, source_track):
        super().__init__()
        self._source = source_track

    async def recv(self):
        frame = await self._source.recv()

        img = frame.to_ndarray(format='bgr24')
        try:
            swapped = pipeline.process_frame(img)
        except Exception as e:
            log.warning('Pipeline error on frame: %s', e)
            swapped = img
        new_frame = VideoFrame.from_ndarray(swapped, format='bgr24')
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        return new_frame


# --- WebRTC signaling ---
async def handle_offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params['sdp'], type=params['type'])

    pc = RTCPeerConnection(configuration=TURN_CONFIG)
    peer_connections.add(pc)

    @pc.on('connectionstatechange')
    async def on_state():
        log.info('Connection state: %s', pc.connectionState)
        if pc.connectionState in ('failed', 'closed'):
            await pc.close()
            peer_connections.discard(pc)

    @pc.on('track')
    def on_track(track):
        if track.kind == 'video':
            swapped = SwappedVideoTrack(relay.subscribe(track))
            pc.addTrack(swapped)

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


# --- Health ---
async def handle_health(request):
    return web.json_response({'ok': True, 'face_set': pipeline.ready})


# --- App setup ---
async def on_shutdown(app):
    for pc in list(peer_connections):
        await pc.close()


def build_app():
    app = web.Application()

    cors = aiohttp_cors.setup(app, defaults={
        '*': aiohttp_cors.ResourceOptions(allow_credentials=True, expose_headers='*', allow_headers='*')
    })

    cors.add(app.router.add_post('/offer', handle_offer))
    cors.add(app.router.add_post('/set-face', handle_set_face))
    cors.add(app.router.add_get('/health', handle_health))

    app.on_shutdown.append(on_shutdown)
    return app


if __name__ == '__main__':
    app = build_app()
    log.info('Chimera Lite GPU node starting on port 8765')
    web.run_app(app, host='0.0.0.0', port=8765)
