"""
Chimera Lite v1.1 — Face Swap Pipeline

Per-frame flow:
  inswapper_128 swap → GFPGAN crop enhancement (every frame) → output

insightface handles detection, alignment, and swap internally.
GFPGAN runs on each face bbox crop (not full frame) — no pulsing.
"""

import logging
import os
import time
import numpy as np

from engine import SwapEngine, EnhanceEngine

log = logging.getLogger('chimera.pipeline')


class PipelineConfig:
    DEVICE = 'cuda:0'


STREAM_PROFILES = {
    'realtime': {
        'enhance_enabled': False,
        'enhance_every_n': 0,
        'detect_every_n': 2,   # every 2nd frame — tracker (stale_face_ttl=2) coasts the gap
        'smooth_alpha': 0.92,  # fast convergence; velocity-adaptive code snaps on big moves
        'stale_face_ttl': 2,   # clear after 2 consecutive misses (~100ms) — no ghost overlay
        # proc matches the client send res (320x180) so both resizes in _full_pipeline
        # short-circuit — no upscale-then-downscale waste on a latency-critical path.
        'proc_w': 320,
        'proc_h': 180,
        # Downlink is a re-encode of an already-degraded client JPEG on a bandwidth-gated
        # link; q65 roughly halves downlink bytes vs q85 with little visible loss.
        'jpeg_quality': 65,
    },
    # 'Balanced' in the UI: GFPGAN every 4th frame (crisper than Fast, ~2-3x the fps of HQ).
    'quality': {
        'enhance_enabled': True,
        'enhance_every_n': 4,
        'detect_every_n': 2,   # tracker coasts the gap (matches realtime)
        'smooth_alpha': 0.85,
        'stale_face_ttl': 2,
        'proc_w': 480,
        'proc_h': 270,
        'jpeg_quality': 72,    # downlink is emitted at proc res now — trim bytes
    },
    # Live-call high quality: GFPGAN restoration EVERY frame (no pulsing) at higher
    # res — crisps the soft 128px swap. Heavier per frame; TensorRT recovers the fps.
    'hq': {
        'enhance_enabled': True,
        'enhance_every_n': 1,
        'detect_every_n': 1,
        'smooth_alpha': 0.85,
        'stale_face_ttl': 2,
        'proc_w': 640,
        'proc_h': 360,
        'jpeg_quality': 92,
    },
}


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()
        self._frame_idx = 0
        self.profile = 'realtime'
        self._ema_swap = None      # rolling timings, exposed via /stats
        self._ema_enhance = None

        log.info('Initialising SwapEngine...')
        self.swap = SwapEngine('models/inswapper_128.onnx')

        log.info('Initialising EnhanceEngine (GFPGAN crop)...')
        try:
            self.enhance = EnhanceEngine('models/GFPGANv1.4.pth')
        except Exception as e:
            log.warning('EnhanceEngine failed to load (%s) — running without enhancement', e)
            self.enhance = None

        # Default to the latency-first realtime profile (no GFPGAN). Booting 'hq' meant
        # GFPGAN ran on every frame (40-160ms) and serially gated RECV fps at ~6-21 until
        # something pushed a profile switch. Override with STREAM_PROFILE env if needed.
        self.set_profile(os.environ.get('STREAM_PROFILE', 'realtime'))

    @property
    def ready(self) -> bool:
        return self.swap._source_face is not None

    def set_identity(self, image: np.ndarray):
        """Set the source identity from an uploaded face image."""
        self.swap.set_identity(image)
        log.info('Identity set — pipeline ready')

    def set_profile(self, profile: str):
        profile = (profile or '').strip().lower()
        if profile not in STREAM_PROFILES:
            raise ValueError(f'Unsupported profile: {profile}')
        self.profile = profile
        self.swap.set_detect_every_n(STREAM_PROFILES[profile]['detect_every_n'])
        self.swap.set_tracking_config(
            STREAM_PROFILES[profile]['smooth_alpha'],
            STREAM_PROFILES[profile]['stale_face_ttl'],
        )
        if self.enhance is not None:
            self.enhance.ENHANCE_EVERY_N = STREAM_PROFILES[profile]['enhance_every_n']
        log.info('Stream profile set: %s', profile)

    def set_swapper(self, swapper_type):
        return self.swap.set_swapper(swapper_type)

    def get_runtime_settings(self):
        return STREAM_PROFILES[self.profile].copy()

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        if not self.ready:
            return frame

        self._frame_idx += 1

        t0 = time.perf_counter()
        swapped = self.swap.swap_frame(frame)
        swap_ms = (time.perf_counter() - t0) * 1000

        enhance_ms = 0
        profile_cfg = STREAM_PROFILES[self.profile]
        if (
            profile_cfg['enhance_enabled'] and
            self.enhance is not None and
            self.swap._cached_target_faces and
            self.enhance.ENHANCE_EVERY_N > 0 and
            self._frame_idx % self.enhance.ENHANCE_EVERY_N == 0
        ):
                t1 = time.perf_counter()
                for face in self.swap._cached_target_faces:
                    try:
                        swapped = self.enhance.enhance(swapped, face, original_frame=frame)
                    except Exception as e:
                        log.warning('Enhance failed: %s', e)
                enhance_ms = (time.perf_counter() - t1) * 1000

        self._ema_swap = swap_ms if self._ema_swap is None else 0.85 * self._ema_swap + 0.15 * swap_ms
        self._ema_enhance = enhance_ms if self._ema_enhance is None else 0.85 * self._ema_enhance + 0.15 * enhance_ms

        if self._frame_idx % 30 == 0:
            log.info('swap=%.0fms  enhance=%.0fms  total=%.0fms',
                     swap_ms, enhance_ms, swap_ms + enhance_ms)

        return swapped

    def get_stats(self):
        return {
            'profile': self.profile,
            'swapper': getattr(self.swap, 'swapper_type', 'inswapper'),
            'available_swappers': self.swap.available_swappers(),
            'swap_ms': round(self._ema_swap, 1) if self._ema_swap is not None else None,
            'enhance_ms': round(self._ema_enhance, 1) if self._ema_enhance is not None else None,
        }
