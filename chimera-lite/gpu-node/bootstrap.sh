#!/bin/bash
# Chimera Lite GPU Node Bootstrap — no-Docker edition
# Runs on pod startup via RunPod template Docker Command.
# Requires: network volume mounted at /workspace
set -e

echo "=== Chimera Lite Bootstrap ==="

# Ensure basic tools are available (minimal images don't include wget/git).
# Guard with a binary check so same-pod restarts skip the slow apt network round-trip.
if ! command -v git &>/dev/null || ! command -v wget &>/dev/null; then
  echo "[0/4] Installing system packages..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wget git build-essential libgl1 libglib2.0-0
else
  echo "[0/4] System packages already present — skipping apt."
fi

WORKSPACE="/workspace"
MODELS_DIR="$WORKSPACE/models"
VENV_DIR="$WORKSPACE/venv"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"

mkdir -p "$MODELS_DIR" "$CODE_DIR"

# --- [1/4] Python venv (cached in volume) ---
# Use a venv with --system-site-packages so torch/numpy/torchvision from the
# base image (pytorch/pytorch:2.1.2-cuda12.1) are inherited automatically.
# Our packages (insightface, gfpgan etc.) install into the venv's own tree —
# no shadowing, no compiled-extension conflicts across restarts.

MARKER="$WORKSPACE/.packages-installed-v7"
if [ ! -f "$MARKER" ]; then
  rm -f "$WORKSPACE/.packages-installed-v"* 2>/dev/null || true
  echo "[1/4] Creating Python venv with system site-packages..."
  python3 -m venv --system-site-packages "$VENV_DIR"
  echo "[1/4] Installing Python packages into venv (first time — cached after this)..."
  "$VENV_DIR/bin/pip" install --quiet --upgrade \
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
  echo "[1/4] Python venv already cached — skipping."
fi

# Fix basicsr compatibility with torchvision >= 0.16 (functional_tensor was removed)
find "$VENV_DIR" -path "*/basicsr/data/degradations.py" -exec sed -i \
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
exec "$VENV_DIR/bin/python" chimera-lite/gpu-node/inference/webrtc_server.py
