'use strict';
// Bridge between the UI and the main process. The UI gets exactly two things: call() and on().
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gymBridge', {
  call: (method, params) => ipcRenderer.invoke('gym:call', method, params),
  on: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('gym:event', handler);
    return () => ipcRenderer.removeListener('gym:event', handler);
  },
});
