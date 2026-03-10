# Purplefinger GPU image rollout

This document covers the low-bandwidth deployment path for the GPU node.

## Goal

Bake heavy Python dependencies into a single GPU image once, publish it through GitHub Container Registry (GHCR), and let RunPod pull that image directly.

After that, keep the bootstrap lightweight so normal code updates still come from `git pull` instead of full Docker image rebuilds.

## Image name

The GitHub Actions workflow publishes:

- `ghcr.io/saintheraldfaust/purplefinger-gpu:latest`
- `ghcr.io/saintheraldfaust/purplefinger-gpu:<commit-sha>`

## 1. Publish the image from GitHub Actions

The workflow is defined in [.github/workflows/build-gpu-image.yml](../../.github/workflows/build-gpu-image.yml).

It triggers on:

- manual dispatch
- pushes that touch the GPU Docker files or bootstrap

### First run

1. Push the workflow and Docker changes to GitHub.
2. Open the repository on GitHub.
3. Go to Actions.
4. Run `Build Purplefinger GPU image` manually if needed.
5. Wait for the workflow to finish.

## 2. Make the GHCR package public

For easiest RunPod pulls, make the container package public.

In GitHub:

1. Open your profile packages page.
2. Open the `purplefinger-gpu` package.
3. Change package visibility to Public.

## 3. Update the RunPod template

In RunPod, edit the template currently used by the backend.

### Set image

Use:

- `ghcr.io/saintheraldfaust/purplefinger-gpu:latest`

Or, for a pinned stable build:

- `ghcr.io/saintheraldfaust/purplefinger-gpu:<commit-sha>`

### Command / entrypoint

Prefer using the image default command.

That image already starts with:

- `bash /usr/local/bin/chimera-bootstrap`

So if the template currently overrides the command with a raw GitHub bootstrap fetch, remove that override.

### Keep the same networking

Keep:

- exposed port `8765/tcp`

### Keep the same network volume

Keep your existing RunPod network volume so models and caches persist.

## 4. What bootstrap does now

The new baked-image bootstrap only:

1. verifies lightweight system tools
2. verifies the baked Python runtime exists
3. pulls the latest repo code
4. links the models directory
5. downloads missing models if needed
6. starts the inference server

It does **not** install Python packages on normal boots.

## 5. Slow fallback mode

If the baked image is missing runtime dependencies, bootstrap fails fast by default.

There is an emergency fallback:

- set `CHIMERA_ALLOW_RUNTIME_PIP=1`

That re-enables slow runtime pip installation, but it should only be used for recovery or debugging.

## 6. Normal future workflow

After the image is in place:

### For normal code tweaks

1. Edit code.
2. Push to GitHub.
3. Start or restart a pod.
4. Bootstrap pulls the latest code.

No large image push is needed for normal Python logic changes.

### Rebuild the image only when dependencies change

Rebuild the image when you change:

- the base image
- `docker/requirements.txt`
- system packages
- bootstrap expectations for baked runtime

## 7. Expected startup logs after migration

Healthy baked-image startup should show:

```text
=== Chimera Lite Bootstrap ===
[0/4] System packages present -- skipping apt.
[0/4] Python: /usr/bin/python3 (...)  pip: /usr/local/bin/pip3
[1/4] Baked Python runtime ready.
[1/4] Packages ready.
[2/4] Fetching latest code...
```

If you still see long package installation logs on every boot, the template is still using the old runtime-install path or the wrong image.