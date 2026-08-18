const { app, BrowserWindow, ipcMain, dialog, session, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { createExtractorFromFile } = require('node-unrar-js');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const MinecraftService = require('./minecraft-service');

let minecraftService = null;

const GITHUB_REPO_OWNER = 'maxmuestar';
const GITHUB_REPO_NAME = 'Antigravity';

function parseSemVer(ver) {
  if (!ver) return [0, 0, 0];
  const cleaned = String(ver).replace(/^v/i, '').trim();
  const parts = cleaned.split('.').map(p => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isNewerVersion(currentVer, latestVer) {
  const [cMaj, cMin, cPatch] = parseSemVer(currentVer);
  const [lMaj, lMin, lPatch] = parseSemVer(latestVer);
  if (lMaj > cMaj) return true;
  if (lMaj < cMaj) return false;
  if (lMin > cMin) return true;
  if (lMin < cMin) return false;
  return lPatch > cPatch;
}

async function fetchLatestGitHubRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      headers: {
        'User-Agent': 'AntiGravity-Launcher'
      },
      timeout: 8000
    };

    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(new Error('Failed to parse GitHub response'));
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else {
          reject(new Error(`GitHub API returned status ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub request timed out'));
    });
  });
}

async function checkAppUpdates(manual = false) {
  try {
    const release = await fetchLatestGitHubRelease();
    const currentVer = app.getVersion();

    if (!release || !release.tag_name) {
      return { success: true, updateAvailable: false, manual, currentVersion: currentVer };
    }

    const latestVer = release.tag_name;
    const hasUpdate = isNewerVersion(currentVer, latestVer);

    let assetDownloadUrl = release.html_url;
    let assetName = 'Update Package';
    let assetSize = '';

    if (Array.isArray(release.assets) && release.assets.length > 0) {
      const zipAsset = release.assets.find(a => a.name.endsWith('.zip') || a.name.endsWith('.exe')) || release.assets[0];
      if (zipAsset) {
        assetDownloadUrl = zipAsset.browser_download_url;
        assetName = zipAsset.name;
        assetSize = (zipAsset.size / (1024 * 1024)).toFixed(1) + ' MB';
      }
    }

    const payload = {
      success: true,
      updateAvailable: hasUpdate,
      currentVersion: currentVer,
      latestVersion: latestVer,
      releaseName: release.name || latestVer,
      releaseNotes: release.body || 'Performance improvements and bug fixes.',
      publishedAt: release.published_at,
      releaseUrl: release.html_url,
      assetDownloadUrl,
      assetName,
      assetSize,
      manual
    };

    return payload;
  } catch (err) {
    console.warn('[UPDATE CHECK] Error:', err.message);
    return { success: false, error: err.message, manual, currentVersion: app.getVersion() };
  }
}

let pendingUpdateState = null;

function downloadFileWithRedirects(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    function makeRequest(currentUrl, redirectCount = 0) {
      if (redirectCount > 10) {
        return reject(new Error('Too many redirects'));
      }

      const { URL } = require('url');
      const http = require('http');
      const parsed = new URL(currentUrl);
      const protocol = parsed.protocol === 'https:' ? https : http;

      const req = protocol.get(currentUrl, {
        headers: {
          'User-Agent': 'AntiGravity-Launcher'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, currentUrl).href;
          return makeRequest(redirectUrl, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        let lastTime = Date.now();
        let lastBytes = 0;

        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          const now = Date.now();
          if (now - lastTime >= 350) {
            const speed = (receivedBytes - lastBytes) / ((now - lastTime) / 1000);
            const percent = totalBytes > 0 ? ((receivedBytes / totalBytes) * 100).toFixed(1) : '0.0';
            if (onProgress) {
              onProgress({
                received: (receivedBytes / (1024 * 1024)).toFixed(1),
                total: (totalBytes / (1024 * 1024)).toFixed(1),
                percent,
                speed: (speed / (1024 * 1024)).toFixed(2)
              });
            }
            lastTime = now;
            lastBytes = receivedBytes;
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
    }

    makeRequest(fileUrl);
  });
}

async function startAppUpdateDownload(downloadUrl) {
  try {
    const tempDir = path.join(userDataDir, '_update_temp');
    if (fs.existsSync(tempDir)) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
    fs.mkdirSync(tempDir, { recursive: true });

    const updateZipPath = path.join(tempDir, 'update.zip');
    const extractDir = path.join(tempDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    console.log('[AUTO-UPDATER] Downloading update from:', downloadUrl);
    mainWindow?.webContents.send('update-download-progress', {
      status: 'downloading',
      percent: '0.0',
      speed: '0.00',
      received: '0.0',
      total: '0.0'
    });

    await downloadFileWithRedirects(downloadUrl, updateZipPath, (p) => {
      mainWindow?.webContents.send('update-download-progress', {
        status: 'downloading',
        percent: p.percent,
        speed: p.speed,
        received: p.received,
        total: p.total
      });
    });

    console.log('[AUTO-UPDATER] Download finished. Extracting...');
    mainWindow?.webContents.send('update-download-progress', {
      status: 'extracting',
      percent: '100.0',
      speed: '0.00',
      received: '',
      total: ''
    });

    // Extract update package
    await extractArchive(updateZipPath, extractDir, '.zip', '');

    // Locate extracted root folder (may be extractDir directly or a subfolder like GameLauncher-win32-x64)
    let srcFolder = extractDir;
    const contents = fs.readdirSync(extractDir);
    if (contents.length === 1 && fs.statSync(path.join(extractDir, contents[0])).isDirectory()) {
      srcFolder = path.join(extractDir, contents[0]);
    }

    // Safety: ensure extracted source doesn't have a data dir that could overwrite user data
    const srcDataDir = path.join(srcFolder, 'data');
    if (fs.existsSync(srcDataDir)) {
      try { fs.rmSync(srcDataDir, { recursive: true, force: true }); } catch (e) {}
    }

    // Generate PowerShell update script with robust process cleanup and robocopy
    const psScriptPath = path.join(tempDir, 'apply_update.ps1');
    const vbsScriptPath = path.join(tempDir, 'run_update.vbs');
    const logPath = path.join(userDataDir, 'updater_log.txt');
    const exePath = app.isPackaged 
      ? process.execPath 
      : path.join(appRootDir, 'dist', 'GameLauncher-win32-x64', 'GameLauncher.exe');

    const srcDataDirFormatted = path.join(srcFolder, 'data').replace(/\\/g, '\\\\');
    const dstDataDirFormatted = path.join(appRootDir, 'data').replace(/\\/g, '\\\\');

    const psContent = `
try {
    Start-Transcript -Path "${logPath.replace(/\\/g, '\\\\')}" -Force
} catch {}

Write-Host "Update process started. Waiting for all GameLauncher processes to terminate..."

# Terminate and wait for any lingering Electron processes to release file locks
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
    $procs = Get-Process -Name "GameLauncher", "electron" -ErrorAction SilentlyContinue
    if (-not $procs) { break }
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 250
}

Start-Sleep -Milliseconds 750

Write-Host "Copying updated files from '${srcFolder.replace(/\\/g, '\\\\')}' to '${appRootDir.replace(/\\/g, '\\\\')}' (excluding data/)..."
$src = "${srcFolder.replace(/\\/g, '\\\\')}"
$dst = "${appRootDir.replace(/\\/g, '\\\\')}"
$srcData = "${srcDataDirFormatted}"
$dstData = "${dstDataDirFormatted}"

if (Test-Path -LiteralPath $src) {
    # Use robocopy with automatic retries for locked files
    robocopy "$src" "$dst" /E /XD "$srcData" "$dstData" /R:5 /W:1 > $null
    Write-Host "Files updated successfully!"
} else {
    Write-Host "Source directory not found: $src"
}

# Clean up temp folder
$tmp = "${tempDir.replace(/\\/g, '\\\\')}"
if (Test-Path -LiteralPath $tmp) {
    try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

# Restart the updated application
$exe = "${exePath.replace(/\\/g, '\\\\')}"
if (Test-Path -LiteralPath $exe) {
    Write-Host "Restarting application: $exe"
    Start-Process -FilePath $exe
} else {
    Write-Host "Executable not found at: $exe"
}

try {
    Stop-Transcript
} catch {}
`;

    fs.writeFileSync(psScriptPath, psContent, 'utf-8');

    // Create silent VBS wrapper so Windows launches PowerShell completely independent of the Node/Electron process tree
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & "${psScriptPath.replace(/\\/g, '\\\\')}" & """", 0, False
`;
    fs.writeFileSync(vbsScriptPath, vbsContent, 'utf-8');

    pendingUpdateState = {
      vbsScriptPath
    };

    console.log('[AUTO-UPDATER] Update prepared and ready to apply!');
    mainWindow?.webContents.send('update-download-progress', {
      status: 'ready_to_install'
    });

    return { success: true };
  } catch (err) {
    console.error('[AUTO-UPDATER] Update failed:', err);
    mainWindow?.webContents.send('update-download-progress', {
      status: 'error',
      error: err.message
    });
    return { success: false, error: err.message };
  }
}

function applyAppUpdateAndRestart() {
  if (!pendingUpdateState || !pendingUpdateState.vbsScriptPath) {
    return { success: false, error: 'No update ready to install' };
  }

  const { vbsScriptPath } = pendingUpdateState;

  console.log('[AUTO-UPDATER] Spawning independent updater via wscript and quitting app...');
  try {
    const { spawnSync } = require('child_process');
    spawnSync('wscript.exe', [vbsScriptPath], { stdio: 'ignore' });

    setTimeout(() => {
      app.exit(0);
    }, 200);

    return { success: true };
  } catch (err) {
    console.error('[AUTO-UPDATER] Failed to spawn updater:', err);
    return { success: false, error: err.message };
  }
}

// Register app-file scheme to load covers and media safely
protocol.registerSchemesAsPrivileged([
  { scheme: 'app-file', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow;
let pendingLaunchGameId = null;
let appRootDir, userDataDir, downloadsDir, gamesDir, coversDir, libraryPath, configPath, storageInfoPath;

// Store games that require user action to select the startup executable
const pendingGames = {};
const pendingExtractions = {};
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

  minecraftService = new MinecraftService(userDataDir);

  console.log('[STORAGE] App root:', appRootDir);
  console.log('[STORAGE] Data folder:', userDataDir);
  console.log('[MINECRAFT] Folder:', minecraftService.mcDir);
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
    lowerPath.includes('/jre/') ||
    lowerPath.includes('/jdk/') ||
    lowerPath.includes('/runtime/') ||
    lowerPath.includes('/nodeeditor/') ||
    lowerPath.includes('nodeeditor') ||
    lowerPath.includes('server') ||
    lowerPath.includes('crashhandler') ||
    lowerPath.includes('crashreport') ||
    lowerPath.includes('unitycrash') ||
    lowerPath.includes('unrealcef') ||
    lowerPath.includes('epicweb') ||
    lowerPath.includes('anticheat') ||
    lowerPath.includes('battleye') ||
    baseName === 'java.exe' ||
    baseName === 'javaw.exe' ||
    baseName === 'jabswitch.exe' ||
    baseName === 'keytool.exe' ||
    baseName === 'jfr.exe' ||
    baseName === 'kinit.exe' ||
    baseName === 'klist.exe' ||
    baseName === 'ktab.exe' ||
    baseName === 'rmiregistry.exe' ||
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
  if (!lowerPath.includes('/')) score += 15;
  if (lowerPath.split('/').length <= 2) score += 8;
  if (lowerPath.includes('/bin/')) score += 5;
  if (lowerPath.includes('launcher')) score += 10;
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

    if (firstScore >= secondScore) {
      return first;
    }
  }

  return preferred[0] || null;
}

function cleanGameSearchName(value) {
  return path.basename(value || '', path.extname(value || ''))
    .replace(/\b(steamrip|steam rip|fitgirl|dodi|repack|gog|portable|setup|launcher|multiplayer|singleplayer|online|coop|co-op|lan|edition|remastered|remake|build)\b/gi, ' ')
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

function findLocalCoverInFolder(gameFolder) {
  if (!gameFolder || !fs.existsSync(gameFolder)) return null;
  try {
    const files = fs.readdirSync(gameFolder);
    const candidateNames = ['cover', 'poster', 'banner', 'folder', 'icon', 'logo', 'background', 'art', 'boxart', 'steam_header'];
    
    // Check root directory for name matches
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        const base = path.basename(file, ext).toLowerCase();
        if (candidateNames.some(c => base.includes(c))) {
          return path.join(gameFolder, file);
        }
      }
    }

    // Check for any image file > 15KB in the root folder
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        const full = path.join(gameFolder, file);
        try {
          const stats = fs.statSync(full);
          if (stats.size > 15000) return full;
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('Error searching local cover:', e);
  }
  return null;
}

async function findAndSaveCover(id, title, exePath, gameFolder = '') {
  // Strategy 1: Check local game directory for cover/art files
  const localCover = findLocalCoverInFolder(gameFolder);
  if (localCover) {
    try {
      const ext = path.extname(localCover);
      const targetPath = path.join(coversDir, `${id}${ext}`);
      fs.copyFileSync(localCover, targetPath);
      console.log(`[COVER] Found local cover for "${title}": ${localCover}`);
      return `app-file://${normalizePathForStorage(targetPath)}`;
    } catch (e) {
      console.error('Failed to copy local cover:', e);
    }
  }

  // Strategy 2: Search Steam with multiple keyword variations
  const searchTerms = [
    cleanGameDisplayName(title),
    cleanGameSearchName(title),
    cleanGameSearchName(exePath),
    title
  ].filter(Boolean);
  const uniqueTerms = [...new Set(searchTerms)];

  for (const searchTerm of uniqueTerms) {
    try {
      // 2a. Steam Store Search
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchTerm)}&cc=us&l=en`;
      const data = await fetchJson(url);
      const items = Array.isArray(data.items) ? data.items : [];
      let bestMatch = items
        .map(item => ({ item, score: getSteamSearchScore(item, searchTerm) }))
        .filter(result => result.item.id && result.score >= 40)
        .sort((a, b) => b.score - a.score)[0];

      let appId = bestMatch ? bestMatch.item.id : null;

      // 2b. If storesearch returned no high-confidence result, try Steam Community Search
      if (!appId) {
        try {
          const commUrl = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(searchTerm)}`;
          const commData = await fetchJson(commUrl);
          if (Array.isArray(commData) && commData.length > 0 && commData[0].appid) {
            appId = commData[0].appid;
          }
        } catch (e) {}
      }

      if (!appId) continue;

      const targetPath = path.join(coversDir, `${id}.jpg`);
      const imageUrls = [
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
        bestMatch?.item?.tiny_image
      ].filter(Boolean);

      for (const imageUrl of imageUrls) {
        if (await saveImageFromUrl(imageUrl, targetPath)) {
          console.log(`[COVER] Downloaded cover for "${title}" (AppId: ${appId})`);
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

    const coverPath = await findAndSaveCover(game.id, game.title, game.exePath, game.folderPath);
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

  let changed = false;

  for (const gameFolder of gameFolders) {
    if (registeredFolders.has(normalizePathForStorage(gameFolder))) continue;

    const allFiles = getFilesRecursively(gameFolder);
    if (allFiles.length === 0) continue;

    const folderName = path.basename(gameFolder);
    
    // Look for top subfolder or main folder name to get a human-readable title
    let inferredTitle = '';
    try {
      const topSubdirs = fs.readdirSync(gameFolder, { withFileTypes: true }).filter(d => d.isDirectory());
      if (topSubdirs.length >= 1 && !/^\d+$/.test(topSubdirs[0].name)) {
        inferredTitle = topSubdirs[0].name;
      }
    } catch (e) {}

    const exeCandidates = findStartupCandidates(allFiles, gameFolder, inferredTitle || folderName, ['.exe', '.bat', '.cmd']);
    const startupFile = pickBestStartupCandidate(exeCandidates, inferredTitle || folderName);

    if (!startupFile) continue;

    const rawTitle = inferredTitle || path.basename(startupFile, path.extname(startupFile)) || folderName;
    const title = cleanGameDisplayName(rawTitle);

    library.push({
      id: folderName,
      title,
      folderPath: normalizePathForStorage(gameFolder),
      exePath: normalizePathForStorage(startupFile),
      coverPath: ''
    });
    changed = true;
    console.log(`[RECOVERY] Recovered unregistered game: "${title}" (${startupFile})`);
  }

  if (changed) {
    writeLibrary(library);
  }
}

let adblockExtensionId = null;
let adblockWindow = null;

async function loadAdblockExtension() {
  // Use __dirname so the zip is found inside resources/app/ in packaged builds
  const zipPath = path.join(__dirname, 'cfhdojbkjhnklbpkdaibdccddilifddb.zip');
  const extensionsDir = path.join(userDataDir, 'extensions');
  const extensionUnpackedPath = path.join(extensionsDir, 'cfhdojbkjhnklbpkdaibdccddilifddb', '4.43.1_0');
  const manifestPath = path.join(extensionUnpackedPath, 'manifest.json');

  console.log('[EXTENSION] Checking for Adblock Plus at:', manifestPath);

  try {
    if (!fs.existsSync(manifestPath)) {
      if (!fs.existsSync(zipPath)) {
        console.warn('[EXTENSION] Extension zip not found at:', zipPath);
        return;
      }
      console.log('[EXTENSION] Extracting Adblock Plus zip...');
      fs.mkdirSync(extensionsDir, { recursive: true });
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extensionsDir, true);
      console.log('[EXTENSION] Extraction complete.');
    }

    if (fs.existsSync(manifestPath)) {
      // Patch minimum_chrome_version to be compatible with this Electron's Chromium
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (manifest.minimum_chrome_version) {
          console.log('[EXTENSION] Patching minimum_chrome_version from', manifest.minimum_chrome_version);
          manifest.minimum_chrome_version = '100.0';
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
        }
      } catch (patchErr) {
        console.error('[EXTENSION] Failed to patch manifest:', patchErr);
      }

      const ext = await session.defaultSession.loadExtension(extensionUnpackedPath, { allowFileAccess: true });
      adblockExtensionId = ext.id;
      console.log('[EXTENSION] Successfully loaded extension:', ext.name, 'ID:', ext.id);
    } else {
      console.error('[EXTENSION] Manifest file missing even after extraction attempt.');
    }
  } catch (err) {
    console.error('[EXTENSION] Failed to load Adblock Plus extension:', err);
  }
}

let blockerInstance = null;
let adblockGlobalEnabled = true;
const whitelistedDomains = new Set();
let blockedRequestsCount = 0;
let blockedTrackersCount = 0;
const adblockActiveSessions = new Set();

async function enableAdblocking(sessionInstance) {
  try {
    // Polyfill registerPreloadScript if it's missing (e.g. Electron < 32)
    if (sessionInstance && !sessionInstance.registerPreloadScript) {
      console.log('[ADBLOCK] Polyfilling registerPreloadScript on session');
      sessionInstance.registerPreloadScript = function (preloadPath) {
        try {
          const actualPath = (preloadPath && typeof preloadPath === 'object') ? preloadPath.filePath : preloadPath;
          if (!actualPath || typeof actualPath !== 'string') {
            console.warn('[ADBLOCK] Invalid preloadPath:', preloadPath);
            return;
          }
          const preloads = this.getPreloads() || [];
          if (!preloads.includes(actualPath)) {
            this.setPreloads([...preloads, actualPath]);
          }
        } catch (err) {
          console.error('[ADBLOCK] Failed to set preloads:', err);
        }
      };
    }

    const cachePath = path.join(userDataDir, 'adblocker.bin');

    if (!blockerInstance) {
      if (fs.existsSync(cachePath)) {
        console.log('[ADBLOCK] Loading native adblocker from cache...');
        const buffer = fs.readFileSync(cachePath);
        blockerInstance = ElectronBlocker.deserialize(buffer);
      } else {
        console.log('[ADBLOCK] Fetching native adblocker lists from remote...');
        blockerInstance = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
        fs.writeFileSync(cachePath, blockerInstance.serialize());
        console.log('[ADBLOCK] Adblocker cache saved.');
      }

      blockerInstance.on('request-blocked', () => {
        blockedRequestsCount++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('adblock-stats-updated', {
            blockedRequests: blockedRequestsCount,
            blockedTrackers: blockedTrackersCount
          });
        }
      });

      blockerInstance.on('request-redirected', () => {
        blockedTrackersCount++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('adblock-stats-updated', {
            blockedRequests: blockedRequestsCount,
            blockedTrackers: blockedTrackersCount
          });
        }
      });
    }

    adblockActiveSessions.add(sessionInstance);
    if (adblockGlobalEnabled) {
      blockerInstance.enableBlockingInSession(sessionInstance);
      console.log('[ADBLOCK] Enabled native ad-blocking for session.');
    }
  } catch (err) {
    console.error('[ADBLOCK] Failed to initialize native blocker:', err);
  }
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

    // Auto check for GitHub updates 3 seconds after startup
    setTimeout(async () => {
      try {
        const update = await checkAppUpdates(false);
        if (update && update.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app-update-available', update);
        }
      } catch (e) {}
    }, 3000);
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

      const success = await processDownloadedFile(savePath, fileName, downloadId);

      if (success) {
        mainWindow.webContents.send('download-completed', {
          id: downloadId,
          name: fileName,
          filePath: savePath
        });
      }
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

// Checks if 7z is available in the system PATH
const { exec } = require('child_process');
let is7zAvailable = false;
try {
  const { execSync } = require('child_process');
  execSync('7z --help', { stdio: 'ignore' });
  is7zAvailable = true;
  console.log('[EXTRACTION] 7z command-line tool is available. Using it for high-performance native extraction.');
} catch (e) {
  console.warn('[EXTRACTION] 7z command-line tool is not available in PATH. Using JS fallbacks (AdmZip/node-unrar-js).');
}

function run7zExtraction(filePath, gameFolder, password = '') {
  return new Promise((resolve, reject) => {
    const pSwitch = password ? `-p"${password}"` : '-p""';
    const cmd = `7z x "-o${gameFolder}" -y ${pSwitch} "${filePath}"`;

    console.log('[EXTRACTION] Running 7z command:', cmd);
    exec(cmd, (err, stdout, stderr) => {
      const output = (stdout || '') + '\n' + (stderr || '');
      if (err) {
        console.error('[EXTRACTION] 7z failed with code:', err.code);
        if (output.includes('Wrong password') || output.includes('Wrong Password') || output.includes('password') || err.code === 2) {
          reject({ type: 'password_required', message: 'Password required or incorrect' });
        } else {
          reject(new Error(stderr || stdout || '7z extraction failed'));
        }
      } else {
        console.log('[EXTRACTION] 7z extraction completed successfully.');
        resolve(true);
      }
    });
  });
}

// Dynamic extraction helper (supports password-protection)
async function extractArchive(filePath, gameFolder, ext, password = '') {
  if (is7zAvailable) {
    return await run7zExtraction(filePath, gameFolder, password);
  }

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);
    try {
      if (password) {
        zip.extractAllTo(gameFolder, true, false, password);
      } else {
        zip.extractAllTo(gameFolder, true);
      }
    } catch (err) {
      const errMsg = err.message || '';
      console.log('[EXTRACTION] ZIP extract error:', errMsg);
      if (errMsg.includes('password') || errMsg.includes('decrypt') || errMsg.includes('Wrong Password') || errMsg.includes('CRC') || errMsg.includes('Invalid signature')) {
        throw { type: 'password_required', message: err.message };
      }
      throw err;
    }
  } else if (ext === '.rar') {
    try {
      const extractor = await createExtractorFromFile({
        filepath: filePath,
        targetPath: gameFolder,
        password: password || undefined
      });

      const { files } = extractor.extract();
      [...files]; // consume generator to trigger extraction
    } catch (err) {
      const errMsg = err.message || '';
      console.log('[EXTRACTION] RAR extract error:', errMsg);
      if (errMsg.includes('password') || errMsg.includes('decrypt') || errMsg.includes('checksum') || errMsg.includes('CRC')) {
        throw { type: 'password_required', message: err.message };
      }
      throw err;
    }
  }
  return true;
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
      try {
        await extractArchive(filePath, gameFolder, ext);
        
        // Clean up archive file to save space
        try { fs.unlinkSync(filePath); } catch (e) {}

        // Continue normal scan and registration
        await continueAfterExtraction(gameId, gameFolder, cleanName);
        return true;
      } catch (err) {
        if (err && err.type === 'password_required') {
          console.log('[EXTRACTION] Password required for:', fileName);
          // Store pending extraction state
          pendingExtractions[gameId] = {
            filePath,
            gameFolder,
            ext,
            downloadId,
            cleanName,
            fileName
          };
          // Notify renderer to show password prompt
          mainWindow.webContents.send('prompt-archive-password', {
            id: gameId,
            title: cleanName,
            fileName
          });
          return false;
        } else {
          console.error(`Error extracting ${ext}:`, err);
          mainWindow.webContents.send('download-failed', {
            id: downloadId,
            name: cleanName,
            error: `Extraction failed: ${err.message || 'Unknown error'}`
          });
          return false;
        }
      }
    } else {
      // Standalone file downloaded (e.g. standalone .exe)
      const destPath = path.join(gameFolder, fileName);
      fs.copyFileSync(filePath, destPath);
      
      // Clean up temporary download file
      try { fs.unlinkSync(filePath); } catch (e) {}
      
      await registerGame(gameId, cleanName, gameFolder, fileName);
      return true;
    }
  } catch (err) {
    console.error('Error post-processing download:', err);
    return false;
  }
}

// Scans game folder, picks executables/scripts, and registers the game
async function continueAfterExtraction(gameId, gameFolder, cleanName) {
  const allFiles = getFilesRecursively(gameFolder);
  const exeFiles = findStartupCandidates(allFiles, gameFolder, cleanName, ['.exe', '.bat', '.cmd']);
  const bestExe = pickBestStartupCandidate(exeFiles, cleanName);

  if (bestExe) {
    // Register automatically when one clear startup executable or script is found.
    await registerGame(gameId, cleanName, gameFolder, bestExe);
  } else if (exeFiles.length === 1) {
    await registerGame(gameId, cleanName, gameFolder, exeFiles[0]);
  } else if (exeFiles.length > 1) {
    // Multiple executables / scripts - ask user
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
    // No executables or scripts found - ask user to pick from any file
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

  const coverPath = await findAndSaveCover(id, displayTitle, exePath, folderPath);
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
  app.whenReady().then(async () => {
    initPaths(); // Must be first: sets up all writable paths
    await loadAdblockExtension();
    await enableAdblocking(session.defaultSession);
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

      // Also load the Adblock extension into this webview's session if it differs from default
      if (adblockExtensionId && contents.session !== session.defaultSession) {
        const extensionsDir = path.join(userDataDir, 'extensions');
        const extensionUnpackedPath = path.join(extensionsDir, 'cfhdojbkjhnklbpkdaibdccddilifddb', '4.43.1_0');
        contents.session.loadExtension(extensionUnpackedPath, { allowFileAccess: true }).catch(err => {
          console.error('[EXTENSION] Failed to load extension into webview session:', err);
        });
        enableAdblocking(contents.session);
      }
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
  const library = readLibrary();
  // Auto-enrich in background if any game has a missing cover
  if (library.some(g => !g.coverPath)) {
    enrichMissingLibraryCovers().catch(err => console.error('Enrichment error:', err));
  }
  return library;
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

// Active game process tracking for playtime calculation
const activeGameSessions = {};

// Helper to compute total directory size recursively
function getDirectorySizeBytes(dirPath) {
  let size = 0;
  if (!fs.existsSync(dirPath)) return 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          size += getDirectorySizeBytes(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return size;
}

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
    const ext = path.extname(fullExePath).toLowerCase();
    console.log(`[LAUNCH] Launching game "${game.title}" (${ext}) from: ${fullExePath}`);

    const startTime = Date.now();
    let child;

    if (ext === '.bat' || ext === '.cmd') {
      child = spawn('cmd.exe', ['/c', `"${fullExePath}"`], {
        cwd: workingDirectory,
        windowsHide: false,
        shell: true
      });
    } else {
      child = spawn(fullExePath, [], {
        cwd: workingDirectory
      });
    }

    // Update lastPlayed timestamp immediately
    try {
      let library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
      const idx = library.findIndex(g => g.id === gameId);
      if (idx !== -1) {
        library[idx].lastPlayed = new Date().toISOString();
        fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
        mainWindow?.webContents.send('library-updated');
      }
    } catch (e) {}

    // Track active game session
    activeGameSessions[gameId] = { startTime, child };

    child.on('exit', (code) => {
      const elapsedMs = Date.now() - startTime;
      const elapsedMins = Math.max(1, Math.round(elapsedMs / 60000));
      console.log(`[PLAYTIME] "${game.title}" session ended. Added ${elapsedMins} mins.`);
      try {
        let lib = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
        const i = lib.findIndex(g => g.id === gameId);
        if (i !== -1) {
          lib[i].playtimeMinutes = (lib[i].playtimeMinutes || 0) + elapsedMins;
          lib[i].lastPlayed = new Date().toISOString();
          fs.writeFileSync(libraryPath, JSON.stringify(lib, null, 2), 'utf-8');
          mainWindow?.webContents.send('library-updated');
        }
      } catch (e) {}
      delete activeGameSessions[gameId];
    });

    return { success: true };
  } catch (err) {
    console.error('Error starting game:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('toggle-game-favorite', (event, gameId) => {
  if (!fs.existsSync(libraryPath)) return { success: false, error: 'Library not found' };
  try {
    let library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    const idx = library.findIndex(g => g.id === gameId);
    if (idx === -1) return { success: false, error: 'Game not found' };
    library[idx].favorite = !library[idx].favorite;
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
    if (mainWindow) mainWindow.webContents.send('library-updated');
    return { success: true, favorite: library[idx].favorite };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-storage-stats', async () => {
  try {
    let library = [];
    if (fs.existsSync(libraryPath)) {
      library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
    }
    const gameCount = library.length;
    let totalSizeBytes = 0;
    if (fs.existsSync(gamesDir)) {
      totalSizeBytes = getDirectorySizeBytes(gamesDir);
    }
    const totalSizeGB = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);

    let driveTotalGB = '0';
    let driveFreeGB = '0';
    let driveUsedPercent = 0;
    let driveLetter = 'C:';

    try {
      const targetDir = fs.existsSync(gamesDir) ? gamesDir : appRootDir;
      const parsedPath = path.parse(path.resolve(targetDir));
      driveLetter = parsedPath.root.replace(/[\\/]/g, '') || 'C:';

      const statfs = fs.statfsSync(targetDir);
      const totalDiskBytes = statfs.blocks * statfs.bsize;
      const freeDiskBytes = statfs.bfree * statfs.bsize;
      const usedDiskBytes = totalDiskBytes - freeDiskBytes;

      driveTotalGB = (totalDiskBytes / (1024 ** 3)).toFixed(0);
      driveFreeGB = (freeDiskBytes / (1024 ** 3)).toFixed(0);
      driveUsedPercent = Math.min(100, Math.max(0, ((usedDiskBytes / totalDiskBytes) * 100)));
    } catch (diskErr) {
      console.warn('Could not read disk stats:', diskErr);
    }

    return {
      success: true,
      gameCount,
      totalSizeGB,
      totalSizeBytes,
      driveLetter,
      driveTotalGB,
      driveFreeGB,
      driveUsedPercent: Number(driveUsedPercent.toFixed(1)),
      gamesPath: gamesDir
    };
  } catch (err) {
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

ipcMain.handle('get-active-tab-info', () => {
  const { webContents } = require('electron');
  const all = webContents.getAllWebContents();
  for (const wc of all) {
    if (wc.getType() === 'webview') {
      try {
        const url = wc.getURL();
        const title = wc.getTitle();
        return { url, title };
      } catch (err) {
        console.error('Failed to get webview info:', err);
      }
    }
  }
  return null;
});

ipcMain.handle('get-adblock-status', (event, currentUrl) => {
  let hostname = '';
  try {
    if (currentUrl && currentUrl.startsWith('http')) {
      hostname = new URL(currentUrl).hostname;
    }
  } catch (e) {}

  const isWhitelisted = hostname ? whitelistedDomains.has(hostname) : false;
  return {
    globalEnabled: adblockGlobalEnabled,
    currentSite: hostname || 'Local / Internal Page',
    isSiteEnabled: !isWhitelisted,
    blockedRequests: blockedRequestsCount,
    blockedTrackers: blockedTrackersCount,
    totalBlocked: blockedRequestsCount + blockedTrackersCount
  };
});

ipcMain.handle('toggle-adblock-global', () => {
  adblockGlobalEnabled = !adblockGlobalEnabled;
  for (const sess of adblockActiveSessions) {
    if (blockerInstance) {
      if (adblockGlobalEnabled) {
        blockerInstance.enableBlockingInSession(sess);
      } else {
        blockerInstance.disableBlockingInSession(sess);
      }
    }
  }
  return { success: true, globalEnabled: adblockGlobalEnabled };
});

ipcMain.handle('toggle-adblock-site', (event, domain) => {
  if (!domain || domain.includes('Internal') || domain.includes('about:')) {
    return { success: false, error: 'Invalid domain' };
  }
  if (whitelistedDomains.has(domain)) {
    whitelistedDomains.delete(domain);
  } else {
    whitelistedDomains.add(domain);
  }
  const isSiteEnabled = !whitelistedDomains.has(domain);
  return { success: true, isSiteEnabled, domain };
});

ipcMain.handle('update-adblock-filters', async () => {
  try {
    const cachePath = path.join(userDataDir, 'adblocker.bin');
    blockerInstance = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    fs.writeFileSync(cachePath, blockerInstance.serialize());
    for (const sess of adblockActiveSessions) {
      if (adblockGlobalEnabled) {
        blockerInstance.enableBlockingInSession(sess);
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('submit-archive-password', async (event, payload) => {
  const { gameId, password } = payload || {};
  const pending = pendingExtractions[gameId];
  if (!pending) return { success: false, error: 'No pending extraction found' };

  try {
    console.log('[EXTRACTION] Attempting extraction with password for:', pending.cleanName);
    await extractArchive(pending.filePath, pending.gameFolder, pending.ext, password);

    // Extraction succeeded! Clean up zip
    try { fs.unlinkSync(pending.filePath); } catch (e) {}

    // Continue the normal registration flow!
    await continueAfterExtraction(gameId, pending.gameFolder, pending.cleanName);

    // Tell UI the download processing is complete
    mainWindow.webContents.send('download-completed', {
      id: pending.downloadId,
      name: pending.cleanName,
      filePath: pending.filePath
    });

    // Clean up pending extraction state
    delete pendingExtractions[gameId];

    return { success: true };
  } catch (err) {
    console.error('[EXTRACTION] Decryption/extraction failed:', err);
    if (err && err.type === 'password_required') {
      // Re-trigger the password prompt modal since the password was wrong!
      mainWindow.webContents.send('prompt-archive-password', {
        id: gameId,
        title: pending.cleanName,
        fileName: pending.fileName,
        isRetry: true // Tell UI this is a retry due to wrong password
      });
      return { success: false, error: 'invalid_password' };
    }

    // Also notify download-failed for general failures during retry extraction
    mainWindow.webContents.send('download-failed', {
      id: pending.downloadId,
      name: pending.cleanName,
      error: `Extraction failed: ${err.message || 'Unknown error'}`
    });
    return { success: false, error: err.message || 'Extraction failed' };
  }
});

ipcMain.handle('cancel-archive-extraction', (event, gameId) => {
  const pending = pendingExtractions[gameId];
  if (pending) {
    console.log('[EXTRACTION] User canceled extraction for:', pending.cleanName);
    // Clean up files/folders
    try { fs.unlinkSync(pending.filePath); } catch (e) {}
    try { fs.rmSync(pending.gameFolder, { recursive: true, force: true }); } catch (e) {}
    delete pendingExtractions[gameId];
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('check-app-update', async (event, manual) => {
  return await checkAppUpdates(!!manual);
});

ipcMain.handle('start-app-update-download', async (event, downloadUrl) => {
  return await startAppUpdateDownload(downloadUrl);
});

ipcMain.handle('apply-app-update-and-restart', () => {
  return applyAppUpdateAndRestart();
});

ipcMain.handle('open-external-url', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});

// --- Minecraft Launcher IPC Handlers ---
ipcMain.handle('mc-login-microsoft', async () => {
  if (!minecraftService) return { success: false, error: 'Service not initialized' };
  return await minecraftService.loginMicrosoft();
});

ipcMain.handle('mc-set-offline-profile', async (event, username) => {
  if (!minecraftService) return { success: false, error: 'Service not initialized' };
  return minecraftService.setOfflineProfile(username);
});

ipcMain.handle('mc-get-profile', () => {
  if (!minecraftService) return null;
  return minecraftService.getProfile();
});

ipcMain.handle('mc-logout', () => {
  if (!minecraftService) return { success: false };
  return minecraftService.logout();
});

ipcMain.handle('mc-get-config', () => {
  if (!minecraftService) return {};
  return minecraftService.getConfig();
});

ipcMain.handle('mc-save-config', (event, config) => {
  if (!minecraftService) return {};
  return minecraftService.saveConfig(config);
});

ipcMain.handle('mc-get-versions', async () => {
  if (!minecraftService) return { success: false, versions: [] };
  return await minecraftService.getVersions();
});

ipcMain.handle('mc-search-modrinth', async (event, params) => {
  if (!minecraftService) return { hits: [], total_hits: 0 };
  return await minecraftService.searchModrinth(params || {});
});

ipcMain.handle('mc-get-project-versions', async (event, { projectId, loader, version }) => {
  if (!minecraftService) return [];
  return await minecraftService.getModrinthProjectVersions(projectId, loader, version);
});

ipcMain.handle('mc-install-mod', async (event, { fileUrl, fileName, projectType }) => {
  if (!minecraftService) return { success: false, error: 'Service not initialized' };
  return await minecraftService.installModFile(fileUrl, fileName, projectType, (p) => {
    mainWindow?.webContents.send('mc-mod-download-progress', { fileName, ...p });
  });
});

ipcMain.handle('mc-get-installed-mods', () => {
  if (!minecraftService) return [];
  return minecraftService.getInstalledMods();
});

ipcMain.handle('mc-toggle-mod', (event, { filename, enable }) => {
  if (!minecraftService) return { success: false };
  return minecraftService.toggleMod(filename, enable);
});

ipcMain.handle('mc-delete-mod', (event, filename) => {
  if (!minecraftService) return { success: false };
  return minecraftService.deleteMod(filename);
});

ipcMain.handle('mc-open-folder', (event, folderType) => {
  if (!minecraftService) return { success: false };
  let target = minecraftService.mcDir;
  if (folderType === 'mods') target = minecraftService.modsDir;
  if (folderType === 'resourcepacks') target = minecraftService.resourcePacksDir;
  if (folderType === 'shaderpacks') target = minecraftService.shaderPacksDir;
  shell.openPath(target);
  return { success: true };
});

ipcMain.handle('mc-launch-game', async (event, launchConfig) => {
  if (!minecraftService) return { success: false, error: 'Service not initialized' };
  return await minecraftService.launchGame(
    launchConfig,
    (progress) => {
      mainWindow?.webContents.send('mc-launch-progress', progress);
    },
    (logData) => {
      mainWindow?.webContents.send('mc-log', logData);
    },
    (exitCode) => {
      mainWindow?.webContents.send('mc-closed', { exitCode });
    }
  );
});
