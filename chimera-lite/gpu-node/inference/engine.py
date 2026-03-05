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

    DETECT_EVERY_N = 3   # run face detection every N frames, reuse cached faces between

    def __init__(self, model_path: str = 'models/inswapper_128.onnx'):
        import insightface
        from insightface.app import FaceAnalysis
        from insightface.model_zoo import model_zoo

        log.info('Loading InsightFace buffalo_l...')
        self.app = FaceAnalysis(name='buffalo_l', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        self.app.prepare(ctx_id=0, det_size=(320, 320))   # 320 is 4x faster than 640

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

        # Only run expensive face detection every N frames
        if self._frame_idx % self.DETECT_EVERY_N == 1 or not self._cached_target_faces:
            faces = self.app.get(frame)
            if faces:
                self._cached_target_faces = faces

        if not self._cached_target_faces:
            return frame

        result = frame.copy()
        for face in self._cached_target_faces:
            result = self.swapper.get(result, face, self._source_face, paste_back=True)
        return result


# ---------------------------------------------------------------------------
# Enhance Engine — CodeFormer face restoration
# ---------------------------------------------------------------------------

class EnhanceEngine:
    """
    Wraps CodeFormer for post-swap face enhancement.
    Significantly improves sharpness, skin texture, and removes swap artifacts.

    Requires:
      - models/codeformer.pth  (auto-downloaded by bootstrap.sh — ~500MB)

    fidelity_weight: 0.0 = max enhancement, 1.0 = max fidelity to input.
    0.5 is the sweet spot for face swap use cases.
    """

    FIDELITY = 0.5

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
