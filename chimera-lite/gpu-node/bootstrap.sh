#!/bin/bash
# Chimera Lite GPU Node Bootstrap
# Runs on pod startup via RunPod template Docker Command.
set -e

echo "=== Chimera Lite Bootstrap ==="

# --- [0/4] System packages ---
if ! command -v git &>/dev/null || ! command -v wget &>/dev/null; then
  echo "[0/4] Installing system packages..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wget git build-essential libgl1 libglib2.0-0
else
  echo "[0/4] System packages present -- skipping apt."
fi

WORKSPACE="/workspace"
MODELS_DIR="$WORKSPACE/models"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"
mkdir -p "$MODELS_DIR" "$CODE_DIR"

PYTHON=$(which python3 2>/dev/null || which python)
PIP=$(which pip3 2>/dev/null || which pip)
echo "[0/4] Python: $PYTHON ($($PYTHON --version 2>&1))  pip: $PIP"

# --- [1/4] Python packages ---
# Install to system Python on every boot (packages are ephemeral per container).
# Volume is used as pip download cache: first boot downloads, every boot after
# that installs from cached wheels in ~60 sec -- no import path tricks needed.
echo "[1/4] Installing Python packages..."
# Nuke volume pip cache — RunPod sets PIP_CACHE_DIR=/workspace/.cache/pip
# which causes corrupt wheels to persist across pods. Wipe it every boot.
rm -rf "$WORKSPACE/.cache/pip"
unset PIP_CACHE_DIR
$PIP install --quiet --no-cache-dir \
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

# Fix basicsr compatibility with torchvision >= 0.16
$PYTHON - <<'PYEOF'
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