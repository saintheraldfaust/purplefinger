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
# Mouth Enhance Engine — GFPGAN upscale + region CF
# ---------------------------------------------------------------------------

class MouthEnhanceEngine:
    """
    Post-swap mouth-specific enhancement.
    Mouth at 128×128 is too low-res for detail (open mouth, teeth, tongue).
    Extract mouth region (landmarks 60–68), upscale 4×, apply GFPGAN
    denoising + aggressive CodeFormer (fidelity=0.0) to recover expression.
    """

    def __init__(self):
        from gfpgan import GFPGANer
        import torch

        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

        # GFPGAN model (auto-downloads to ~/.cache)
        log.info('Loading GFPGAN for mouth enhancement...')
        self.gfpgan = GFPGANer(
            scale=2,
            model_path='https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth',
            upscale=2,
            arch='clean',
            channel_multiplier=2,
            bg_upsampler=None,
            device=self.device,
        )

        # CodeFormer for aggressive mouth-region reconstruction
        from basicsr.archs.codeformer_arch import CodeFormer
        log.info('Loading CodeFormer (mouth mode)...')
        self.cf_mouth = CodeFormer(
            dim_embd=512,
            codebook_size=1024,
            n_head=8,
            n_layers=9,
            connect_list=['32', '64', '128', '256'],
        ).to(self.device)

        try:
            ckpt = torch.load('models/codeformer.pth', map_location=self.device)
            self.cf_mouth.load_state_dict(ckpt['params_ema'])
            self.cf_mouth.eval()
        except Exception as e:
            log.warning('CodeFormer load failed for mouth: %s', e)
            self.cf_mouth = None

    def enhance_mouth(self, frame: np.ndarray, face_lmk: np.ndarray) -> np.ndarray:
        """
        Enhance mouth region using GFPGAN + CodeFormer.
        face_lmk: 106-point landmarks from insightface.
        """
        try:
            # Mouth region: landmarks 60–68 (inner/outer mouth contour)
            if face_lmk is None or len(face_lmk) < 69:
                return frame

            mouth_pts = face_lmk[60:69].astype(np.int32)
            x_min, x_max = mouth_pts[:, 0].min(), mouth_pts[:, 0].max()
            y_min, y_max = mouth_pts[:, 1].min(), mouth_pts[:, 1].max()

            # Expand box by 50% to include context (needed for smooth blending)
            h, w = frame.shape[:2]
            cx, cy = (x_min + x_max) // 2, (y_min + y_max) // 2
            mw, mh = (x_max - x_min), (y_max - y_min)
            pad_w, pad_h = int(mw * 0.25), int(mh * 0.25)

            x1 = max(0, cx - (mw // 2 + pad_w))
            x2 = min(w, cx + (mw // 2 + pad_w))
            y1 = max(0, cy - (mh // 2 + pad_h))
            y2 = min(h, cy + (mh // 2 + pad_h))

            mouth_crop = frame[y1:y2, x1:x2].copy()
            if mouth_crop.size == 0:
                return frame

            # GFPGAN upscale 2× for better detail
            _, _, gf = self.gfpgan.enhance(mouth_crop, has_aligned=False, only_center_face=False, weight=0.5)
            if gf is None or gf.size == 0:
                gf = mouth_crop

            # Downscale back to original mouth size
            gf = cv2.resize(gf, (x2 - x1, y2 - y1), interpolation=cv2.INTER_AREA)

            # CodeFormer aggressive (fidelity=0.0) on mouth at 512px
            if self.cf_mouth is not None:
                from basicsr.utils import img2tensor, tensor2img
                from torchvision.transforms.functional import normalize as tnorm

                # Upsample to 512 for CF input
                gf_512 = cv2.resize(gf, (512, 512), interpolation=cv2.INTER_CUBIC)
                t = img2tensor(gf_512 / 255.0, bgr2rgb=True, float32=True)
                tnorm(t, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
                t = t.unsqueeze(0).to(self.device)

                with torch.no_grad():
                    # fidelity=0.0 = max CF reconstruction (recover open mouth shape)
                    cf_out = self.cf_mouth(t, w=0.0, adain=True)[0]

                cf_restored = tensor2img(cf_out, rgb2bgr=True, min_max=(-1, 1))
                gf = cv2.resize(cf_restored, (x2 - x1, y2 - y1), interpolation=cv2.INTER_AREA)

            # Gaussian blend edges for seamless composite
            mask = np.zeros((y2 - y1, x2 - x1), dtype=np.uint8)
            cv2.circle(mask, ((x2 - x1) // 2, (y2 - y1) // 2), min(mw, mh) // 3, 255, -1)
            mask = cv2.GaussianBlur(mask, (31, 31), 7.0).astype(np.float32) / 255.0
            mask = mask[:, :, np.newaxis]

            result = frame.copy()
            result[y1:y2, x1:x2] = (
                gf.astype(np.float32) * mask +
                mouth_crop.astype(np.float32) * (1.0 - mask)
            ).astype(np.uint8)

            return result

        except Exception as e:
            log.warning('Mouth enhancement failed: %s', e)
            return frame

class EnhanceEngine:
    """
    Wraps CodeFormer for post-swap face enhancement.
    Significantly improves sharpness, skin texture, and removes swap artifacts.

    Requires:
      - models/codeformer.pth  (auto-downloaded by bootstrap.sh — ~500MB)

    fidelity_weight: 0.0 = max enhancement, 1.0 = max fidelity to input.
    0.5 is the sweet spot for face swap use cases.
    """

    # 0.75: preserves 75% of inswapper output (mouth movement, expression)
    # vs 0.5 which let CF reconstruct too much from its resting-face prior
    FIDELITY = 0.75

    def __init__(self, model_path: str = 'models/codeformer.pth'):
        from basicsr.archs.codeformer_arch import CodeFormer
        from facexlib.utils.face_restoration_helper import FaceRestoreHelper

        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

        log.info('Loading CodeFormer from %s...', model_path)
        self.net = CodeFormer(
            dim_embd=512,
            codebook_size=1024,
            n_head=8,
            n_layers=9,
            connect_list=['32', '64', '128', '256'],
        ).to(self.device)

        checkpoint = torch.load(model_path, map_location=self.device)
        self.net.load_state_dict(checkpoint['params_ema'])
        self.net.eval()

        log.info('Loading FaceRestoreHelper...')
        self.helper = FaceRestoreHelper(
            upscale_factor=1,
            face_size=512,
            crop_ratio=(1, 1),
            det_model='retinaface_resnet50',
            save_ext='png',
            use_parse=True,
            device=self.device,
        )

    def enhance(self, frame: np.ndarray) -> np.ndarray:
        """Run CodeFormer enhancement on all faces in the frame."""
        from basicsr.utils import img2tensor, tensor2img
        from torchvision.transforms.functional import normalize as tnormalize

        self.helper.clean_all()
        self.helper.read_image(frame)
        self.helper.get_face_landmarks_5()
        self.helper.align_warp_face()

        if not self.helper.cropped_faces:
            return frame

        for cropped in self.helper.cropped_faces:
            t = img2tensor(cropped / 255.0, bgr2rgb=True, float32=True)
            tnormalize(t, (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), inplace=True)
            t = t.unsqueeze(0).to(self.device)

            with torch.no_grad():
                output = self.net(t, w=self.FIDELITY, adain=True)[0]

            restored = tensor2img(output, rgb2bgr=True, min_max=(-1, 1))
            self.helper.add_restored_face(restored.astype('uint8'))

        self.helper.get_inverse_affine(None)
        return self.helper.paste_faces_to_input_image()
