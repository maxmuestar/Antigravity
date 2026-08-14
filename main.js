const { app, BrowserWindow, ipcMain, dialog, session, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { createExtractorFromFile } = require('node-unrar-js');

// Register app-file scheme to load covers and media safely
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-file', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
let pendingLaunchGameId = null;
let appRootDir, userDataDir, downloadsDir, gamesDir, coversDir, libraryPath, configPath, storageInfoPath;

// Store games that require user action to select the startup executable
const pendingGames = {};
const handledDownloadItems = new WeakSet();
const sessionsWithDownloadListener = new WeakSet();

function normalizePathForStorage(filePath) {
  return filePath.replace(/\\/g, '/');
}

function getGameById(gameId) {
  if (!fs.existsSync(libraryPath)) {
    return { error: 'Library file not found' };
  }

  const library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
  const game = library.find(g => g.id === gameId);
  if (!game) {
    return { error: 'Game not found in library' };
  }

  return { game };
}

function getGameStartupPath(game) {
  return path.isAbsolute(game.exePath)
    ? game.exePath
    : path.join(game.folderPath, game.exePath);
}

function sanitizeShortcutName(name) {
  return String(name || 'Game')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Game';
}

function getLaunchGameIdFromArgv(argv) {
  const launchArg = argv.find(arg => arg.startsWith('--launch-game='));
  if (!launchArg) return null;

  return launchArg.slice('--launch-game='.length).replace(/^"|"$/g, '');
}

function requestGameLaunchInRenderer(gameId) {
  if (!gameId) return;
  pendingLaunchGameId = gameId;

  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('launch-game-requested', pendingLaunchGameId);
      pendingLaunchGameId = null;
    });
    return;
  }

  mainWindow.webContents.send('launch-game-requested', pendingLaunchGameId);
  pendingLaunchGameId = null;
}

function isProcessRunning(processName) {
  if (process.platform !== 'win32') return false;

  try {
    const { execFileSync } = require('child_process');
    const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${processName}`, '/NH'], {
      encoding: 'utf-8',
      windowsHide: true
    });
    return output.toLowerCase().includes(processName.toLowerCase());
  } catch (error) {
    console.error(`Failed to check process ${processName}:`, error);
    return false;
  }
}

function getPortableAppRootDir() {
  return app.isPackaged ? path.dirname(process.execPath) : __dirname;
}

function copyDirectoryIfPresent(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;

  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
}

function copyFileIfMissing(sourcePath, targetPath) {
  if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function replacePathPrefix(value, oldPrefix, newPrefix) {
  if (!value || !oldPrefix || !newPrefix) return value;

  const normalizedValue = normalizePathForStorage(value);
  const normalizedOldPrefix = normalizePathForStorage(oldPrefix);
  const normalizedNewPrefix = normalizePathForStorage(newPrefix);

  if (normalizedValue === normalizedOldPrefix) {
    return normalizedNewPrefix;
  }

  if (normalizedValue.startsWith(`${normalizedOldPrefix}/`)) {
    return `${normalizedNewPrefix}${normalizedValue.slice(normalizedOldPrefix.length)}`;
  }

  return value;
}

function migrateLibraryPaths(oldPaths) {
  if (!fs.existsSync(libraryPath)) return;

  try {
    const library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    let changed = false;

    const migratedLibrary = library.map(game => {
      const migratedGame = { ...game };
      const migratedFolderPath = replacePathPrefix(migratedGame.folderPath, oldPaths.gamesDir, gamesDir);

      if (migratedFolderPath !== migratedGame.folderPath) {
        migratedGame.folderPath = migratedFolderPath;
        changed = true;
      }

      if (migratedGame.coverPath) {
        const coverPrefix = 'app-file://';
        const rawCoverPath = migratedGame.coverPath.startsWith(coverPrefix)
          ? migratedGame.coverPath.slice(coverPrefix.length)
          : migratedGame.coverPath;
        const migratedCoverPath = replacePathPrefix(rawCoverPath, oldPaths.coversDir, coversDir);
        const nextCoverPath = migratedGame.coverPath.startsWith(coverPrefix)
          ? `${coverPrefix}${migratedCoverPath}`
          : migratedCoverPath;

        if (nextCoverPath !== migratedGame.coverPath) {
          migratedGame.coverPath = nextCoverPath;
          changed = true;
        }
      }

      return migratedGame;
    });

    if (changed) {
      fs.writeFileSync(libraryPath, JSON.stringify(migratedLibrary, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Failed to migrate library paths:', err);
  }
}

function migrateOldUserDataIfNeeded(oldUserDataDir) {
  const oldPaths = {
    userDataDir: oldUserDataDir,
    downloadsDir: path.join(oldUserDataDir, 'downloads'),
    gamesDir: path.join(oldUserDataDir, 'games'),
    coversDir: path.join(oldUserDataDir, 'covers'),
    libraryPath: path.join(oldUserDataDir, 'library.json')
  };

  if (path.resolve(oldPaths.userDataDir) === path.resolve(userDataDir)) return;

  copyDirectoryIfPresent(oldPaths.downloadsDir, downloadsDir);
  copyDirectoryIfPresent(oldPaths.gamesDir, gamesDir);
  copyDirectoryIfPresent(oldPaths.coversDir, coversDir);
  copyFileIfMissing(oldPaths.libraryPath, libraryPath);
  migrateLibraryPaths(oldPaths);
}

function initConfigFile() {
  const previousConfigPaths = [
    path.join(appRootDir, 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(path.dirname(process.execPath), 'config.json')
  ];

  for (const previousConfigPath of previousConfigPaths) {
    if (path.resolve(previousConfigPath) !== path.resolve(configPath)) {
      copyFileIfMissing(previousConfigPath, configPath);
    }
  }

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ websites: [] }, null, 2), 'utf-8');
  }
}

function writeStorageInfo() {
  const storageInfo = {
    appRootDir: normalizePathForStorage(appRootDir),
    dataDir: normalizePathForStorage(userDataDir),
    downloadsDir: normalizePathForStorage(downloadsDir),
    gamesDir: normalizePathForStorage(gamesDir),
    coversDir: normalizePathForStorage(coversDir),
    libraryPath: normalizePathForStorage(libraryPath),
    configPath: normalizePathForStorage(configPath)
  };

  fs.writeFileSync(storageInfoPath, JSON.stringify(storageInfo, null, 2), 'utf-8');
}

// Initialize data paths AFTER app is ready so app.getPath('userData') is available for migration.
function initPaths() {
  const oldUserDataDir = app.getPath('userData');

  // Portable app data lives next to the app/exe instead of AppData.
  appRootDir = getPortableAppRootDir();
  userDataDir = path.join(appRootDir, 'data');
  downloadsDir = path.join(userDataDir, 'downloads');
  gamesDir = path.join(userDataDir, 'games');
  coversDir = path.join(userDataDir, 'covers');
  libraryPath = path.join(userDataDir, 'library.json');
  configPath = path.join(userDataDir, 'config.json');
  storageInfoPath = path.join(userDataDir, 'storage-info.json');

  // Create writable directories if needed
  [userDataDir, downloadsDir, gamesDir, coversDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  migrateOldUserDataIfNeeded(oldUserDataDir);
  initConfigFile();

  // Initialize library.json if it doesn't exist yet
  if (!fs.existsSync(libraryPath)) {
    fs.writeFileSync(libraryPath, '[]', 'utf-8');
  }

  recoverUnregisteredGames();
  writeStorageInfo();

  console.log('[STORAGE] App root:', appRootDir);
  console.log('[STORAGE] Data folder:', userDataDir);
}

function getFilesRecursively(dir, filesList = []) {
  if (!fs.existsSync(dir)) return filesList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        getFilesRecursively(filePath, filesList);
      } else {
        filesList.push(filePath);
      }
    } catch (e) {
      console.error(`Error scanning file/folder: ${filePath}`, e);
    }
  }
  return filesList;
}

function toGameRelativePath(gameFolder, filePath) {
  return path.relative(gameFolder, filePath).replace(/\\/g, '/');
}

function isIgnoredStartupCandidate(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  const baseName = path.basename(lowerPath);

  return (
    lowerPath.includes('_commonredist/') ||
    lowerPath.includes('redist/') ||
    lowerPath.includes('redistributable/') ||
    lowerPath.includes('directx/') ||
    lowerPath.includes('dotnet') ||
    lowerPath.includes('vcredist') ||
    lowerPath.includes('vc_redist') ||
    lowerPath.includes('physx') ||
    lowerPath.includes('openal') ||
    lowerPath.includes('oalinst') ||
    baseName.includes('setup') ||
    baseName.includes('install') ||
    baseName.includes('unins')
  );
}

function getStartupCandidateScore(relativePath, title) {
  const lowerPath = relativePath.toLowerCase();
  const baseName = path.basename(lowerPath, path.extname(lowerPath));
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedBase = baseName.replace(/[^a-z0-9]/g, '');
  let score = 0;

  if (normalizedBase && normalizedTitle && normalizedTitle.includes(normalizedBase)) score += 40;
  if (normalizedBase && normalizedTitle && normalizedBase.includes(normalizedTitle)) score += 40;
  if (!lowerPath.includes('/')) score += 10;
  if (lowerPath.includes('/bin/')) score += 5;
  if (lowerPath.includes('launcher')) score += 4;
  if (lowerPath.includes('shipping')) score += 3;
  if (isIgnoredStartupCandidate(relativePath)) score -= 100;

  return score;
}

function findStartupCandidates(allFiles, gameFolder, title, extensions) {
  return allFiles
    .filter(f => extensions.includes(path.extname(f).toLowerCase()))
    .map(f => toGameRelativePath(gameFolder, f))
    .sort((a, b) => getStartupCandidateScore(b, title) - getStartupCandidateScore(a, title));
}

function pickBestStartupCandidate(candidates, title) {
  const preferred = candidates.filter(candidate => !isIgnoredStartupCandidate(candidate));

  if (preferred.length === 1) {
    return preferred[0];
  }

  if (preferred.length > 1) {
    const [first, second] = preferred;
    const firstScore = getStartupCandidateScore(first, title);
    const secondScore = getStartupCandidateScore(second, title);

    if (firstScore > secondScore) {
      return first;
    }
  }

  return null;
}

function cleanGameSearchName(value) {
  return path.basename(value || '', path.extname(value || ''))
    .replace(/\b(steamrip|steam rip|fitgirl|dodi|repack|gog|portable|setup|launcher)\b/gi, ' ')
    .replace(/\b(x64|x86|win32|win64|windows)\b/gi, ' ')
    .replace(/\bv?\d+([._-]\d+)+\b/gi, ' ')
    .replace(/[_.,()[\]{}+-]+/g, ' ')
    .replace(/\s+\d+\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseGameName(value) {
  const lowercaseWords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

  return value
    .split(' ')
    .filter(Boolean)
    .map((word, index) => {
      if (/^(ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(word)) return word.toUpperCase();
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;

      const lower = word.toLowerCase();
      if (index > 0 && lowercaseWords.has(lower)) return lower;

      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function cleanGameDisplayName(value) {
  const originalBase = path.basename(value || '', path.extname(value || ''));
  let cleaned = originalBase
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[[^\]]*(steamrip|fitgirl|dodi|gog|elamigos|repack|crack|cracked|torrent|free download)[^\]]*\]/gi, ' ')
    .replace(/\([^)]*(steamrip|fitgirl|dodi|gog|elamigos|repack|crack|cracked|torrent|free download)[^)]*\)/gi, ' ')
    .replace(/\{[^}]*(steamrip|fitgirl|dodi|gog|elamigos|repack|crack|cracked|torrent|free download)[^}]*\}/gi, ' ')
    .replace(/\b(steamrip|steam rip|fitgirl|dodi|gog|elamigos|onlinefix|online fix|goldberg|rune|codex|plaza|skidrow|tenoke)\b/gi, ' ')
    .replace(/\b(repack|preinstalled|portable|setup|installer|launcher|crack|cracked|no install|torrent|free download|download)\b/gi, ' ')
    .replace(/\b(build|update|hotfix|patch)\s*[\w.-]+\b/gi, ' ')
    .replace(/\b(v|ver|version)\s*[\d]+([._-]\d+)*\b/gi, ' ')
    .replace(/\b\d+([._-]\d+){1,}\b/g, ' ')
    .replace(/\b(x64|x86|x32|win32|win64|windows|pc|multi\d*|multi|incl|dlc|bonus|ost)\b/gi, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/[-+]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[-:|]+\s*|\s*[-:|]+\s*$/g, '')
    .trim();

  cleaned = cleaned.replace(/\s+\b(20[0-3]\d|19[8-9]\d)\b\s*$/g, '').trim();
  return titleCaseGameName(cleaned || originalBase.replace(/[-_.]+/g, ' ').trim() || 'Game');
}

function normalizeGameName(value) {
  return cleanGameSearchName(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getCoverSearchTerms(title, exePath) {
  const terms = [
    cleanGameSearchName(exePath),
    cleanGameSearchName(title)
  ].filter(Boolean);

  return [...new Set(terms)];
}

async function fetchJson(url) {
  const response = await net.fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

function getSteamSearchScore(item, searchTerm) {
  const itemName = normalizeGameName(item.name || '');
  const queryName = normalizeGameName(searchTerm);

  if (!itemName || !queryName) return 0;
  if (itemName === queryName) return 100;
  if (itemName.includes(queryName) || queryName.includes(itemName)) return 80;

  const queryWords = cleanGameSearchName(searchTerm).toLowerCase().split(/\s+/).filter(Boolean);
  const matchedWords = queryWords.filter(word => itemName.includes(word.replace(/[^a-z0-9]/g, '')));

  return Math.round((matchedWords.length / Math.max(queryWords.length, 1)) * 60);
}

async function saveImageFromUrl(url, targetPath) {
  const response = await net.fetch(url);
  if (!response.ok) return false;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) return false;

  fs.writeFileSync(targetPath, buffer);
  return true;
}

async function findAndSaveCover(id, title, exePath) {
  const searchTerms = getCoverSearchTerms(title, exePath);

  for (const searchTerm of searchTerms) {
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchTerm)}&cc=us&l=en`;
      const data = await fetchJson(url);
      const items = Array.isArray(data.items) ? data.items : [];
      const bestMatch = items
        .map(item => ({ item, score: getSteamSearchScore(item, searchTerm) }))
        .filter(result => result.item.id && result.score >= 50)
        .sort((a, b) => b.score - a.score)[0];

      if (!bestMatch) continue;

      const appId = bestMatch.item.id;
      const targetPath = path.join(coversDir, `${id}.jpg`);
      const imageUrls = [
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        bestMatch.item.tiny_image
      ].filter(Boolean);

      for (const imageUrl of imageUrls) {
        if (await saveImageFromUrl(imageUrl, targetPath)) {
          return `app-file://${normalizePathForStorage(targetPath)}`;
        }
      }
    } catch (err) {
      console.error(`Cover lookup failed for "${searchTerm}":`, err.message);
    }
  }

  return '';
}

function readLibrary() {
  if (!fs.existsSync(libraryPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to read library.json:', err);
    return [];
  }
}

function writeLibrary(library) {
  fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
}

function cleanExistingLibraryTitles() {
  const library = readLibrary();
  let changed = false;

  const cleanedLibrary = library.map(game => {
    const nextTitle = cleanGameDisplayName(game.title);
    if (nextTitle && nextTitle !== game.title) {
      changed = true;
      return { ...game, title: nextTitle };
    }

    return game;
  });

  if (changed) {
    writeLibrary(cleanedLibrary);
  }
}

async function enrichMissingLibraryCovers() {
  const library = readLibrary();
  let changed = false;

  for (const game of library) {
    if (game.coverPath) continue;

    const coverPath = await findAndSaveCover(game.id, game.title, game.exePath);
    if (coverPath) {
      game.coverPath = coverPath;
      changed = true;
    }
  }

  if (changed) {
    writeLibrary(library);
    if (mainWindow) {
      mainWindow.webContents.send('library-updated');
    }
  }
}

function recoverUnregisteredGames() {
  if (!fs.existsSync(gamesDir)) return;

  const library = readLibrary();
  const registeredFolders = new Set(library.map(game => normalizePathForStorage(game.folderPath)));
  const gameFolders = fs.readdirSync(gamesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(gamesDir, entry.name));

  for (const gameFolder of gameFolders) {
    if (registeredFolders.has(normalizePathForStorage(gameFolder))) continue;

    const allFiles = getFilesRecursively(gameFolder);
    if (allFiles.length === 0) continue;

    const folderName = path.basename(gameFolder);
    const exeCandidates = findStartupCandidates(allFiles, gameFolder, folderName, ['.exe']);
    const scriptCandidates = findStartupCandidates(allFiles, gameFolder, folderName, ['.bat', '.cmd', '.lnk', '.jar']);
    const startupFile = pickBestStartupCandidate(exeCandidates, folderName) || pickBestStartupCandidate(scriptCandidates, folderName);

    if (!startupFile) continue;

    const title = cleanGameDisplayName(folderName);

    library.push({
      id: folderName,
      title,
      folderPath: normalizePathForStorage(gameFolder),
      exePath: normalizePathForStorage(startupFile),
      coverPath: ''
    });
  }

  writeLibrary(library);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: 'Game Launcher & Downloader',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      devTools: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingLaunchGameId) {
      mainWindow.webContents.send('launch-game-requested', pendingLaunchGameId);
      pendingLaunchGameId = null;
    }
  });
}

// Register protocol handler for local files (covers/assets)
function registerAppFileProtocol() {
  protocol.handle('app-file', (request) => {
    let filePath = request.url.slice('app-file://'.length);
    filePath = decodeURIComponent(filePath);
    // Format local absolute file path
    const fileUrl = `file:///${filePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
    return net.fetch(fileUrl);
  });
}

// Shared download handler - used by both defaultSession and webview session
function handleDownloadItem(item) {
  if (handledDownloadItems.has(item)) return;
  handledDownloadItems.add(item);

  const fileName = item.getFilename();
  const savePath = path.join(downloadsDir, fileName);

  console.log('[DOWNLOAD] Saving to:', savePath);

  // Set the save path to our local downloads directory
  item.setSavePath(savePath);

  const downloadId = item.getStartTime();
  mainWindow.webContents.send('download-progress', {
    id: downloadId,
    name: fileName,
    percent: '0.0',
    speed: '0.00',
    eta: 0,
    received: '0.0',
    total: '0.0',
    status: 'progressing'
  });

  item.on('updated', (event, state) => {
    if (state === 'progressing') {
      const receivedBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();
      const elapsed = (Date.now() - downloadId * 1000) / 1000;

      const speed = elapsed > 0 ? receivedBytes / elapsed : 0;
      const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;
      const eta = speed > 0 && totalBytes > 0 ? (totalBytes - receivedBytes) / speed : 0;

      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        name: fileName,
        percent: percent.toFixed(1),
        speed: (speed / (1024 * 1024)).toFixed(2), // MB/s
        eta: Math.round(eta),
        received: (receivedBytes / (1024 * 1024)).toFixed(1),
        total: (totalBytes / (1024 * 1024)).toFixed(1),
        status: 'progressing'
      });
    }
  });

  item.once('done', async (event, state) => {
    if (state === 'completed') {
      console.log('[DOWNLOAD] Completed:', fileName, '-> processing...');
      const ext = path.extname(fileName).toLowerCase();
      const processingStatus = ext === '.zip' || ext === '.rar' ? 'extracting' : 'processing';

      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        name: fileName,
        percent: '100.0',
        speed: '0.00',
        eta: 0,
        received: (item.getReceivedBytes() / (1024 * 1024)).toFixed(1),
        total: (item.getTotalBytes() / (1024 * 1024)).toFixed(1),
        status: processingStatus
      });

      await processDownloadedFile(savePath, fileName, downloadId);

      mainWindow.webContents.send('download-completed', {
        id: downloadId,
        name: fileName,
        filePath: savePath
      });
    } else {
      console.log('[DOWNLOAD] Failed:', fileName, state);
      mainWindow.webContents.send('download-failed', {
        id: downloadId,
        name: fileName,
        error: state
      });
    }
  });
}

// Download interception - fallback for default session (non-webview downloads)
function setupDownloadListener() {
  session.defaultSession.on('will-download', (event, item) => {
    console.log('[DOWNLOAD] defaultSession will-download:', item.getFilename());
    handleDownloadItem(item);
  });
}

// Extraction, scanning, and auto-registration logic
async function processDownloadedFile(filePath, fileName, downloadId) {
  try {
    const ext = path.extname(fileName).toLowerCase();
    const gameId = Date.now().toString();
    const cleanName = cleanGameDisplayName(fileName);
      
    const gameFolder = path.join(gamesDir, gameId);
    
    if (!fs.existsSync(gameFolder)) {
      fs.mkdirSync(gameFolder, { recursive: true });
    }

    if (ext === '.zip' || ext === '.rar') {
      // Extract archive (ZIP or RAR)
      try {
        if (ext === '.zip') {
          const zip = new AdmZip(filePath);
          zip.extractAllTo(gameFolder, true);
        } else {
          // RAR extraction using node-unrar-js
          const extractor = await createExtractorFromFile({
            filepath: filePath,
            targetPath: gameFolder
          });
          const { files } = extractor.extract();
          // Consume the generator to trigger extraction
          [...files];
        }
      } catch (err) {
        console.error(`Error extracting ${ext}:`, err);
        mainWindow.webContents.send('extraction-failed', { title: cleanName, error: err.message });
        return;
      }
      
      // Clean up archive file to save space
      try { fs.unlinkSync(filePath); } catch (e) {}

      // Scan extracted directory for files
      const allFiles = getFilesRecursively(gameFolder);
      const exeFiles = findStartupCandidates(allFiles, gameFolder, cleanName, ['.exe']);
      const bestExe = pickBestStartupCandidate(exeFiles, cleanName);

      if (bestExe) {
        // Register automatically when one clear startup executable is found.
        await registerGame(gameId, cleanName, gameFolder, bestExe);
      } else if (exeFiles.length === 1) {
        await registerGame(gameId, cleanName, gameFolder, exeFiles[0]);
      } else if (exeFiles.length > 1) {
        // Multiple executables - ask user
        pendingGames[gameId] = {
          id: gameId,
          title: cleanName,
          folderPath: gameFolder
        };
        mainWindow.webContents.send('prompt-executables', {
          id: gameId,
          title: cleanName,
          options: exeFiles
        });
      } else {
        // No executables - search for bat, cmd, lnk scripts
        const scriptFiles = findStartupCandidates(allFiles, gameFolder, cleanName, ['.bat', '.cmd', '.lnk', '.jar']);
        const bestScript = pickBestStartupCandidate(scriptFiles, cleanName);

        if (bestScript) {
          await registerGame(gameId, cleanName, gameFolder, bestScript);
        } else if (scriptFiles.length === 1) {
          await registerGame(gameId, cleanName, gameFolder, scriptFiles[0]);
        } else {
          // Ask user to pick what to run
          const relativeAllFiles = allFiles.map(f => path.relative(gameFolder, f).replace(/\\/g, '/'));
          pendingGames[gameId] = {
            id: gameId,
            title: cleanName,
            folderPath: gameFolder
          };
          mainWindow.webContents.send('prompt-no-executable', {
            id: gameId,
            title: cleanName,
            options: relativeAllFiles.length > 0 ? relativeAllFiles : ['(No files extracted)']
          });
        }
      }
    } else {
      // Standalone file downloaded (e.g. standalone .exe)
      const destPath = path.join(gameFolder, fileName);
      fs.copyFileSync(filePath, destPath);
      
      // Clean up temporary download file
      try { fs.unlinkSync(filePath); } catch (e) {}
      
      await registerGame(gameId, cleanName, gameFolder, fileName);
    }
  } catch (err) {
    console.error('Error post-processing download:', err);
  }
}

// Add game metadata to library.json
async function registerGame(id, title, folderPath, exePath) {
  let library = [];
  const displayTitle = cleanGameDisplayName(title);

  if (fs.existsSync(libraryPath)) {
    try {
      library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to read library.json:', e);
      library = [];
    }
  }

  const coverPath = await findAndSaveCover(id, displayTitle, exePath);
  const newGame = {
    id: id,
    title: displayTitle,
    folderPath: folderPath.replace(/\\/g, '/'),
    exePath: exePath.replace(/\\/g, '/'),
    coverPath
  };

  library.push(newGame);

  try {
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
    console.log('Game registered to library:', newGame.title, '| Library path:', libraryPath);
  } catch (err) {
    console.error('FAILED to write library.json:', err);
  }

  // Notify UI
  if (mainWindow) {
    mainWindow.webContents.send('game-added', newGame);
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  pendingLaunchGameId = getLaunchGameIdFromArgv(process.argv);

  app.on('second-instance', (event, argv) => {
    requestGameLaunchInRenderer(getLaunchGameIdFromArgv(argv));
  });
}

if (singleInstanceLock) {
  // App Initialization
  app.whenReady().then(() => {
    initPaths(); // Must be first: sets up all writable paths
    Menu.setApplicationMenu(null);
    registerAppFileProtocol();
    createWindow();
    setupDownloadListener();
    cleanExistingLibraryTitles();
    enrichMissingLibraryCovers();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// Intercept guest webview target="_blank" AND hook into webview downloads
app.on('web-contents-created', (event, contents) => {
  contents.on('before-input-event', (inputEvent, input) => {
    const key = input.key ? input.key.toLowerCase() : '';
    const opensDevTools = key === 'f12' || (input.control && input.shift && key === 'i');

    if (opensDevTools) {
      inputEvent.preventDefault();
    }
  });

  if (contents.getType() === 'webview') {
    // Redirect new window / target=_blank to same webview
    contents.setWindowOpenHandler((details) => {
      const referrer = details.referrer && details.referrer.url
        ? details.referrer.url
        : contents.getURL();

      contents.loadURL(details.url, {
        httpReferrer: referrer
      });
      return { action: 'deny' };
    });

    // ⬇️ KEY FIX: intercept downloads originating from the webview's own session
    if (!sessionsWithDownloadListener.has(contents.session)) {
      sessionsWithDownloadListener.add(contents.session);
      contents.session.on('will-download', (event, item) => {
        console.log('[DOWNLOAD] will-download triggered for:', item.getFilename());
        handleDownloadItem(item);
      });
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler Registrations
ipcMain.handle('get-websites', () => {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      console.error(err);
    }
  }
  return { websites: [] };
});

ipcMain.handle('save-websites', (event, websites) => {
  try {
    fs.writeFileSync(configPath, JSON.stringify({ websites }, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-library', () => {
  if (fs.existsSync(libraryPath)) {
    try {
      return JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    } catch (err) {
      console.error(err);
    }
  }
  return [];
});

ipcMain.handle('save-library', (event, games) => {
  try {
    fs.writeFileSync(libraryPath, JSON.stringify(games, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error(err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-storage-info', () => ({
  appRootDir: normalizePathForStorage(appRootDir),
  dataDir: normalizePathForStorage(userDataDir),
  downloadsDir: normalizePathForStorage(downloadsDir),
  gamesDir: normalizePathForStorage(gamesDir),
  coversDir: normalizePathForStorage(coversDir),
  libraryPath: normalizePathForStorage(libraryPath),
  configPath: normalizePathForStorage(configPath)
}));

ipcMain.handle('get-game-launch-status', (event, gameId) => {
  try {
    const { game, error } = getGameById(gameId);
    if (error) return { success: false, error };

    const fullExePath = getGameStartupPath(game);
    if (!fs.existsSync(fullExePath)) {
      return { success: false, error: `Startup file not found: ${fullExePath}` };
    }

    return {
      success: true,
      gameTitle: game.title,
      steamRunning: isProcessRunning('steam.exe')
    };
  } catch (err) {
    console.error('Failed to get launch status:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-steam', async () => {
  try {
    await shell.openExternal('steam://open/main');
    return { success: true };
  } catch (err) {
    console.error('Failed to open Steam:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-windows-security', async () => {
  try {
    await shell.openExternal('windowsdefender:');
    return { success: true };
  } catch (err) {
    console.error('Failed to open Windows Security:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('set-window-fullscreen', (event, fullscreen) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) return { success: false, error: 'Window not found' };

  targetWindow.setFullScreen(Boolean(fullscreen));
  return { success: true };
});

ipcMain.handle('is-window-fullscreen', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  return Boolean(targetWindow && targetWindow.isFullScreen());
});

ipcMain.handle('open-game-folder', async (event, gameId) => {
  try {
    const { game, error } = getGameById(gameId);
    if (error) return { success: false, error };
    if (!fs.existsSync(game.folderPath)) {
      return { success: false, error: `Folder not found: ${game.folderPath}` };
    }

    const result = await shell.openPath(game.folderPath);
    return result ? { success: false, error: result } : { success: true };
  } catch (err) {
    console.error('Failed to open game folder:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-storage-folder', async (event, folderName) => {
  const folders = {
    downloads: downloadsDir,
    games: gamesDir,
    covers: coversDir,
    data: userDataDir
  };
  const targetFolder = folders[folderName];

  if (!targetFolder) {
    return { success: false, error: 'Unknown folder' };
  }

  try {
    fs.mkdirSync(targetFolder, { recursive: true });
    const result = await shell.openPath(targetFolder);
    return result ? { success: false, error: result } : { success: true };
  } catch (err) {
    console.error('Failed to open storage folder:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('create-game-shortcut', (event, gameId) => {
  try {
    const { game, error } = getGameById(gameId);
    if (error) return { success: false, error };

    const fullExePath = getGameStartupPath(game);
    if (!fs.existsSync(fullExePath)) {
      return { success: false, error: `Startup file not found: ${fullExePath}` };
    }

    const shortcutPath = path.join(app.getPath('desktop'), `${sanitizeShortcutName(game.title)}.lnk`);
    const escapedGameId = String(game.id).replace(/"/g, '\\"');
    const launcherTarget = process.execPath;
    const launcherArgs = app.isPackaged
      ? `--launch-game="${escapedGameId}"`
      : `"${app.getAppPath()}" --launch-game="${escapedGameId}"`;
    const created = shell.writeShortcutLink(shortcutPath, 'create', {
      target: launcherTarget,
      args: launcherArgs,
      cwd: app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
      icon: fullExePath,
      iconIndex: 0,
      description: `Launch ${game.title}`
    });

    return created
      ? { success: true, path: normalizePathForStorage(shortcutPath) }
      : { success: false, error: 'Windows could not create the shortcut' };
  } catch (err) {
    console.error('Failed to create game shortcut:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('run-game', (event, gameId) => {
  if (!fs.existsSync(libraryPath)) return { success: false, error: 'Library file not found' };

  try {
    const { game, error } = getGameById(gameId);
    if (error) return { success: false, error };

    const fullExePath = getGameStartupPath(game);
    if (!fs.existsSync(fullExePath)) {
      return { success: false, error: `Startup file not found: ${fullExePath}` };
    }

    const workingDirectory = path.dirname(fullExePath);

    // Spawn game detached
    const child = spawn(fullExePath, [], {
      cwd: workingDirectory,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    return { success: true };
  } catch (err) {
    console.error('Error starting game:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-game', (event, gameId, deleteFiles) => {
  if (!fs.existsSync(libraryPath)) return { success: false };

  try {
    let library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    const index = library.findIndex(g => g.id === gameId);
    if (index === -1) return { success: false, error: 'Game not found' };

    const game = library[index];

    if (deleteFiles && fs.existsSync(game.folderPath)) {
      try {
        fs.rmSync(game.folderPath, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to delete folder: ${game.folderPath}`, err);
      }
    }

    // Remove custom cover image
    if (game.coverPath) {
      const decodedCoverPath = game.coverPath.replace('app-file://', '');
      if (fs.existsSync(decodedCoverPath)) {
        try { fs.unlinkSync(decodedCoverPath); } catch (e) {}
      }
    }

    library.splice(index, 1);
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error('Failed to delete game:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-cover-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Cover Image',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath);
  const targetName = `${Date.now()}${ext}`;
  const destPath = path.join(coversDir, targetName);
  
  try {
    fs.copyFileSync(srcPath, destPath);
    // Return custom protocol URL
    return `app-file://${destPath.replace(/\\/g, '/')}`;
  } catch (err) {
    console.error('Failed to copy cover image:', err);
    return null;
  }
});

ipcMain.handle('select-manual-exe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Startup File',
    properties: ['openFile'],
    filters: [
      { name: 'Executables & Scripts', extensions: ['exe', 'bat', 'cmd', 'lnk', 'jar'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  
  return result.filePaths[0].replace(/\\/g, '/');
});

ipcMain.handle('resolve-executable-selection', async (event, payload, legacySelectedExe) => {
  const gameId = typeof payload === 'object' && payload !== null ? payload.gameId : payload;
  const selectedExe = typeof payload === 'object' && payload !== null ? payload.selectedExe : legacySelectedExe;
  const pending = pendingGames[gameId];
  if (pending && selectedExe) {
    let normalizedExe = selectedExe.replace(/\\/g, '/');
    if (path.isAbsolute(normalizedExe)) {
      const relativeExe = path.relative(pending.folderPath, normalizedExe).replace(/\\/g, '/');
      if (!relativeExe.startsWith('..') && !path.isAbsolute(relativeExe)) {
        normalizedExe = relativeExe;
      }
    }
    await registerGame(pending.id, pending.title, pending.folderPath, normalizedExe);
    delete pendingGames[gameId];
    return { success: true };
  }
  return { success: false, error: 'No pending game registration found' };
});

ipcMain.on('close-app', () => {
  app.quit();
});
