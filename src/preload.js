const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('harbor', {
  call: async (action, value) => {
    const result = await ipcRenderer.invoke('action', action, value);
    if (result.error) throw new Error(result.error);
    return result.value;
  },
  onChange: callback => ipcRenderer.on('changed', (_event, value) => callback(value)),
  onError: callback => ipcRenderer.on('app-error', (_event, message) => callback(message))
});
