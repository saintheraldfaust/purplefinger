"""
Chimera Lite v1.1 — Face Swap Pipeline

Per-frame flow:
  inswapper_128 swap → GFPGAN crop enhancement (every frame) → output

insightface handles detection, alignment, and swap internally.
GFPGAN runs on each face bbox crop (not full frame) — no pulsing.
"""

import logging
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
        'detect_every_n': 2,
        'smooth_alpha': 0.45,
        'stale_face_ttl': 4,
        'proc_w': 448,
        'proc_h': 252,
        'jpeg_quality': 80,
    },
    'quality': {
        'enhance_enabled': True,
        'enhance_every_n': 4,
        'detect_every_n': 1,
        'smooth_alpha': 0.75,
        'stale_face_ttl': 1,
        'proc_w': 480,
        'proc_h': 270,
        'jpeg_quality': 85,
    },
}


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()
        self._frame_idx = 0
        self.profile = 'realtime'

        log.info('Initialising SwapEngine...')
        self.swap = SwapEngine('models/inswapper_128.onnx')

        log.info('Initialising EnhanceEngine (GFPGAN crop)...')
        try:
            self.enhance = EnhanceEngine('models/GFPGANv1.4.pth')
        except Exception as e:
            log.warning('EnhanceEngine failed to load (%s) — running without enhancement', e)
            self.enhance = None

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

        if self._frame_idx % 30 == 0:
            log.info('swap=%.0fms  enhance=%.0fms  total=%.0fms',
                     swap_ms, enhance_ms, swap_ms + enhance_ms)

        return swapped
