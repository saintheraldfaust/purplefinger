const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chimera', {
  getStatus:    () => ipcRenderer.invoke('get-status'),
  startSession: () => ipcRenderer.invoke('start-session'),
  checkReady:   () => ipcRenderer.invoke('check-ready'),
  stopSession:  () => ipcRenderer.invoke('stop-session'),
  getStreamProfile: () => ipcRenderer.invoke('get-stream-profile'),
  setStreamProfile: (profile) => ipcRenderer.invoke('set-stream-profile', profile),
  uploadFace:   (buffer, filename) => ipcRenderer.invoke('upload-face', buffer, filename),
  // Push each swapped frame to the OBS Browser Source server (fire-and-forget)
  obsFrame:     (dataUrl) => ipcRenderer.send('obs-frame', dataUrl),
});
