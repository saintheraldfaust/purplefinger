# Chimera Lite EXE sharing

## 1. Client config file

Create a file named `.env` in the same folder as the EXE.

Example:

```
BACKEND_URL=https://purplefinger-chimera.onrender.com
API_TOKEN=replace-with-the-same-token-used-on-render
OBS_PORT=7891
```

The app already reads `.env` from:

- the current working folder
- the Electron app folder
- the same folder as the packaged EXE
- the packaged resources folder

## 2. Build a portable EXE

From `chimera-lite/electron-client`:

- `npm install`
- `npm run dist`

Output:

- `dist/Chimera-Lite-1.0.0-Portable.exe`

This is the easiest file to share.

## 3. Share with the client

Send:

- the portable EXE from `dist/`
- a `.env` file with the correct `BACKEND_URL` and `API_TOKEN`

Place both in the same folder before launching.

## 4. OBS on the client machine

In OBS Browser Source, use:

- `http://localhost:7891`

That stays local on the client machine.

## 5. Optional installer build

To build a normal Windows installer:

- `npm run dist:installer`

Portable is simpler for external sharing because the `.env` can sit beside the EXE.