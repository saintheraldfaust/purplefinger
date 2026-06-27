FROM runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    wget git gnupg \
    && rm -rf /var/lib/apt/lists/*

# nvcc + CUDA dev headers so basicsr/GFPGAN can JIT-compile their custom ops
# (upfirdn2d, fused_act) for Blackwell (sm_120). Without nvcc they fall back to a
# ~3x slower pure-PyTorch path — the cause of GFPGAN running ~170ms instead of ~55ms.
RUN wget -qO /tmp/cuda-keyring.deb \
      https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb && \
    dpkg -i /tmp/cuda-keyring.deb && apt-get update && \
    apt-get install -y --no-install-recommends cuda-nvcc-12-8 cuda-cudart-dev-12-8 && \
    rm -rf /var/lib/apt/lists/* /tmp/cuda-keyring.deb
ENV CUDA_HOME=/usr/local/cuda-12.8
ENV PATH=/usr/local/cuda-12.8/bin:${PATH}

WORKDIR /opt/chimera

COPY docker/requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel && \
    python3 -m pip install --no-cache-dir -r requirements.txt && \
    # insightface depends on the CPU `onnxruntime`, which gets installed on top of
    # `onnxruntime-gpu` (same import name) and strips out CUDAExecutionProvider.
    # Force the GPU build to be the one that wins, installed last.
    python3 -m pip uninstall -y onnxruntime onnxruntime-gpu && \
    python3 -m pip install --no-cache-dir onnxruntime-gpu==1.20.1 && \
    # Fail the build immediately if the GPU provider isn't compiled in
    # (cheaper than discovering it on a crash-looping RunPod pod).
    python3 -c "import onnxruntime as o; p=o.get_available_providers(); assert 'CUDAExecutionProvider' in p, p; print('onnxruntime providers OK:', p)"

# Patch basicsr's removed torchvision import (functional_tensor -> functional)
RUN python3 - <<'PYEOF'
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

RUN rm -rf /root/.cache /tmp/* /var/tmp/*

COPY bootstrap.sh /usr/local/bin/chimera-bootstrap
RUN chmod +x /usr/local/bin/chimera-bootstrap && mkdir -p /app /workspace/models

EXPOSE 8765

CMD ["bash", "/usr/local/bin/chimera-bootstrap"]
