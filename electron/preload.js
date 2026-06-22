const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  savePdf: (filename) => ipcRenderer.invoke("save-pdf", filename)
});
