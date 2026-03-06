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
# Enhance Engine — GFPGAN v1.4, crop-per-face approach (DeepLiveCam method)
# ---------------------------------------------------------------------------

class EnhanceEngine:
    """
    GFPGAN v1.4 applied to each face crop individually.

    Why crop instead of full frame:
      - Full frame: GFPGAN detects + processes ALL faces, ~150-180ms
      - Crop: tiny input, GFPGAN finds one face quickly, ~80-100ms
      - Run every frame — no N-frame skip, so no pulsing

    weight 0.5: preserve inswapper identity/expression while GFPGAN
    reconstructs mouth-open shape, teeth, tongue, skin texture at 512px.
    """

    WEIGHT = 0.5
    # Padding around the detected bbox — 50% gives GFPGAN enough
    # background context so its internal paste_back blends cleanly.
    BBOX_PAD = 0.6

    def __init__(self, model_path: str = 'models/GFPGANv1.4.pth'):
        from gfpgan import GFPGANer

        log.info('Loading GFPGAN v1.4 from %s...', model_path)
        self.gfpgan = GFPGANer(
            model_path=model_path,
            upscale=1,
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=None,
        )
        log.info('GFPGAN ready.')

    def enhance(self, frame: np.ndarray, face) -> np.ndarray:
        """
        Crop the face region, run GFPGAN on the crop, paste back.
        face: insightface face object with .bbox attribute.
        """
        try:
            h, w = frame.shape[:2]
            x1, y1, x2, y2 = face.bbox.astype(int)
            fw, fh = x2 - x1, y2 - y1
            pad_x = int(fw * self.BBOX_PAD)
            pad_y = int(fh * self.BBOX_PAD)

            cx1 = max(0, x1 - pad_x)
            cy1 = max(0, y1 - pad_y)
            cx2 = min(w, x2 + pad_x)
            cy2 = min(h, y2 + pad_y)

            crop = frame[cy1:cy2, cx1:cx2].copy()
            if crop.size == 0:
                return frame

            _, _, enhanced = self.gfpgan.enhance(
                crop,
                has_aligned=False,
                only_center_face=True,  # one face per crop — faster, more accurate
                paste_back=True,
                weight=self.WEIGHT,
            )

            if enhanced is None or enhanced.size == 0:
                return frame

            result = frame.copy()
            result[cy1:cy2, cx1:cx2] = enhanced
            return result

        except Exception as e:
            log.warning('GFPGAN enhance failed: %s', e)
            return frame
