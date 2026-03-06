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
    # CodeFormer runs every N frames. At ~15fps, N=12 fires ~1x per second.
    # Each CF call takes ~150-300ms (one slow frame), then raw-swap resumes.
    # The producer/consumer drops stale frames during that window — no stutter.
    ENHANCE_EVERY_N = 12
    DEVICE = 'cuda:0'


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()

        log.info('Initialising SwapEngine...')
        self.swap = SwapEngine('models/inswapper_128.onnx')

        log.info('Initialising EnhanceEngine...')
        try:
            self.enhance = EnhanceEngine('models/codeformer.pth')
        except Exception as e:
            log.warning('EnhanceEngine failed to load (%s) — running without enhancement', e)
            self.enhance = None

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

        # Step 2: CodeFormer enhancement (every N frames, if available)
        if self.enhance is None or self.config.ENHANCE_EVERY_N == 0:
            return swapped

        if self._frame_count % self.config.ENHANCE_EVERY_N == 0:
            try:
                swapped = self.enhance.enhance(swapped)
            except Exception as e:
                log.warning('Enhancement failed: %s', e)

        # Always return current frame — never reuse a stale past frame,
        # which would show a frozen face composited onto a moving body.
        return swapped
