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

    DETECT_EVERY_N = 1   # per-profile; realtime can relax this for more FPS

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
        self._source_img  = None
        self._cached_target_faces = []   # faces detected in last detection frame
        self._frame_idx = 0
        self._smooth_alpha = 1.0
        self._stale_face_ttl = 0
        self._miss_count = 0
        self._smoothed_bbox = None
        self._smoothed_kps = None
        self._smoothed_lmk106 = None
        self._source_skin_stats = None

    def set_detect_every_n(self, n: int):
        self.DETECT_EVERY_N = max(1, int(n))
        log.info('Swap detect cadence set: every %d frame(s)', self.DETECT_EVERY_N)

    def set_tracking_config(self, smooth_alpha: float = 1.0, stale_face_ttl: int = 0):
        self._smooth_alpha = float(np.clip(smooth_alpha, 0.0, 1.0))
        self._stale_face_ttl = max(0, int(stale_face_ttl))
        log.info(
            'Swap tracking config: smooth_alpha=%.2f stale_face_ttl=%d',
            self._smooth_alpha,
            self._stale_face_ttl,
        )

    def _smooth_array(self, prev, curr):
        curr = np.asarray(curr, dtype=np.float32)
        if prev is None or self._smooth_alpha >= 0.999:
            return curr
        return self._smooth_alpha * curr + (1.0 - self._smooth_alpha) * prev

    def _build_tracked_face(self, face):
        face.bbox = self._smooth_array(self._smoothed_bbox, face.bbox)
        self._smoothed_bbox = face.bbox.copy()

        kps = getattr(face, 'kps', None)
        if kps is not None:
            face.kps = self._smooth_array(self._smoothed_kps, kps)
            self._smoothed_kps = face.kps.copy()

        lmk = getattr(face, 'landmark_2d_106', None)
        if lmk is not None:
            face.landmark_2d_106 = self._smooth_array(self._smoothed_lmk106, lmk)
            self._smoothed_lmk106 = face.landmark_2d_106.copy()

        return face

    def _build_face_mask(self, face, h, w):
        mask = np.zeros((h, w), dtype=np.uint8)
        lmk = getattr(face, 'landmark_2d_106', None)
        if lmk is not None:
            contour = lmk[:33].astype(np.int32)
            cv2.fillPoly(mask, [cv2.convexHull(contour)], 255)
        else:
            x1, y1, x2, y2 = face.bbox.astype(int)
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
            cv2.ellipse(mask, (cx, cy),
                        (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                        0, 0, 360, 255, -1)
        return mask

    def _refine_skin_mask(self, mask, bbox, kps=None):
        x1, y1, x2, y2 = np.asarray(bbox, dtype=np.int32)
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        k = max(5, int(round(min(bw, bh) * 0.08)))
        if k % 2 == 0:
            k += 1
        kernel = np.ones((k, k), dtype=np.uint8)
        refined = cv2.erode(mask, kernel, iterations=1)

        if kps is not None and len(kps) >= 5:
            for idx in (0, 1):
                ex, ey = np.asarray(kps[idx], dtype=np.int32)
                r = max(3, int(round(bw * 0.08)))
                cv2.circle(refined, (int(ex), int(ey)), r, 0, -1)

            ml = np.asarray(kps[3], dtype=np.float32)
            mr = np.asarray(kps[4], dtype=np.float32)
            mouth_w = max(4.0, float(np.linalg.norm(mr - ml)))
            mx = int(round((ml[0] + mr[0]) * 0.5))
            my = int(round((ml[1] + mr[1]) * 0.5))
            cv2.ellipse(
                refined,
                (mx, my),
                (max(3, int(round(mouth_w * 0.42))), max(3, int(round(mouth_w * 0.24)))),
                0, 0, 360, 0, -1,
            )

        return refined

    def _compute_masked_lab_stats(self, image, mask):
        if image is None or mask is None:
            return None
        region = mask > 0
        if int(region.sum()) < 64:
            return None

        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
        stats = []
        for ch in range(3):
            vals = lab[:, :, ch][region]
            stats.append((float(vals.mean()), float(vals.std())))
        return stats

    def _match_face_tone(self, swapped, face, face_mask):
        if self._source_face is None or self._source_img is None or self._source_skin_stats is None:
            return swapped

        x1, y1, x2, y2 = face.bbox.astype(int)
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(swapped.shape[1], x2)
        y2 = min(swapped.shape[0], y2)
        if x2 - x1 < 12 or y2 - y1 < 12:
            return swapped

        target_mask = self._refine_skin_mask(face_mask.copy(), face.bbox, getattr(face, 'kps', None))
        region = target_mask[y1:y2, x1:x2] > 0
        if int(region.sum()) < 64:
            return swapped

        swapped_roi = swapped[y1:y2, x1:x2]

        swapped_lab = cv2.cvtColor(swapped_roi, cv2.COLOR_BGR2LAB).astype(np.float32)

        adjusted_lab = swapped_lab.copy()
        for ch in range(3):
            src_vals = swapped_lab[:, :, ch][region]
            src_mean = float(src_vals.mean())
            src_std = float(src_vals.std())
            dst_mean, dst_std = self._source_skin_stats[ch]

            scale = dst_std / max(src_std, 1.0)
            if ch == 0:
                scale = float(np.clip(scale, 0.85, 1.22))
            else:
                scale = float(np.clip(scale, 0.80, 1.35))

            channel = (swapped_lab[:, :, ch] - src_mean) * scale + dst_mean
            if ch == 0:
                delta = np.clip(channel - swapped_lab[:, :, ch], -28.0, 28.0)
            else:
                delta = np.clip(channel - swapped_lab[:, :, ch], -18.0, 18.0)
            adjusted_lab[:, :, ch] = np.clip(swapped_lab[:, :, ch] + delta, 0.0, 255.0)

        adjusted_roi = cv2.cvtColor(adjusted_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
        soft = cv2.GaussianBlur(target_mask.astype(np.float32) / 255.0, (31, 31), 8.0)[y1:y2, x1:x2]
        soft = (soft * 0.92)[:, :, np.newaxis]

        out = swapped.copy()
        out[y1:y2, x1:x2] = (
            adjusted_roi.astype(np.float32) * soft +
            swapped_roi.astype(np.float32) * (1.0 - soft)
        ).astype(np.uint8)
        return out

    def set_identity(self, image: np.ndarray):
        """Extract and cache the source face embedding from the identity image."""
        faces = self.app.get(image)
        if not faces:
            raise ValueError('No face detected in identity image')
        # Use the largest face
        self._source_face = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
        self._source_img  = image.copy()
        src_h, src_w = self._source_img.shape[:2]
        source_mask = self._build_face_mask(self._source_face, src_h, src_w)
        source_mask = self._refine_skin_mask(source_mask, self._source_face.bbox, getattr(self._source_face, 'kps', None))
        self._source_skin_stats = self._compute_masked_lab_stats(self._source_img, source_mask)
        log.info('Identity face set (embedding shape: %s)', self._source_face.embedding.shape)

    def swap_frame(self, frame: np.ndarray) -> np.ndarray:
        """Swap all detected faces in a frame with the source identity."""
        if self._source_face is None:
            return frame

        self._frame_idx += 1

        # Realtime mode can skip every other detection to save GPU time.
        # If no cached face exists yet, always detect immediately.
        should_detect = (
            not self._cached_target_faces or
            self.DETECT_EVERY_N <= 1 or
            (self._frame_idx % self.DETECT_EVERY_N) == 1
        )
        if should_detect:
            faces = self.app.get(frame)
            if faces:
                primary = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
                self._cached_target_faces = [self._build_tracked_face(primary)]
                self._miss_count = 0
            else:
                self._miss_count += 1
                if self._miss_count > self._stale_face_ttl:
                    self._cached_target_faces = []
                    self._smoothed_bbox = None
                    self._smoothed_kps = None
                    self._smoothed_lmk106 = None

        if not self._cached_target_faces:
            return frame

        h, w = frame.shape[:2]
        result = frame.copy()
        for face in self._cached_target_faces:
            # inswapper paste
            swapped = self.swapper.get(result, face, self._source_face, paste_back=True)

            # paste_back uses a hard internal mask that leaves a visible edge seam.
            # Re-blend with a wide Gaussian feather so the transition is invisible.
            mask = self._build_face_mask(face, h, w)
            swapped = self._match_face_tone(swapped, face, mask)

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
