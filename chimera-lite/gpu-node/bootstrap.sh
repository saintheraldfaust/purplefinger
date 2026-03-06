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
PKGS_DIR="$WORKSPACE/site-packages"
CODE_DIR="/app"
REPO_URL="https://github.com/saintheraldfaust/purplefinger.git"

mkdir -p "$MODELS_DIR" "$PKGS_DIR" "$CODE_DIR"

# Use whatever python3/pip3 the image provides (has torch/CUDA pre-installed).
PYTHON=$(which python3 2>/dev/null || which python)
PIP=$(which pip3 2>/dev/null || which pip)
echo "[0/4] Python: $PYTHON ($($PYTHON --version 2>&1))  pip: $PIP"

# Add volume packages to Python path
export PYTHONPATH="$PKGS_DIR:$PYTHONPATH"

# --- [1/4] Python packages (cached in volume) ---
# Install with --target into the volume so packages persist across pod restarts.
# --no-cache-dir avoids corrupt cached wheels left over in /workspace/.cache/pip.
# numpy is EXCLUDED -- must come from system Python (pre-built against torch).
# After install we also purge any numpy that snuck in as a transitive dep.

MARKER="$WORKSPACE/.packages-installed-v13"
if [ ! -f "$MARKER" ]; then
  rm -f "$WORKSPACE/.packages-installed-v"* 2>/dev/null || true
  echo "[1/4] Installing Python packages (first time -- cached after this)..."
  $PIP install --quiet --no-cache-dir --target "$PKGS_DIR" \
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
  echo "[1/4] Purging numpy/torch from volume (must use system versions)..."
  rm -rf "$PKGS_DIR"/numpy "$PKGS_DIR"/numpy-*.dist-info 2>/dev/null || true
  rm -rf "$PKGS_DIR"/torch "$PKGS_DIR"/torch-*.dist-info 2>/dev/null || true
  rm -rf "$PKGS_DIR"/torchvision "$PKGS_DIR"/torchvision-*.dist-info 2>/dev/null || true
  rm -rf "$PKGS_DIR"/torchaudio "$PKGS_DIR"/torchaudio-*.dist-info 2>/dev/null || true
  touch "$MARKER"
  echo "[1/4] Packages installed and cached."
else
  echo "[1/4] Packages already cached -- skipping."
fi

# Always purge numpy/torch on every boot in case a dep reinstalled them
rm -rf "$PKGS_DIR"/numpy "$PKGS_DIR"/numpy-*.dist-info 2>/dev/null || true
rm -rf "$PKGS_DIR"/torch "$PKGS_DIR"/torch-*.dist-info 2>/dev/null || true
rm -rf "$PKGS_DIR"/torchvision "$PKGS_DIR"/torchvision-*.dist-info 2>/dev/null || true
rm -rf "$PKGS_DIR"/torchaudio "$PKGS_DIR"/torchaudio-*.dist-info 2>/dev/null || true

# Fix basicsr compatibility with torchvision >= 0.16
find "$PKGS_DIR" -path "*/basicsr/data/degradations.py" -exec sed -i \
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