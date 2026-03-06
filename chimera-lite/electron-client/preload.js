const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chimera', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  startSession: () => ipcRenderer.invoke('start-session'),    checkReady:    () => ipcRenderer.invoke('check-ready'),  stopSession: () => ipcRenderer.invoke('stop-session'),
  uploadFace: (buffer, filename) => ipcRenderer.invoke('upload-face', buffer, filename),
});
