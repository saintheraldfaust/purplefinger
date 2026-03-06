"""
Chimera Lite v1.1 — Inference Engines

SwapEngine:    insightface inswapper_128 (onnxruntime-gpu)
EnhanceEngine: CodeFormer face restoration (PyTorch)
"""

import cv2
import numpy as np
import torch
import logging

log = logging.getLogger('chimera.engine')


# ---------------------------------------------------------------------------
# Swap Engine — inswapper_128 via insightface
# ---------------------------------------------------------------------------

class SwapEngine:
    """
    Wraps insightface's inswapper_128 model.
    Handles face detection, embedding extraction, and the swap itself.

    Requires:
      - models/inswapper_128.onnx  (place manually — ~500MB)
      - InsightFace buffalo_l       (auto-downloaded on first run to ~/.insightface/)
    """

    DETECT_EVERY_N = 1   # detect every frame — mouth moves too fast for stale landmarks

    def __init__(self, model_path: str = 'models/inswapper_128.onnx'):
        import insightface
        from insightface.app import FaceAnalysis
        from insightface.model_zoo import model_zoo

        log.info('Loading InsightFace buffalo_l...')
        self.app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        self.app.prepare(ctx_id=0, det_size=(640, 640))  # full detection res = precise landmarks = good swap

        log.info('Loading inswapper_128 from %s...', model_path)
        self.swapper = insightface.model_zoo.get_model(
            model_path,
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider'],
        )

        self._source_face = None  # cached after set_identity()
        self._cached_target_faces = []   # faces detected in last detection frame
        self._frame_idx = 0

    def set_identity(self, image: np.ndarray):
        """Extract and cache the source face embedding from the identity image."""
        faces = self.app.get(image)
        if not faces:
            raise ValueError('No face detected in identity image')
        # Use the largest face
        self._source_face = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
        log.info('Identity face set (embedding shape: %s)', self._source_face.embedding.shape)

    def swap_frame(self, frame: np.ndarray) -> np.ndarray:
        """Swap all detected faces in a frame with the source identity."""
        if self._source_face is None:
            return frame

        self._frame_idx += 1

        # Detect every frame — mouth/jaw move too much between frames for
        # stale landmarks to produce a correct alignment crop.
        faces = self.app.get(frame)
        if faces:
            self._cached_target_faces = faces

        if not self._cached_target_faces:
            return frame

        h, w = frame.shape[:2]
        result = frame.copy()
        for face in self._cached_target_faces:
            # inswapper paste
            swapped = self.swapper.get(result, face, self._source_face, paste_back=True)

            # paste_back uses a hard internal mask that leaves a visible edge seam.
            # Re-blend with a wide Gaussian feather so the transition is invisible.
            mask = np.zeros((h, w), dtype=np.uint8)
            lmk = getattr(face, 'landmark_2d_106', None)
            if lmk is not None:
                # Points 0-32 trace the full face contour (jaw + temples)
                contour = lmk[:33].astype(np.int32)
                cv2.fillPoly(mask, [cv2.convexHull(contour)], 255)
            else:
                # Fallback: filled ellipse from detection bbox
                x1, y1, x2, y2 = face.bbox.astype(int)
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                cv2.ellipse(mask, (cx, cy),
                            (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                            0, 0, 360, 255, -1)

            # Wide Gaussian feather — face center is fully swapped,
            # edges fade softly into the original background
            mask_f = cv2.GaussianBlur(
                mask.astype(np.float32) / 255.0, (51, 51), 14.0
            )[:, :, np.newaxis]

            result = (
                swapped.astype(np.float32) * mask_f +
                result.astype(np.float32) * (1.0 - mask_f)
            ).astype(np.uint8)

        return result


# ---------------------------------------------------------------------------
# Enhance Engine — GFPGAN v1.4 full-face restoration
# ---------------------------------------------------------------------------

class EnhanceEngine:
    """
    GFPGAN v1.4 face restoration.
    Processes faces at 512×512 internally — handles teeth, tongue, open mouth,
    skin texture, and sharp edges far better than inswapper's 128×128 output.

    weight: 0.0 = max GFPGAN reconstruction, 1.0 = preserve inswapper output.
    0.5 = balanced: keeps identity/expression from inswapper, GFPGAN fixes
    texture, teeth, and mouth-open detail.
    """

    WEIGHT = 0.5

    def __init__(self, model_path: str = 'models/GFPGANv1.4.pth'):
        from gfpgan import GFPGANer

        log.info('Loading GFPGAN v1.4 from %s...', model_path)
        self.gfpgan = GFPGANer(
            model_path=model_path,
            upscale=1,              # keep original resolution
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=None,
        )
        log.info('GFPGAN ready.')

    def enhance(self, frame: np.ndarray) -> np.ndarray:
        try:
            _, _, output = self.gfpgan.enhance(
                frame,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
                weight=self.WEIGHT,
            )
            return output if output is not None and output.size > 0 else frame
        except Exception as e:
            log.warning('GFPGAN enhance failed: %s', e)
            return frame
