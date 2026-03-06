"""
Chimera Lite v1.1 — Face Swap Pipeline

Per-frame flow:
  inswapper_128 swap → GFPGAN crop enhancement (every frame) → output

insightface handles detection, alignment, and swap internally.
GFPGAN runs on each face bbox crop (not full frame) — no pulsing.
"""

import logging
import numpy as np

from engine import SwapEngine, EnhanceEngine

log = logging.getLogger('chimera.pipeline')


class PipelineConfig:
    DEVICE = 'cuda:0'


class FaceSwapPipeline:

    def __init__(self, config: PipelineConfig = None):
        self.config = config or PipelineConfig()

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

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        if not self.ready:
            return frame

        # Step 1: Face swap (inswapper_128 + feathered blend)
        swapped = self.swap.swap_frame(frame)

        # Step 2: GFPGAN enhancement on face crop every frame.
        # Running every frame (not every N) is what eliminates pulsing.
        # Crop approach is fast enough: ~80-100ms vs 150-180ms for full frame.
        if self.enhance is not None and self.swap._cached_target_faces:
            for face in self.swap._cached_target_faces:
                try:
                    swapped = self.enhance.enhance(swapped, face, original_frame=frame)
                except Exception as e:
                    log.warning('Enhance failed: %s', e)

        return swapped
