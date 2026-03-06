#!/bin/bash
# Chimera Lite GPU Node Bootstrap
# Runs on pod startup via RunPod template Docker Command.
# Requires: network volume mounted at /workspace
set -e

echo "=== Chimera Lite Bootstrap ==="

# --- System packages (skipped if already present) ---
if ! command -v git &>/dev/null || ! command -v wget &>/dev/null; then
  echo "[0/4] Installing system packages..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wget git build-essential libgl1 libglib2.0-0
else
  echo "[0/4] System packages present -- skipping apt."
fi

WORKSPACE="/workspace"
MODELS_DIR="$WORKSPACE/models"
PYPREFIX="$WORKSPACE/pyprefix"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"

mkdir -p "$MODELS_DIR" "$PYPREFIX" "$CODE_DIR"

# Use whatever python3/pip3 the image provides (has torch/CUDA pre-installed).
PYTHON=$(which python3 2>/dev/null || which python)
PIP=$(which pip3 2>/dev/null || which pip)
PY_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "[0/4] Python: $PYTHON ($($PYTHON --version 2>&1))  pip: $PIP"

# Add volume packages to Python path (--prefix creates lib/pythonX.Y/site-packages)
export PYTHONPATH="$PYPREFIX/lib/python$PY_VER/site-packages:$PYTHONPATH"

# --- [1/4] Python packages (cached in volume) ---
# --prefix creates a proper lib/pythonX.Y/site-packages tree (unlike --target).
# This is required for insightface and other C-extension packages to import correctly.
# --no-cache-dir avoids corrupt cached wheels.

MARKER="$WORKSPACE/.packages-installed-v15"
if [ ! -f "$MARKER" ]; then
  rm -f "$WORKSPACE/.packages-installed-v"* 2>/dev/null || true
  echo "[1/4] Wiping old pyprefix before fresh install..."
  rm -rf "$PYPREFIX"
  mkdir -p "$PYPREFIX"
  echo "[1/4] Installing Python packages (first time -- cached after this)..."
  $PIP install --no-cache-dir --prefix "$PYPREFIX" \
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
  SP="$PYPREFIX/lib/python$PY_VER/site-packages"
  echo "[1/4] Purging numpy/torch from volume (must use system versions)..."
  rm -rf "$SP"/numpy* "$SP"/torch* "$SP"/torchvision* "$SP"/torchaudio* 2>/dev/null || true
  touch "$MARKER"
  echo "[1/4] Packages installed and cached."
else
  echo "[1/4] Packages already cached -- skipping."
fi

# Always purge numpy/torch on every boot in case a dep reinstalled them
SP="$PYPREFIX/lib/python$PY_VER/site-packages"
rm -rf "$SP"/numpy* "$SP"/torch* "$SP"/torchvision* "$SP"/torchaudio* 2>/dev/null || true

# Fix basicsr compatibility with torchvision >= 0.16
find "$PYPREFIX" -path "*/basicsr/data/degradations.py" -exec sed -i \
  's/from torchvision.transforms.functional_tensor import rgb_to_grayscale/from torchvision.transforms.functional import rgb_to_grayscale/' {} \;

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