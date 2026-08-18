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
  getGameLaunchStatus: (gameId) => ipcRenderer.invoke('get-game-launch-status', gameId),
  openSteam: () => ipcRenderer.invoke('open-steam'),
  openWindowsSecurity: () => ipcRenderer.invoke('open-windows-security'),
  openGameFolder: (gameId) => ipcRenderer.invoke('open-game-folder', gameId),
  openStorageFolder: (folderName) => ipcRenderer.invoke('open-storage-folder', folderName),
  createGameShortcut: (gameId) => ipcRenderer.invoke('create-game-shortcut', gameId),
  setWindowFullscreen: (fullscreen) => ipcRenderer.invoke('set-window-fullscreen', fullscreen),
  isWindowFullscreen: () => ipcRenderer.invoke('is-window-fullscreen'),
  deleteGame: (gameId, deleteFiles) => ipcRenderer.invoke('delete-game', gameId, deleteFiles),
  toggleGameFavorite: (gameId) => ipcRenderer.invoke('toggle-game-favorite', gameId),
  getStorageStats: () => ipcRenderer.invoke('get-storage-stats'),
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
  onLaunchGameRequested: (callback) => {
    ipcRenderer.on('launch-game-requested', (event, gameId) => callback(gameId));
  },
  onPromptExecutables: (callback) => {
    ipcRenderer.on('prompt-executables', (event, data) => callback(data));
  },
  onPromptNoExecutable: (callback) => {
    ipcRenderer.on('prompt-no-executable', (event, data) => callback(data));
  },
  resolveExecutableSelection: (gameId, selectedExe) => ipcRenderer.invoke('resolve-executable-selection', { gameId, selectedExe }),
  onPromptArchivePassword: (callback) => {
    ipcRenderer.on('prompt-archive-password', (event, data) => callback(data));
  },
  submitArchivePassword: (gameId, password) => ipcRenderer.invoke('submit-archive-password', { gameId, password }),
  cancelArchiveExtraction: (gameId) => ipcRenderer.invoke('cancel-archive-extraction', gameId),
  
  // Dialog window controls & Adblock
  closeApp: () => ipcRenderer.send('close-app'),
  getAdblockStatus: (currentUrl) => ipcRenderer.invoke('get-adblock-status', currentUrl),
  toggleAdblockGlobal: () => ipcRenderer.invoke('toggle-adblock-global'),
  toggleAdblockSite: (domain) => ipcRenderer.invoke('toggle-adblock-site', domain),
  updateAdblockFilters: () => ipcRenderer.invoke('update-adblock-filters'),
  onAdblockStatsUpdated: (callback) => {
    ipcRenderer.on('adblock-stats-updated', (event, data) => callback(data));
  }
});
