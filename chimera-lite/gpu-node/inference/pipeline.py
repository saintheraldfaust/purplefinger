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
    ENHANCE_EVERY_N = 1     # Run CodeFormer every N frames (1 = every frame, 2 = every other, etc.)
                            # Increase if you need more FPS at some quality cost.
    DEVICE = 'cuda:0'


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()

        log.info('Initialising SwapEngine...')
        self.swap = SwapEngine('models/inswapper_128.onnx')

        log.info('Initialising EnhanceEngine...')
        self.enhance = EnhanceEngine('models/codeformer.pth')

        self._frame_count = 0
        self._last_enhanced = None

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

        # Step 1: Face swap
        swapped = self.swap.swap_frame(frame)

        # Step 2: CodeFormer enhancement (every N frames)
        if self._frame_count % self.config.ENHANCE_EVERY_N == 0:
            try:
                enhanced = self.enhance.enhance(swapped)
                self._last_enhanced = enhanced
            except Exception as e:
                log.warning('Enhancement failed: %s', e)
                self._last_enhanced = swapped
        else:
            # Reuse last enhanced frame to maintain FPS
            if self._last_enhanced is not None and self._last_enhanced.shape == swapped.shape:
                return self._last_enhanced

        return self._last_enhanced if self._last_enhanced is not None else swapped
