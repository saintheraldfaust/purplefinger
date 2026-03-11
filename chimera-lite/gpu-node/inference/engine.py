"""
Chimera Lite v1.1 — Inference Engines

SwapEngine:    insightface inswapper_128 (onnxruntime-gpu)
EnhanceEngine: CodeFormer face restoration (PyTorch)
"""

import cv2
import numpy as np
import torch
import logging
import time
import os
from types import SimpleNamespace

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
    ROI_EXPAND = 1.85
    DETECT_ROI_EXPAND = 2.8  # wider ROI used only for detection; reduces full-frame fallback
    MIN_ROI_SIZE = 192

    def __init__(self, model_path: str = 'models/inswapper_128.onnx'):
        import insightface
        import onnxruntime as ort
        from insightface.app import FaceAnalysis

        log.info('Loading InsightFace buffalo_l...')
        os.environ.setdefault('INSIGHTFACE_HOME', '/workspace/.insightface')
        ort_providers = ort.get_available_providers()
        log.info('onnxruntime available providers: %s', ort_providers)
        if 'CUDAExecutionProvider' not in ort_providers:
            raise RuntimeError(f'CUDAExecutionProvider not available in onnxruntime: {ort_providers}')

        # TensorRT FP16 with engine caching — 2-3x faster than plain CUDA EP on RTX hardware.
        # First run compiles TRT engines (~60-120s); subsequent runs load from cache instantly.
        # Falls back to CUDAExecutionProvider automatically if TRT is unavailable.
        os.makedirs('/workspace/models/trt_cache', exist_ok=True)
        _gpu_providers = [
            ('TensorrtExecutionProvider', {
                'trt_fp16_enable': True,
                'trt_max_workspace_size': 1 << 30,  # 1 GB
                'trt_engine_cache_enable': True,
                'trt_engine_cache_path': '/workspace/models/trt_cache',
                'trt_timing_cache_enable': True,
            }),
            'CUDAExecutionProvider',
            'CPUExecutionProvider',
        ]

        self.source_app = FaceAnalysis(
            name='buffalo_l',
            allowed_modules=['detection', 'recognition', 'landmark_2d_106'],
            providers=_gpu_providers,
        )
        self.source_app.prepare(ctx_id=0, det_size=(320, 320))

        self.target_app = FaceAnalysis(
            name='buffalo_l',
            allowed_modules=['detection', 'landmark_2d_106'],
            providers=_gpu_providers,
        )
        self.target_app.prepare(ctx_id=0, det_size=(256, 256))  # 256 is faster than 320, sufficient for webcam faces

        log.info('Loading inswapper_128 from %s...', model_path)
        self.swapper = insightface.model_zoo.get_model(
            model_path,
            providers=_gpu_providers,
        )
        swapper_providers = self.swapper.session.get_providers()
        log.info('inswapper providers: %s', swapper_providers)
        _gpu_ep_names = {'TensorrtExecutionProvider', 'CUDAExecutionProvider'}
        if not (_gpu_ep_names & set(swapper_providers)):
            raise RuntimeError(f'inswapper is not using a GPU provider: {swapper_providers}')

        self._log_app_model_providers('source analysis', self.source_app)
        self._log_app_model_providers('target analysis', self.target_app)

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
        self._source_skin_zone_stats = None
        self._source_vertical_stat_map_cache = {}
        self._blend_asset_cache = {}
        self._profile_counter = 0

    def _log_app_model_providers(self, label, app):
        app_model_providers = {}
        for name, model in getattr(app, 'models', {}).items():
            session = getattr(model, 'session', None)
            if session is not None and hasattr(session, 'get_providers'):
                app_model_providers[name] = session.get_providers()
        if app_model_providers:
            log.info('%s providers: %s', label, app_model_providers)

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

    def _copy_face_with_offset(self, face, dx=0.0, dy=0.0):
        cloned = SimpleNamespace()

        for attr in ('bbox', 'kps', 'landmark_2d_106', 'det_score', 'embedding', 'gender', 'sex', 'age'):
            if hasattr(face, attr):
                value = getattr(face, attr)
                if isinstance(value, np.ndarray):
                    value = value.copy()
                setattr(cloned, attr, value)

        delta = np.array([dx, dy, dx, dy], dtype=np.float32)
        cloned.bbox = np.asarray(cloned.bbox, dtype=np.float32) + delta

        kps = getattr(cloned, 'kps', None)
        if kps is not None:
            cloned.kps = np.asarray(kps, dtype=np.float32) + np.array([dx, dy], dtype=np.float32)

        lmk = getattr(cloned, 'landmark_2d_106', None)
        if lmk is not None:
            cloned.landmark_2d_106 = np.asarray(lmk, dtype=np.float32) + np.array([dx, dy], dtype=np.float32)

        return cloned

    def _compute_roi(self, frame_shape, bbox, expand=None):
        h, w = frame_shape[:2]
        x1, y1, x2, y2 = np.asarray(bbox, dtype=np.float32)
        bw = max(1.0, x2 - x1)
        bh = max(1.0, y2 - y1)
        cx = (x1 + x2) * 0.5
        cy = (y1 + y2) * 0.5
        scale = float(expand or self.ROI_EXPAND)
        half_w = max(self.MIN_ROI_SIZE * 0.5, bw * scale * 0.5)
        half_h = max(self.MIN_ROI_SIZE * 0.5, bh * scale * 0.5)
        rx1 = max(0, int(round(cx - half_w)))
        ry1 = max(0, int(round(cy - half_h)))
        rx2 = min(w, int(round(cx + half_w)))
        ry2 = min(h, int(round(cy + half_h)))
        return rx1, ry1, rx2, ry2

    def _make_blend_cache_key(self, face, h, w):
        bbox = np.asarray(getattr(face, 'bbox', np.zeros(4, dtype=np.float32)), dtype=np.float32)
        # ÷16 rounding: cache hits whenever bbox drifts <8px — EMA-smoothed bbox
        # moves only a few px per frame, so ÷4 caused cache misses every 1-2 frames
        # triggering expensive distanceTransform + GaussianBlur recomputes (~50-90ms).
        bbox_key = tuple(np.round(bbox / 16.0).astype(np.int32).tolist())

        kps = getattr(face, 'kps', None)
        if kps is not None:
            kps_arr = np.asarray(kps, dtype=np.float32)[:5]
            kps_key = tuple(np.round(kps_arr.reshape(-1) / 16.0).astype(np.int32).tolist())
        else:
            kps_key = ()

        return (h, w, bbox_key, kps_key)

    def _store_blend_assets(self, key, assets):
        self._blend_asset_cache[key] = assets
        while len(self._blend_asset_cache) > 6:
            self._blend_asset_cache.pop(next(iter(self._blend_asset_cache)))

    def _get_blend_assets(self, face, h, w):
        key = self._make_blend_cache_key(face, h, w)
        cached = self._blend_asset_cache.get(key)
        if cached is not None:
            return cached

        complexion_mask = self._build_complexion_mask(face, h, w)
        target_mask = self._refine_skin_mask(complexion_mask.copy(), face.bbox, getattr(face, 'kps', None))
        blend_mask = self._build_face_mask(face, h, w)
        blend_alpha = cv2.GaussianBlur(
            blend_mask.astype(np.float32) / 255.0, (51, 51), 14.0
        )[:, :, np.newaxis]
        tone_soft = (self._build_perimeter_falloff(target_mask, face.bbox) * 0.99)[:, :, np.newaxis]

        assets = {
            'complexion_mask': complexion_mask,
            'tone_mask': target_mask,
            'blend_alpha': blend_alpha,
            'tone_soft': tone_soft,
        }
        self._store_blend_assets(key, assets)
        return assets

    def _detect_primary_face(self, frame):
        detect_t0 = time.perf_counter()
        if self._cached_target_faces:
            face = self._cached_target_faces[0]
            # Use a wider ROI for detection than for swap to reduce miss rate.
            # Critically: if ROI misses, treat as a tracking miss rather than
            # falling through to a second full-frame detection call (was ~2x cost).
            rx1, ry1, rx2, ry2 = self._compute_roi(frame.shape, face.bbox, expand=self.DETECT_ROI_EXPAND)
            roi = frame[ry1:ry2, rx1:rx2]
            if roi.size > 0:
                faces = self.target_app.get(roi)
                detect_ms = (time.perf_counter() - detect_t0) * 1000
                if faces:
                    primary = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
                    return self._copy_face_with_offset(primary, rx1, ry1), detect_ms, 'roi'
            # ROI miss — single call, count as miss; stale_face_ttl keeps the swap alive.
            detect_ms = (time.perf_counter() - detect_t0) * 1000
            return None, detect_ms, 'roi-miss'

        # No cached face yet — run full-frame detection once.
        faces = self.target_app.get(frame)
        detect_ms = (time.perf_counter() - detect_t0) * 1000
        if not faces:
            return None, detect_ms, 'full'
        primary = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
        return primary, detect_ms, 'full'

    def _swap_face_roi(self, base_frame, face):
        h, w = base_frame.shape[:2]
        rx1, ry1, rx2, ry2 = self._compute_roi(base_frame.shape, face.bbox, expand=1.65)
        roi = base_frame[ry1:ry2, rx1:rx2]
        if roi.size == 0:
            return base_frame, {'roi_ms': 0.0, 'swap_ms': 0.0, 'blend_ms': 0.0}

        local_face = self._copy_face_with_offset(face, -rx1, -ry1)
        roi_h, roi_w = roi.shape[:2]
        blend_assets = self._get_blend_assets(local_face, roi_h, roi_w)

        swap_t0 = time.perf_counter()
        swapped_face, affine = self.swapper.get(roi, local_face, self._source_face, paste_back=False)
        inverse_affine = cv2.invertAffineTransform(np.asarray(affine, dtype=np.float32))
        swapped_roi = cv2.warpAffine(
            swapped_face,
            inverse_affine,
            (roi_w, roi_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0.0,
        )

        # --- Pixel-perfect valid mask ---
        # The inswapper outputs a 128×128 square. warpAffine blends boundary
        # pixels with black (borderValue=0), creating a dark bilinear fringe
        # that looks like a rectangular drop-shadow.
        #
        # Instead of guessing with brightness thresholds, we create a clean
        # white square in inswapper space, erode it to exclude the 1-2 pixel
        # interpolation fringe, then warp it with the identical affine.
        # Result: exact geometric match, zero false positives from dark skin.
        swap_h, swap_w = swapped_face.shape[:2]
        clean_mask = np.ones((swap_h, swap_w), dtype=np.uint8) * 255
        clean_mask = cv2.erode(clean_mask, np.ones((5, 5), np.uint8), iterations=1)
        valid_mask_raw = cv2.warpAffine(
            clean_mask,
            inverse_affine,
            (roi_w, roi_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        ).astype(np.float32) / 255.0

        # Replace dark fringe pixels in swapped_roi with original ROI pixels
        # BEFORE tone matching and compositing. Even tiny mask leakage at the
        # boundary would show dark interpolation artifacts otherwise.
        fringe = (valid_mask_raw < 0.05)
        for c in range(3):
            ch = swapped_roi[:, :, c]
            ch[fringe] = roi[:, :, c][fringe]

        valid_mask_s = cv2.GaussianBlur(valid_mask_raw, (41, 41), 10.0)[:, :, np.newaxis]

        swap_ms = (time.perf_counter() - swap_t0) * 1000

        blend_t0 = time.perf_counter()

        swapped_roi = self._match_face_tone(swapped_roi, local_face, blend_assets)

        face_mask = blend_assets['blend_alpha']
        mask_f = np.minimum(face_mask, valid_mask_s)

        # gap_mask: face region the face_mask covers but the inswapper warp doesn't.
        # This is typically the forehead — fill with tone-corrected original instead
        # of raw dark skin so the full face matches the source complexion.
        gap_mask = np.clip(face_mask - mask_f, 0.0, 1.0)
        tone_original = self._match_face_tone(roi.copy(), local_face, blend_assets)

        out_roi = (
            swapped_roi.astype(np.float32) * mask_f +
            tone_original.astype(np.float32) * gap_mask +
            roi.astype(np.float32) * (1.0 - face_mask)
        ).astype(np.uint8)

        result = base_frame.copy()
        result[ry1:ry2, rx1:rx2] = out_roi
        blend_ms = (time.perf_counter() - blend_t0) * 1000
        return result, {
            'roi_ms': 0.0,
            'swap_ms': swap_ms,
            'blend_ms': blend_ms,
        }

    def _build_face_mask(self, face, h, w):
        """Build the full-face blend mask including forehead.

        lmk[:33] only traces the jawline (ear-to-ear around chin), missing
        the forehead entirely.  We extend upward with a forehead polygon
        and a bridging ellipse so that blend_alpha covers the entire
        visible face — critical for cross-race complexion transfer.
        """
        mask = np.zeros((h, w), dtype=np.uint8)
        x1, y1, x2, y2 = face.bbox.astype(int)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2

        lmk = getattr(face, 'landmark_2d_106', None)
        if lmk is not None:
            contour = lmk[:33].astype(np.int32)
            cv2.fillPoly(mask, [cv2.convexHull(contour)], 255)

            # Forehead polygon: temple-to-temple up above bbox top
            left_temple = contour[0]
            right_temple = contour[32]
            forehead_top = max(0, int(round(y1 - bh * 0.20)))
            forehead_poly = np.array([
                left_temple,
                right_temple,
                [int(round(right_temple[0] + bw * 0.04)), forehead_top],
                [int(round(left_temple[0] - bw * 0.04)), forehead_top],
            ], dtype=np.int32)
            cv2.fillConvexPoly(mask, forehead_poly, 255)

            # Bridging ellipse: smoothly connects jaw contour to forehead
            cv2.ellipse(
                mask,
                (cx, int(round(cy - bh * 0.04))),
                (max(1, int(round(bw * 0.50))), max(1, int(round(bh * 0.60)))),
                0, 0, 360, 255, -1,
            )
        else:
            cv2.ellipse(mask, (cx, cy),
                        (max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)),
                        0, 0, 360, 255, -1)
        return mask

    def _build_complexion_mask(self, face, h, w):
        mask = self._build_face_mask(face, h, w)

        x1, y1, x2, y2 = face.bbox.astype(int)
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2

        # Broader ellipse so complexion transfer reaches forehead and jawline,
        # not just the central face region.
        cv2.ellipse(
            mask,
            (cx, int(round(cy - bh * 0.05))),
            (max(1, int(round(bw * 0.58))), max(1, int(round(bh * 0.72)))),
            0, 0, 360, 255, -1,
        )

        lmk = getattr(face, 'landmark_2d_106', None)
        if lmk is not None and len(lmk) >= 33:
            contour = lmk[:33].astype(np.int32)
            left_temple = contour[0]
            right_temple = contour[32]
            forehead_poly = np.array([
                left_temple,
                right_temple,
                [int(round(right_temple[0] + bw * 0.06)), max(0, int(round(y1 - bh * 0.32)))],
                [int(round(left_temple[0] - bw * 0.06)), max(0, int(round(y1 - bh * 0.32)))],
            ], dtype=np.int32)
            cv2.fillConvexPoly(mask, forehead_poly, 255)

        return mask

    def _refine_skin_mask(self, mask, bbox, kps=None):
        x1, y1, x2, y2 = np.asarray(bbox, dtype=np.int32)
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)
        k = max(3, int(round(min(bw, bh) * 0.05)))
        if k % 2 == 0:
            k += 1
        kernel = np.ones((k, k), dtype=np.uint8)
        refined = cv2.erode(mask, kernel, iterations=1)

        if kps is not None and len(kps) >= 5:
            for idx in (0, 1):
                ex, ey = np.asarray(kps[idx], dtype=np.int32)
                r = max(3, int(round(bw * 0.07)))
                cv2.circle(refined, (int(ex), int(ey)), r, 0, -1)

            ml = np.asarray(kps[3], dtype=np.float32)
            mr = np.asarray(kps[4], dtype=np.float32)
            mouth_w = max(4.0, float(np.linalg.norm(mr - ml)))
            mx = int(round((ml[0] + mr[0]) * 0.5))
            my = int(round((ml[1] + mr[1]) * 0.5))
            cv2.ellipse(
                refined,
                (mx, my),
                (max(3, int(round(mouth_w * 0.34))), max(3, int(round(mouth_w * 0.18)))),
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

    def _compute_vertical_zone_stats(self, image, mask, bbox, fallback_stats=None):
        if image is None or mask is None:
            return fallback_stats

        x1, y1, x2, y2 = np.asarray(bbox, dtype=np.int32)
        h, w = image.shape[:2]
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        if x2 - x1 < 12 or y2 - y1 < 12:
            return fallback_stats

        roi = image[y1:y2, x1:x2]
        roi_mask = mask[y1:y2, x1:x2] > 0
        if int(roi_mask.sum()) < 64:
            return fallback_stats

        roi_lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
        norm_y = np.linspace(0.0, 1.0, roi.shape[0], dtype=np.float32)[:, np.newaxis]
        zone_ranges = [(0.00, 0.38), (0.26, 0.72), (0.60, 1.00)]
        zone_stats = []

        for idx, (lo, hi) in enumerate(zone_ranges):
            zone_mask = roi_mask & (norm_y >= lo) & (norm_y <= hi)
            if int(zone_mask.sum()) < 48:
                zone_stats.append(fallback_stats[idx] if fallback_stats is not None else None)
                continue

            channel_stats = []
            for ch in range(3):
                vals = roi_lab[:, :, ch][zone_mask]
                channel_stats.append((float(vals.mean()), float(vals.std())))
            zone_stats.append(channel_stats)

        return zone_stats

    def _build_vertical_stat_maps(self, roi_h, roi_w):
        if not self._source_skin_zone_stats:
            return None, None

        cache_key = (roi_h, roi_w)
        cached = self._source_vertical_stat_map_cache.get(cache_key)
        if cached is not None:
            return cached

        norm_y = np.linspace(0.0, 1.0, roi_h, dtype=np.float32)[:, np.newaxis]
        centers = np.array([0.18, 0.50, 0.82], dtype=np.float32)
        widths = np.array([0.18, 0.18, 0.16], dtype=np.float32)
        weights = []
        for center, width in zip(centers, widths):
            w = np.exp(-0.5 * ((norm_y - center) / max(width, 1e-4)) ** 2)
            weights.append(w)
        weights = np.stack(weights, axis=2)
        weights_sum = np.clip(weights.sum(axis=2, keepdims=True), 1e-6, None)
        weights = weights / weights_sum

        mean_maps = []
        std_maps = []
        for ch in range(3):
            zone_means = np.array([self._source_skin_zone_stats[idx][ch][0] for idx in range(3)], dtype=np.float32)
            zone_stds = np.array([self._source_skin_zone_stats[idx][ch][1] for idx in range(3)], dtype=np.float32)
            mean_map = (weights * zone_means.reshape(1, 1, 3)).sum(axis=2)
            std_map = (weights * zone_stds.reshape(1, 1, 3)).sum(axis=2)
            mean_maps.append(np.repeat(mean_map, roi_w, axis=1))
            std_maps.append(np.repeat(std_map, roi_w, axis=1))

        maps = (mean_maps, std_maps)
        self._source_vertical_stat_map_cache[cache_key] = maps
        while len(self._source_vertical_stat_map_cache) > 8:
            self._source_vertical_stat_map_cache.pop(next(iter(self._source_vertical_stat_map_cache)))
        return maps

    def _build_perimeter_falloff(self, mask, bbox):
        x1, y1, x2, y2 = np.asarray(bbox, dtype=np.int32)
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)

        binary = (mask > 0).astype(np.uint8)
        dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
        edge_span = max(4.0, min(bw, bh) * 0.12)
        falloff = np.clip(dist / edge_span, 0.0, 1.0)
        falloff = np.power(falloff, 0.65)

        # Hairline and ear sides need gentler influence than the mid-face.
        yy, xx = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
        cx = (x1 + x2) * 0.5
        cy = (y1 + y2) * 0.5
        rx = max(1.0, bw * 0.50)
        ry = max(1.0, bh * 0.64)
        ellipse = 1.0 - (((xx - cx) / rx) ** 2 + ((yy - (cy - bh * 0.02)) / ry) ** 2)
        ellipse = np.clip(ellipse, 0.0, 1.0)

        shape_bias = np.clip(0.35 + 0.75 * np.sqrt(ellipse), 0.0, 1.0)
        falloff = falloff * shape_bias

        # Forehead needs stronger complexion retention than the side perimeter.
        forehead_center_y = y1 + bh * 0.14
        forehead = 1.0 - (((xx - cx) / max(1.0, bw * 0.44)) ** 2 + ((yy - forehead_center_y) / max(1.0, bh * 0.30)) ** 2)
        forehead = np.clip(forehead, 0.0, 1.0)
        forehead_boost = np.clip(0.60 + 0.48 * np.sqrt(forehead), 0.0, 1.0)
        falloff = np.maximum(falloff, forehead_boost * binary.astype(np.float32) * 0.96)

        falloff = cv2.GaussianBlur(falloff.astype(np.float32), (31, 31), 6.0)
        return np.clip(falloff, 0.0, 1.0)

    def _match_face_tone(self, swapped, face, blend_assets):
        if self._source_face is None or self._source_img is None or self._source_skin_stats is None:
            return swapped

        target_mask = blend_assets['tone_mask']
        tone_soft = blend_assets['tone_soft']

        # Use the full extent of the tone mask rather than the face bbox.
        # _build_complexion_mask extends the forehead bh*0.24 above y1, so using
        # bbox clips would skip tone correction for the entire forehead region.
        ys, xs = np.where(target_mask > 0)
        if len(ys) == 0:
            return swapped
        h_s, w_s = swapped.shape[:2]
        fy1 = max(0, int(ys.min()))
        fy2 = min(h_s, int(ys.max()) + 1)
        fx1 = max(0, int(xs.min()))
        fx2 = min(w_s, int(xs.max()) + 1)
        if fx2 - fx1 < 12 or fy2 - fy1 < 12:
            return swapped

        region = target_mask[fy1:fy2, fx1:fx2] > 0
        if int(region.sum()) < 64:
            return swapped

        swapped_roi = swapped[fy1:fy2, fx1:fx2]
        swapped_lab = cv2.cvtColor(swapped_roi, cv2.COLOR_BGR2LAB).astype(np.float32)
        dst_mean_maps, dst_std_maps = self._build_vertical_stat_maps(swapped_roi.shape[0], swapped_roi.shape[1])

        # Exclude near-black pixels from stats — the inswapper warp leaves
        # black (0,0,0) in uncovered regions (forehead periphery).  Including
        # them would drag L* mean down and corrupt the colour transfer.
        valid_skin = region & (swapped_lab[:, :, 0] > 8)
        stats_region = valid_skin if int(valid_skin.sum()) >= 64 else region

        adjusted_lab = swapped_lab.copy()
        for ch in range(3):
            src_vals = swapped_lab[:, :, ch][stats_region]
            src_mean = float(src_vals.mean())
            src_std = float(src_vals.std())
            if dst_mean_maps is not None and dst_std_maps is not None:
                dst_mean = dst_mean_maps[ch]
                dst_std = dst_std_maps[ch]
            else:
                dst_mean = self._source_skin_stats[ch][0]
                dst_std = self._source_skin_stats[ch][1]

            scale = dst_std / max(src_std, 1.0)
            if ch == 0:
                # L channel: full range for cross-race swaps (e.g. dark↔light)
                scale = np.clip(scale, 0.55, 2.00)
            else:
                # a/b channels: hue and warmth shift
                scale = np.clip(scale, 0.50, 2.00)

            channel = (swapped_lab[:, :, ch] - src_mean) * scale + dst_mean
            if ch == 0:
                # L* shift up to ±70 — full dark↔light range
                delta = np.clip(channel - swapped_lab[:, :, ch], -70.0, 70.0)
            else:
                # a*/b* shift up to ±50 — covers undertone differences
                delta = np.clip(channel - swapped_lab[:, :, ch], -50.0, 50.0)
            adjusted_lab[:, :, ch] = np.clip(swapped_lab[:, :, ch] + delta, 0.0, 255.0)

        adjusted_roi = cv2.cvtColor(adjusted_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
        soft = tone_soft[fy1:fy2, fx1:fx2]

        out = swapped.copy()
        out[fy1:fy2, fx1:fx2] = (
            adjusted_roi.astype(np.float32) * soft +
            swapped_roi.astype(np.float32) * (1.0 - soft)
        ).astype(np.uint8)
        return out

    def set_identity(self, image: np.ndarray):
        """Extract and cache the source face embedding from the identity image."""
        faces = self.source_app.get(image)
        if not faces:
            raise ValueError('No face detected in identity image')
        # Use the largest face
        self._source_face = sorted(faces, key=lambda f: f.bbox[2] - f.bbox[0], reverse=True)[0]
        self._source_img  = image.copy()
        self._source_vertical_stat_map_cache.clear()
        src_h, src_w = self._source_img.shape[:2]
        source_mask = self._build_complexion_mask(self._source_face, src_h, src_w)
        source_mask = self._refine_skin_mask(source_mask, self._source_face.bbox, getattr(self._source_face, 'kps', None))
        self._source_skin_stats = self._compute_masked_lab_stats(self._source_img, source_mask)
        self._source_skin_zone_stats = self._compute_vertical_zone_stats(
            self._source_img,
            source_mask,
            self._source_face.bbox,
            fallback_stats=[self._source_skin_stats, self._source_skin_stats, self._source_skin_stats] if self._source_skin_stats is not None else None,
        )
        log.info('Identity face set (embedding shape: %s)', self._source_face.embedding.shape)

    def swap_frame(self, frame: np.ndarray) -> np.ndarray:
        """Swap all detected faces in a frame with the source identity."""
        if self._source_face is None:
            return frame

        self._frame_idx += 1
        detect_ms = 0.0
        detect_mode = 'skip'

        # Realtime mode can skip every other detection to save GPU time.
        # If no cached face exists yet, always detect immediately.
        should_detect = (
            not self._cached_target_faces or
            self.DETECT_EVERY_N <= 1 or
            (self._frame_idx % self.DETECT_EVERY_N) == 1
        )
        if should_detect:
            primary, detect_ms, detect_mode = self._detect_primary_face(frame)
            if primary is not None:
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

        result = frame
        swap_total_ms = 0.0
        blend_total_ms = 0.0
        for face in self._cached_target_faces:
            result, timings = self._swap_face_roi(result, face)
            swap_total_ms += timings['swap_ms']
            blend_total_ms += timings['blend_ms']

        self._profile_counter += 1
        if self._profile_counter % 60 == 0:
            log.info(
                'swap profile detect=%.0fms(%s) swap=%.0fms blend=%.0fms detect_every=%d cached_faces=%d',
                detect_ms,
                detect_mode,
                swap_total_ms,
                blend_total_ms,
                self.DETECT_EVERY_N,
                len(self._cached_target_faces),
            )

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
