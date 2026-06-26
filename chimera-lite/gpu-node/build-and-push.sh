#!/usr/bin/env bash
# Build the Purplefinger GPU image and push it to GHCR.
# Run this on the Contabo build box whenever dependencies / the Dockerfile /
# bootstrap change. Plain inference *code* changes do NOT need this — the pod
# bootstrap git-pulls them on every boot.
#
# Usage:
#   ./build-and-push.sh           # builds & pushes :latest (+ short commit sha)
#   ./build-and-push.sh v1.2.0    # also tags & pushes that extra tag
#
# Requires: docker, and a prior `docker login ghcr.io` with a PAT (write:packages).
set -euo pipefail

# Override with your own registry/image when building your own node:
#   PURPLEFINGER_GPU_IMAGE=ghcr.io/<you>/purplefinger-gpu ./build-and-push.sh
IMAGE="${PURPLEFINGER_GPU_IMAGE:-ghcr.io/saintheraldfaust/purplefinger-gpu}"
EXTRA_TAG="${1:-}"

# Resolve to the gpu-node dir regardless of where this is called from.
# The build context MUST be gpu-node — the Dockerfile does `COPY docker/requirements.txt`.
cd "$(dirname "$0")"

echo "==> Pulling latest repo code..."
git pull --ff-only

SHA="$(git rev-parse --short HEAD)"

echo "==> Building ${IMAGE}:latest (also tagging ${SHA})..."
docker build \
  -f docker/Dockerfile \
  -t "${IMAGE}:latest" \
  -t "${IMAGE}:${SHA}" \
  ${EXTRA_TAG:+-t "${IMAGE}:${EXTRA_TAG}"} \
  .

echo "==> Pushing tags to GHCR..."
docker push "${IMAGE}:latest"
docker push "${IMAGE}:${SHA}"
if [ -n "$EXTRA_TAG" ]; then
  docker push "${IMAGE}:${EXTRA_TAG}"
fi

echo ""
echo "Done. Pushed:"
echo "  ${IMAGE}:latest"
echo "  ${IMAGE}:${SHA}"
[ -n "$EXTRA_TAG" ] && echo "  ${IMAGE}:${EXTRA_TAG}"
echo ""
echo "Next: start a FRESH RunPod pod so it pulls the new image."
echo "(Running pods will NOT re-pull until terminated and restarted.)"
