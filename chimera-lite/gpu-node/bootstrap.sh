#!/bin/bash
# Chimera Lite GPU Node Bootstrap
# Runs on pod startup via RunPod template Docker Command.
set -e

echo "=== Chimera Lite Bootstrap ==="

ensure_apt_packages() {
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
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
mkdir -p "$MODELS_DIR" "$CODE_DIR"

PYTHON=$(which python3 2>/dev/null || which python)
PIP=$(which pip3 2>/dev/null || which pip)
echo "[0/4] Python: $PYTHON ($($PYTHON --version 2>&1))  pip: $PIP"

# --- [1/4] Python packages ---
if ! $PYTHON -m venv --help >/dev/null 2>&1; then
  echo "[1/4] python venv module missing -- installing python3-venv..."
  ensure_apt_packages python3-venv
fi

BOOTSTRAP_REQS_FILE="$WORKSPACE/.cache/chimera-lite-bootstrap-requirements.txt"
VENV_DIR="$WORKSPACE/.venvs/chimera-lite"
VENV_PYTHON="$VENV_DIR/bin/python"
REQ_HASH_FILE="$VENV_DIR/.bootstrap-requirements.sha256"

mkdir -p "$WORKSPACE/.cache" "$WORKSPACE/.venvs"
cat > "$BOOTSTRAP_REQS_FILE" <<'REQEOF'
insightface
onnxruntime-gpu
aiohttp
aiohttp-cors
opencv-python-headless
Pillow
basicsr
facexlib
gfpgan
realesrgan
REQEOF

CURRENT_REQ_HASH=$(sha256sum "$BOOTSTRAP_REQS_FILE" | awk '{print $1}')
INSTALLED_REQ_HASH=""
if [ -f "$REQ_HASH_FILE" ]; then
  INSTALLED_REQ_HASH=$(cat "$REQ_HASH_FILE" 2>/dev/null || true)
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "[1/4] Creating persistent virtualenv on volume..."
  $PYTHON -m venv "$VENV_DIR"
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "[1/4] Virtualenv python missing after creation attempt -- recreating..."
  rm -rf "$VENV_DIR"
  $PYTHON -m venv "$VENV_DIR"
fi

if ! "$VENV_PYTHON" -m pip --version >/dev/null 2>&1; then
  echo "[1/4] Virtualenv pip missing or broken -- repairing env..."
  rm -rf "$VENV_DIR"
  $PYTHON -m venv "$VENV_DIR"
  "$VENV_PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 || true
fi

if [ "$CURRENT_REQ_HASH" != "$INSTALLED_REQ_HASH" ]; then
  echo "[1/4] Installing Python packages into persistent volume env..."
  unset PIP_CACHE_DIR
  "$VENV_PYTHON" -m pip install --quiet --upgrade pip setuptools wheel
  "$VENV_PYTHON" -m pip install --quiet --cache-dir "$WORKSPACE/.cache/pip" -r "$BOOTSTRAP_REQS_FILE"

  # Fix basicsr compatibility with torchvision >= 0.16
  $VENV_PYTHON - <<'PYEOF'
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
  printf '%s' "$CURRENT_REQ_HASH" > "$REQ_HASH_FILE"
else
  echo "[1/4] Persistent Python env already matches requirements -- skipping install."
fi

PYTHON="$VENV_PYTHON"
PIP="$VENV_PYTHON -m pip"

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