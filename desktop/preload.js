const { contextBridge, ipcRenderer } = require('electron');

// Lets the "ВЫХОД" button in the game close the application.
contextBridge.exposeInMainWorld('srDesktop', {
  quit: () => ipcRenderer.send('sr-quit'),
});
