#!/bin/bash
# Chimera Lite GPU Node Bootstrap — no-Docker edition
# Runs on pod startup via RunPod template Docker Command.
# Requires: network volume mounted at /workspace
set -e

echo "=== Chimera Lite Bootstrap ==="

# Ensure basic tools are available (minimal images don't include wget/git).
# Guard with a binary check so same-pod restarts skip the slow apt network round-trip.
if ! command -v git &>/dev/null || ! python3 -c "import cv2" 2>/dev/null; then
  echo "[0/4] Installing system packages..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wget git build-essential libgl1 libglib2.0-0
else
  echo "[0/4] System packages already present — skipping apt."
fi

WORKSPACE="/workspace"
MODELS_DIR="$WORKSPACE/models"
PKGS_DIR="$WORKSPACE/site-packages"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"

mkdir -p "$MODELS_DIR" "$PKGS_DIR" "$CODE_DIR"

# Add volume packages to Python path for this session
export PYTHONPATH="$PKGS_DIR:$PYTHONPATH"

# --- [1/4] Python packages (cached in volume) ---
# IMPORTANT: torch/torchvision/numpy must NEVER be installed into the volume.
# The base image (pytorch/pytorch:2.1.2-cuda12.1) already has them compiled
# against each other. Installing numpy into /workspace/site-packages overrides
# the system numpy, breaking torch's C extensions (_ARRAY_API not found) and
# causing all compiled modules (insightface, onnxruntime) to fail.
# Purge on every boot — runs in <1s, unconditional.
echo "[1/4] Purging compiled base-image packages from volume..."
rm -rf \
  "$PKGS_DIR/torch" "$PKGS_DIR/torchvision" "$PKGS_DIR/torchaudio" \
  "$PKGS_DIR/torch"-*.dist-info "$PKGS_DIR/torchvision"-*.dist-info \
  "$PKGS_DIR/numpy" "$PKGS_DIR/numpy"-*.dist-info \
  2>/dev/null || true

MARKER="$WORKSPACE/.packages-installed-v6"
if [ ! -f "$MARKER" ]; then
  # Remove old markers so we don't skip the install on version bumps
  rm -f "$WORKSPACE/.packages-installed-v"* 2>/dev/null || true
  echo "[1/4] Installing Python packages (first time — cached after this)..."
  pip install --quiet --upgrade --target "$PKGS_DIR" \
    insightface \
    onnxruntime-gpu \
    aiohttp \
    aiohttp-cors \
    opencv-python-headless \
    Pillow \
    basicsr \
    facexlib \
    gfpgan \
    realesrgan
  touch "$MARKER"
  echo "[1/4] Packages installed and cached."
else
  echo "[1/4] Python packages already cached — skipping."
fi

# Fix basicsr compatibility with torchvision >= 0.16 (functional_tensor was removed)
find "$PKGS_DIR" -path "*/basicsr/data/degradations.py" -exec sed -i \
  's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' {} \;

# --- [2/4] Code (always pull latest) ---
echo "[2/4] Fetching latest code from GitHub..."
if [ ! -d "$CODE_DIR/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$CODE_DIR"
else
  git -C "$CODE_DIR" pull --ff-only
fi

# Point /app/models at the volume models dir
ln -sfn "$MODELS_DIR" "$CODE_DIR/models"

# --- [3/4] Models (cached in volume) ---
if [ ! -f "$MODELS_DIR/deploy.prototxt" ]; then
  echo "[3/4] Downloading OpenCV face detector..."
  wget -q -O "$MODELS_DIR/deploy.prototxt" \
    "https://raw.githubusercontent.com/opencv/opencv/master/samples/dnn/face_detector/deploy.prototxt"
  wget -q -O "$MODELS_DIR/res10_300x300_ssd_iter_140000.caffemodel" \
    "https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20170830/res10_300x300_ssd_iter_140000.caffemodel"
fi

if [ ! -f "$MODELS_DIR/codeformer.pth" ]; then
  echo "[3/4] Downloading CodeFormer weights (~500MB)..."
  wget -q --show-progress -O "$MODELS_DIR/codeformer.pth" \
    "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth"
fi

if [ ! -f "$MODELS_DIR/GFPGANv1.4.pth" ]; then
  echo "[3/4] Downloading GFPGANv1.4.pth (~350MB)..."
  wget -q --show-progress -O "$MODELS_DIR/GFPGANv1.4.pth" \
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth"
fi

if [ ! -f "$MODELS_DIR/inswapper_128.onnx" ]; then
  echo "[3/4] Downloading inswapper_128.onnx (~500MB)..."
  wget -q --show-progress -O "$MODELS_DIR/inswapper_128.onnx" \
    "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"
fi

echo "[3/4] All models ready."

# --- [4/4] Start inference server ---
echo ""
echo "=== Starting inference server ==="
cd "$CODE_DIR"
exec python chimera-lite/gpu-node/inference/webrtc_server.py
