FROM runpod/pytorch:2.2.0-py3.10-cuda12.1.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:/usr/local/cuda/extras/CUPTI/lib64:${LD_LIBRARY_PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    wget git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/chimera

COPY docker/requirements.txt .
RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel && \
    python3 -m pip uninstall -y onnxruntime onnxruntime-gpu 2>/dev/null; \
    python3 -m pip install --no-cache-dir onnxruntime-gpu --extra-index-url https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-12/pypi/simple/ && \
    python3 -m pip install --no-cache-dir -r requirements.txt && \
    python3 - <<'PYEOF'
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
