# Building Purplefinger installers

The client is a standard Electron app. From `chimera-lite/electron-client`:

```bash
npm install
npm run dist        # Windows (NSIS installer)
npm run dist:mac    # macOS (dmg/zip)
```

Output lands in `dist/`.

## Configuration

There's no backend, account, or license — Purplefinger connects directly to a
GPU node you run (see [`../gpu-node/`](../gpu-node/)). Configure it from the
app's **Config** panel, or via an optional `.env` next to the executable:

```
GPU_URL=ws://<host>:<port>
OBS_PORT=7891
```

See [`.env.example`](.env.example).
