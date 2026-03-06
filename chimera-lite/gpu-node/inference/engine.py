"""
Chimera Lite v1.1 — Inference Engines

SwapEngine:    insightface inswapper_128 (onnxruntime-gpu)
EnhanceEngine: CodeFormer face restoration (PyTorch)
"""

import cv2
import numpy as np
import torch
import logging

if torch.cuda.is_available():
    torch.backends.cudnn.benchmark = True  # speed up conv ops after first frame

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
        # Cache models on volume so they survive pod restarts
        import os
        os.environ.setdefault('INSIGHTFACE_HOME', '/workspace/.insightface')
        self.app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        self.app.prepare(ctx_id=0, det_size=(320, 320))  # 320 is fast enough for webcam faces

        log.info('Loading inswapper_128 from %s...', model_path)
        self.swapper = insightface.model_zoo.get_model(
            model_path,
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider'],
        )
        log.info('inswapper providers: %s', self.swapper.session.get_providers())

        self._source_face = None  # cached after set_identity()
        self._source_img  = None  # full source image for beard/hair transfer
        self._cached_target_faces = []   # faces detected in last detection frame
        self._frame_idx = 0

    def set_identity(self, image: np.ndarray):
        """Extract and cache the source face embedding from the identity image."""
        faces = self.app.get(image)
        if not faces:
            raise ValueError('No face detected in identity image')
        # Use the largest face
        self._source_face = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
        self._source_img  = image.copy()
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
# Enhance Engine — GFPGAN v1.4, pre-aligned fast path
# ---------------------------------------------------------------------------

class EnhanceEngine:
    """
    GFPGAN v1.4 with has_aligned=True fast path.

    Key insight: GFPGAN's ~200ms cost is dominated by its internal
    RetinaFace detection step — not the GAN inference itself.
    With has_aligned=True that step is skipped entirely (~40-60ms).

    We pre-align the face ourselves using insightface's existing kps
    (already computed for free during swap), warp to 512×512, run
    GFPGAN on the aligned crop, then warp the result back with an
    inverse affine + feathered mask blend.

    Result: every-frame enhancement at ~15-20fps with no pulsing.
    """

    WEIGHT = 0.55  # 0=max GFPGAN reconstruction, 1=preserve inswapper
    ENHANCE_EVERY_N = 4  # run GFPGAN every N frames; reuse last result in between

    def __init__(self, model_path: str = 'models/GFPGANv1.4.pth'):
        from gfpgan import GFPGANer

        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        log.info('Loading GFPGAN v1.4 from %s (device=%s)...', model_path, device)
        self.gfpgan = GFPGANer(
            model_path=model_path,
            upscale=1,
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=None,
            device=device,
        )
        # fp16 via autocast: inputs stay float32, ops run in fp16 automatically
        self._device = device
        if device == 'cuda':
            log.info('GFPGAN will use torch.autocast fp16.')
        log.info('GFPGAN ready on %s.', device)

    def enhance(self, frame: np.ndarray, face, original_frame: np.ndarray = None) -> np.ndarray:
        try:
            h, w = frame.shape[:2]
            kps = getattr(face, 'kps', None)

            if kps is not None:
                return self._aligned_enhance(frame, face, kps, h, w, original_frame)
            else:
                return self._crop_enhance(frame, face, h, w)

        except Exception as e:
            log.warning('GFPGAN enhance failed: %s', e)
            return frame

    def _aligned_enhance(self, frame, face, kps, h, w, original_frame=None):
        """Fast path: pre-align → GFPGAN(has_aligned=True) → inverse warp."""
        from insightface.utils.face_align import estimate_norm

        # Get the 2×3 affine matrix that maps face to 512×512 aligned crop.
        # estimate_norm uses insightface's built-in ArcFace reference points.
        # NOTE: older insightface returns just M; newer returns (M, pose_index).
        # Handle both so the code doesn't silently unpack rows as scalars.
        _result = estimate_norm(kps, 512, mode='arcface')
        M = _result[0] if isinstance(_result, tuple) else _result
        if M is None:
            return self._crop_enhance(frame, face, h, w)
        # Ensure contiguous float32 with correct shape (2×3) before warpAffine
        M = np.asarray(M, dtype=np.float32)
        if M.shape != (2, 3):
            return self._crop_enhance(frame, face, h, w)

        aligned = cv2.warpAffine(frame, M, (512, 512), flags=cv2.INTER_LINEAR)

        # has_aligned=True skips RetinaFace — the main cost saving
        with torch.autocast(device_type='cuda', enabled=(self._device == 'cuda')):
            _, _, enhanced = self.gfpgan.enhance(
                aligned,
                has_aligned=True,
                only_center_face=True,
                paste_back=True,
                weight=self.WEIGHT,
            )
        if enhanced is None or enhanced.size == 0:
            return frame
        if enhanced.dtype != np.uint8:
            enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)

        # Warp enhanced face back to original frame coordinates
        M_inv = cv2.invertAffineTransform(M)
        restored = cv2.warpAffine(enhanced, M_inv, (w, h), flags=cv2.INTER_LINEAR)

        # Build face mask — landmark contour with Gaussian feather
        mask = np.zeros((h, w), dtype=np.float32)
        lmk = getattr(face, 'landmark_2d_106', None)
        if lmk is not None:
            cv2.fillPoly(mask, [cv2.convexHull(lmk[:33].astype(np.int32))], 1.0)
        else:
            x1, y1, x2, y2 = face.bbox.astype(int)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            cv2.ellipse(mask, (cx, cy),
                        (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                        0, 0, 360, 1.0, -1)

        # Only blend where inverse warp produced valid (non-black) pixels
        valid = (restored.sum(axis=2) > 0).astype(np.float32)
        mask = cv2.GaussianBlur(mask, (51, 51), 14.0) * valid
        mask = mask[:, :, np.newaxis]

        result = (
            restored.astype(np.float32) * mask +
            frame.astype(np.float32) * (1.0 - mask)
        ).astype(np.uint8)

        # Mouth override: use real camera mouth for inner region.
        # Real mouth = correct lip sync, correct teeth positions, no hallucination.
        result = self._apply_mouth_override(result, original_frame if original_frame is not None else frame, kps, h, w)
        return result

    def _apply_mouth_override(self, gfpgan_result, source_frame, kps, h, w):
        """
        Paste the real camera mouth over the inner mouth region.

        source_frame is the original pre-swap camera frame — real lips,
        real teeth, real tongue, perfectly lip-synced by definition.
        No hallucinated geometry, no phantom teeth from GFPGAN.

        GFPGAN output is kept for: skin, eyes, nose, outer lip edges.
        Inner mouth (teeth/tongue opening) = real camera.
        """
        if kps is None or len(kps) < 5:
            return gfpgan_result

        ml = np.asarray(kps[3], dtype=np.float32)
        mr = np.asarray(kps[4], dtype=np.float32)
        mouth_w = float(np.linalg.norm(mr - ml))
        if mouth_w < 4:
            return gfpgan_result

        cx = (ml[0] + mr[0]) * 0.5
        cy = (ml[1] + mr[1]) * 0.5

        # Rectangle covering only the inner opening (smaller than full lip area
        # so the lip edges — where GFPGAN adds real detail — are kept)
        rx   = mouth_w * 0.36
        ry_u = mouth_w * 0.20
        ry_d = mouth_w * 0.24
        mx1 = max(0, int(round(cx - rx)))
        mx2 = min(w, int(round(cx + rx)))
        my1 = max(0, int(round(cy - ry_u)))
        my2 = min(h, int(round(cy + ry_d)))

        if mx2 - mx1 < 4 or my2 - my1 < 4:
            return gfpgan_result

        # Real camera mouth — already sharp, already correct
        real_crop = source_frame[my1:my2, mx1:mx2].astype(np.float32)

        # Soft elliptical mask confined to the crop — no hard seam
        rh, rw = my2 - my1, mx2 - mx1
        m = np.zeros((rh, rw), dtype=np.float32)
        cv2.ellipse(m, (rw // 2, rh // 2), (max(1, rw // 2), max(1, rh // 2)),
                    0, 0, 360, 1.0, -1)
        m = cv2.GaussianBlur(m, (7, 7), 2.0)[:, :, np.newaxis]

        gfp_crop = gfpgan_result[my1:my2, mx1:mx2].astype(np.float32)
        blended = (real_crop * m + gfp_crop * (1.0 - m)).astype(np.uint8)

        out = gfpgan_result.copy()
        out[my1:my2, mx1:mx2] = blended
        return out

    def _crop_enhance(self, frame, face, h, w):
        """Fallback: bbox crop → GFPGAN with detection → paste back."""
        x1, y1, x2, y2 = face.bbox.astype(int)
        fw, fh = x2 - x1, y2 - y1
        cx1 = max(0, x1 - int(fw * 0.5))
        cy1 = max(0, y1 - int(fh * 0.5))
        cx2 = min(w, x2 + int(fw * 0.5))
        cy2 = min(h, y2 + int(fh * 0.5))

        crop = frame[cy1:cy2, cx1:cx2].copy()
        if crop.size == 0:
            return frame

        _, _, enhanced = self.gfpgan.enhance(
            crop, has_aligned=False, only_center_face=True,
            paste_back=True, weight=self.WEIGHT,
        )
        if enhanced is None or enhanced.size == 0:
            return frame

        result = frame.copy()
        result[cy1:cy2, cx1:cx2] = enhanced
        return result
