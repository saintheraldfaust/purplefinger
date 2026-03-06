"""
Chimera Lite v1.1 — Face Swap Pipeline

Per-frame flow:
  inswapper_128 swap → CodeFormer enhancement → output frame

insightface handles detection, alignment, and swap internally,
so we no longer need separate bbox/landmark/blend logic.
"""

import logging
import numpy as np

from engine import SwapEngine, EnhanceEngine

log = logging.getLogger('chimera.pipeline')


class PipelineConfig:
    # GFPGAN runs every N frames. At ~20fps, N=4 = 5x/sec.
    # ~100-150ms per call on RTX 3090; producer/consumer drops stale frames.
    ENHANCE_EVERY_N = 4
    DEVICE = 'cuda:0'


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()

        log.info('Initialising SwapEngine...')
        self.swap = SwapEngine('models/inswapper_128.onnx')

        log.info('Initialising EnhanceEngine (GFPGAN)...')
        try:
            self.enhance = EnhanceEngine('models/GFPGANv1.4.pth')
        except Exception as e:
            log.warning('EnhanceEngine failed to load (%s) — running without enhancement', e)
            self.enhance = None

        self._frame_count = 0

    @property
    def ready(self) -> bool:
        return self.swap._source_face is not None

    def set_identity(self, image: np.ndarray):
        """Set the source identity from an uploaded face image."""
        self.swap.set_identity(image)
        log.info('Identity set — pipeline ready')

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        if not self.ready:
            return frame

        self._frame_count += 1

        # Step 1: Face swap (inswapper_128)
        swapped = self.swap.swap_frame(frame)

        # Step 2: GFPGAN enhancement every N frames
        # Fixes teeth, open mouth, tongue, skin texture at 512px.
        if self.enhance is not None and self.config.ENHANCE_EVERY_N > 0:
            if self._frame_count % self.config.ENHANCE_EVERY_N == 0:
                try:
                    swapped = self.enhance.enhance(swapped)
                except Exception as e:
                    log.warning('Enhancement failed: %s', e)

        return swapped
