const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Configs
  getWebsites: () => ipcRenderer.invoke('get-websites'),
  saveWebsites: (websites) => ipcRenderer.invoke('save-websites', websites),
  
  // Library
  getLibrary: () => ipcRenderer.invoke('get-library'),
  saveLibrary: (games) => ipcRenderer.invoke('save-library', games),
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  runGame: (gameId) => ipcRenderer.invoke('run-game', gameId),
  deleteGame: (gameId, deleteFiles) => ipcRenderer.invoke('delete-game', gameId, deleteFiles),
  selectCoverImage: () => ipcRenderer.invoke('select-cover-image'),
  selectManualExe: () => ipcRenderer.invoke('select-manual-exe'),
  
  // Downloads & ZIP
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  onDownloadCompleted: (callback) => {
    ipcRenderer.on('download-completed', (event, data) => callback(data));
  },
  onDownloadFailed: (callback) => {
    ipcRenderer.on('download-failed', (event, data) => callback(data));
  },
  
  // Prompts from Main process when processing ZIP downloads
  onGameAdded: (callback) => {
    ipcRenderer.on('game-added', (event, data) => callback(data));
  },
  onLibraryUpdated: (callback) => {
    ipcRenderer.on('library-updated', () => callback());
  },
  onPromptExecutables: (callback) => {
    ipcRenderer.on('prompt-executables', (event, data) => callback(data));
  },
  onPromptNoExecutable: (callback) => {
    ipcRenderer.on('prompt-no-executable', (event, data) => callback(data));
  },
  resolveExecutableSelection: (gameId, selectedExe) => ipcRenderer.invoke('resolve-executable-selection', { gameId, selectedExe }),
  
  // Dialog window controls
  closeApp: () => ipcRenderer.send('close-app')
});
