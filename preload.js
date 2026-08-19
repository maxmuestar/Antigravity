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
  },
  
  // App Auto-Updater (GitHub Releases)
  checkAppUpdate: (manual) => ipcRenderer.invoke('check-app-update', manual),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  startAppUpdateDownload: (downloadUrl) => ipcRenderer.invoke('start-app-update-download', downloadUrl),
  applyAppUpdateAndRestart: () => ipcRenderer.invoke('apply-app-update-and-restart'),
  onAppUpdateAvailable: (callback) => {
    ipcRenderer.on('app-update-available', (event, data) => callback(data));
  },
  onUpdateDownloadProgress: (callback) => {
    ipcRenderer.on('update-download-progress', (event, data) => callback(data));
  },

  // Minecraft Launcher & Mod Center
  mcLoginMicrosoft: () => ipcRenderer.invoke('mc-login-microsoft'),
  mcSetOfflineProfile: (username) => ipcRenderer.invoke('mc-set-offline-profile', username),
  mcGetProfile: () => ipcRenderer.invoke('mc-get-profile'),
  mcLogout: () => ipcRenderer.invoke('mc-logout'),
  mcGetConfig: () => ipcRenderer.invoke('mc-get-config'),
  mcSaveConfig: (config) => ipcRenderer.invoke('mc-save-config', config),
  mcGetInstances: () => ipcRenderer.invoke('mc-get-instances'),
  mcGetActiveInstance: () => ipcRenderer.invoke('mc-get-active-instance'),
  mcSetActiveInstance: (instanceId) => ipcRenderer.invoke('mc-set-active-instance', instanceId),
  mcCreateInstance: (instanceData) => ipcRenderer.invoke('mc-create-instance', instanceData),
  mcUpdateInstance: (instanceId, updates) => ipcRenderer.invoke('mc-update-instance', { instanceId, updates }),
  mcDeleteInstance: (instanceId) => ipcRenderer.invoke('mc-delete-instance', instanceId),
  mcInstallModpack: (mrpackUrl, modpackName) => ipcRenderer.invoke('mc-install-modpack', { mrpackUrl, modpackName }),
  mcGetVersions: () => ipcRenderer.invoke('mc-get-versions'),
  mcSearchModrinth: (params) => ipcRenderer.invoke('mc-search-modrinth', params),
  mcGetProject: (projectId) => ipcRenderer.invoke('mc-get-project', projectId),
  mcGetProjectVersions: (projectId, loader, version) => ipcRenderer.invoke('mc-get-project-versions', { projectId, loader, version }),
  mcInstallMod: (fileUrl, fileName, projectType, instanceId) => ipcRenderer.invoke('mc-install-mod', { fileUrl, fileName, projectType, instanceId }),
  mcGetInstalledMods: (instanceId) => ipcRenderer.invoke('mc-get-installed-mods', instanceId),
  mcToggleMod: (filename, enable, instanceId) => ipcRenderer.invoke('mc-toggle-mod', { filename, enable, instanceId }),
  mcToggleAllMods: (enable, instanceId) => ipcRenderer.invoke('mc-toggle-all-mods', { enable, instanceId }),
  mcDeleteMod: (filename, instanceId) => ipcRenderer.invoke('mc-delete-mod', { filename, instanceId }),
  mcInstallLocalJars: (filePaths, instanceId) => ipcRenderer.invoke('mc-install-local-jars', { filePaths, instanceId }),
  mcCheckModUpdates: (instanceId) => ipcRenderer.invoke('mc-check-mod-updates', instanceId),
  mcUploadLog: (logText) => ipcRenderer.invoke('mc-upload-log', logText),
  mcSetOfflineSkin: (skinConfig) => ipcRenderer.invoke('mc-set-offline-skin', skinConfig),
  mcGetAccounts: () => ipcRenderer.invoke('mc-get-accounts'),
  mcSetActiveAccount: (accountId) => ipcRenderer.invoke('mc-set-active-account', accountId),
  mcDeleteAccount: (accountId) => ipcRenderer.invoke('mc-delete-account', accountId),
  mcBrowseFile: (type) => ipcRenderer.invoke('mc-browse-file', { type }),
  mcOpenFolder: (folderType, instanceId) => ipcRenderer.invoke('mc-open-folder', { folderType, instanceId }),
  mcLaunchGame: (launchConfig) => ipcRenderer.invoke('mc-launch-game', launchConfig),
  onMcLaunchProgress: (callback) => ipcRenderer.on('mc-launch-progress', (e, data) => callback(data)),
  onMcModDownloadProgress: (callback) => ipcRenderer.on('mc-mod-download-progress', (e, data) => callback(data)),
  onMcModpackProgress: (callback) => ipcRenderer.on('mc-modpack-progress', (e, data) => callback(data)),
  onMcLog: (callback) => ipcRenderer.on('mc-log', (e, log) => callback(log)),
  onMcClosed: (callback) => ipcRenderer.on('mc-closed', (e, data) => callback(data))
});
