FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    python3.11 python3.11-dev python3-pip \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev \
    wget curl git \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python3 && \
    ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY docker/requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

COPY inference/ ./inference/
COPY build_engine.py .
COPY bootstrap.sh .
RUN chmod +x bootstrap.sh

RUN mkdir -p /app/models

EXPOSE 8765

CMD ["bash", "bootstrap.sh"]
