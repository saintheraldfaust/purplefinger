#!/bin/bash
# Chimera Lite GPU Node Bootstrap
# Runs on pod startup via RunPod template Docker Command.
set -e

echo "=== Chimera Lite Bootstrap ==="

ensure_apt_packages() {
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
}

fix_basicsr_patch() {
  "$PYTHON" - <<'PYEOF'
import site, os
for d in site.getsitepackages():
    f = os.path.join(d, 'basicsr/data/degradations.py')
    if os.path.exists(f):
        c = open(f).read()
        c = c.replace(
            'from torchvision.transforms.functional_tensor import rgb_to_grayscale',
            'from torchvision.transforms.functional import rgb_to_grayscale')
        open(f, 'w').write(c)
        print('Fixed basicsr degradations.py')
        break
PYEOF
}

# --- [0/4] System packages ---
if ! command -v git &>/dev/null || ! command -v wget &>/dev/null; then
  echo "[0/4] Installing system packages..."
  ensure_apt_packages wget git build-essential libgl1 libglib2.0-0 python3-venv
else
  echo "[0/4] System packages present -- skipping apt."
fi

WORKSPACE="/workspace"
MODELS_DIR="$WORKSPACE/models"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"
RUNTIME_REQS_FILE="/opt/chimera/requirements.txt"
mkdir -p "$MODELS_DIR" "$MODELS_DIR/trt_cache" "$CODE_DIR"

PYTHON=$(which python3 2>/dev/null || which python)
PIP=$(which pip3 2>/dev/null || which pip)
echo "[0/4] Python: $PYTHON ($($PYTHON --version 2>&1))  pip: $PIP"

# --- [1/4] Python packages / runtime ---
if "$PYTHON" - <<'PYEOF' >/dev/null 2>&1
import aiohttp
import aiohttp_cors
import cv2
import numpy
import torch
import insightface
import basicsr
import facexlib
import gfpgan
import realesrgan
PYEOF
then
  echo "[1/4] Baked Python runtime ready."
else
  if [ "${CHIMERA_ALLOW_RUNTIME_PIP:-0}" = "1" ]; then
    echo "[1/4] Baked runtime incomplete -- falling back to runtime pip install..."
    mkdir -p "$WORKSPACE/.cache/pip"
    unset PIP_CACHE_DIR
    "$PYTHON" -m pip install --quiet --upgrade pip setuptools wheel
    "$PYTHON" -m pip install --quiet --cache-dir "$WORKSPACE/.cache/pip" -r "$RUNTIME_REQS_FILE"
    fix_basicsr_patch
  else
    echo "[1/4] ERROR: baked Python runtime is missing required packages."
    echo "[1/4] Rebuild/publish the GPU image, or set CHIMERA_ALLOW_RUNTIME_PIP=1 for a slow fallback boot."
    exit 1
  fi
fi

echo "[1/4] Packages ready."

# --- [2/4] Code (always pull latest) ---
echo "[2/4] Fetching latest code..."
if [ ! -d "$CODE_DIR/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$CODE_DIR"
else
  git -C "$CODE_DIR" pull --ff-only
fi
ln -sfn "$MODELS_DIR" "$CODE_DIR/models"

# --- [3/4] Models (cached in volume) ---
if [ ! -f "$MODELS_DIR/GFPGANv1.4.pth" ]; then
  echo "[3/4] Downloading GFPGANv1.4.pth..."
  wget -q --show-progress -O "$MODELS_DIR/GFPGANv1.4.pth" \
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth"
fi
if [ ! -f "$MODELS_DIR/inswapper_128.onnx" ]; then
  echo "[3/4] Downloading inswapper_128.onnx..."
  wget -q --show-progress -O "$MODELS_DIR/inswapper_128.onnx" \
    "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"
fi
echo "[3/4] All models ready."

# --- [4/4] Start inference server ---
echo ""
echo "=== Starting inference server ==="
cd "$CODE_DIR"
exec $PYTHON chimera-lite/gpu-node/inference/webrtc_server.py