const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chimera', {
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),
  attachWarmPod: (podId) => ipcRenderer.invoke('attach-warm-pod', podId),
  getStatus:    () => ipcRenderer.invoke('get-status'),
  startSession: (gpuType) => ipcRenderer.invoke('start-session', gpuType),
  checkReady:   () => ipcRenderer.invoke('check-ready'),
  stopSession:  () => ipcRenderer.invoke('stop-session'),
  getStreamProfile: () => ipcRenderer.invoke('get-stream-profile'),
  setStreamProfile: (profile) => ipcRenderer.invoke('set-stream-profile', profile),
  uploadFace:   (buffer, filename) => ipcRenderer.invoke('upload-face', buffer, filename),
  openDriversFolder: () => ipcRenderer.invoke('open-drivers-folder'),
  // Push each swapped frame to the OBS Browser Source server (fire-and-forget)
  obsFrame:     (dataUrl) => ipcRenderer.send('obs-frame', dataUrl),
});
