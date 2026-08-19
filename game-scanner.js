const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

class GameScanner {
  constructor(coversDir) {
    this.coversDir = coversDir;
    if (!fs.existsSync(this.coversDir)) {
      fs.mkdirSync(this.coversDir, { recursive: true });
    }
  }

  // Scan all supported external game launchers
  scanAll(existingLibrary = []) {
    const existingPaths = new Set(
      existingLibrary.map(g => path.normalize(g.folderPath || '').toLowerCase())
    );
    const existingTitles = new Set(
      existingLibrary.map(g => (g.title || '').trim().toLowerCase())
    );

    const steamGames = this.scanSteam();
    const epicGames = this.scanEpic();
    const eaGames = this.scanEA();
    const gogGames = this.scanGOG();
    const ubiGames = this.scanUbisoft();

    const rawList = [
      ...steamGames,
      ...epicGames,
      ...eaGames,
      ...gogGames,
      ...ubiGames
    ];

    // Deduplicate by normalized install path
    const seenPaths = new Set();
    const dedupedList = [];

    for (const g of rawList) {
      const normPath = path.normalize(g.installPath || '').toLowerCase();
      if (!normPath || seenPaths.has(normPath)) continue;
      seenPaths.add(normPath);

      // Check if already in AntiGravity library
      const isImported = existingPaths.has(normPath) || existingTitles.has((g.title || '').trim().toLowerCase());
      g.alreadyImported = isImported;

      // Auto-detect startup executable if not specified
      if (!g.executablePath && fs.existsSync(g.installPath)) {
        g.executablePath = this.findMainExecutable(g.installPath, g.title);
      }

      dedupedList.push(g);
    }

    return dedupedList;
  }

  // Steam Scanner
  scanSteam() {
    const games = [];
    const commonSteamPaths = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'E:\\Steam'
    ];

    let steamPath = null;
    try {
      const regOut = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', { encoding: 'utf-8' });
      const match = regOut.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (match && match[1]) {
        steamPath = match[1].trim();
      }
    } catch (e) {}

    if (!steamPath) {
      steamPath = commonSteamPaths.find(p => fs.existsSync(p));
    }

    if (!steamPath || !fs.existsSync(steamPath)) {
      return games;
    }

    const libraryFolders = [path.normalize(steamPath)];
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');

    if (fs.existsSync(vdfPath)) {
      try {
        const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
        const matches = vdfContent.matchAll(/"path"\s+"([^"]+)"/g);
        for (const m of matches) {
          let p = path.normalize(m[1].replace(/\\\\/g, '\\'));
          if (fs.existsSync(p) && !libraryFolders.includes(p)) {
            libraryFolders.push(p);
          }
        }
      } catch (e) {}
    }

    for (const lib of libraryFolders) {
      const steamAppsDir = path.join(lib, 'steamapps');
      if (!fs.existsSync(steamAppsDir)) continue;

      try {
        const files = fs.readdirSync(steamAppsDir);
        for (const f of files) {
          if (f.startsWith('appmanifest_') && f.endsWith('.acf')) {
            try {
              const content = fs.readFileSync(path.join(steamAppsDir, f), 'utf-8');
              const appidMatch = content.match(/"appid"\s+"(\d+)"/i);
              const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
              const dirMatch = content.match(/"installdir"\s+"([^"]+)"/i);

              if (appidMatch && nameMatch) {
                const appId = appidMatch[1];
                const name = nameMatch[1].trim();
                const installDirName = dirMatch ? dirMatch[1] : name;
                const fullInstallPath = path.join(steamAppsDir, 'common', installDirName);

                // Exclude common runtime redistributables
                const lowerName = name.toLowerCase();
                if (
                  appId === '228980' ||
                  lowerName.includes('steamworks common') ||
                  lowerName.includes('proton') ||
                  lowerName.includes('steam linux runtime')
                ) {
                  continue;
                }

                if (fs.existsSync(fullInstallPath)) {
                  games.push({
                    id: `steam-${appId}`,
                    source: 'steam',
                    platformName: 'Steam',
                    appId,
                    title: name,
                    installPath: fullInstallPath,
                    coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
                    headerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
                    launchUri: `steam://rungameid/${appId}`,
                    executablePath: this.findMainExecutable(fullInstallPath, name)
                  });
                }
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return games;
  }

  // Epic Games Scanner
  scanEpic() {
    const games = [];
    const manifestsDir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

    if (!fs.existsSync(manifestsDir)) return games;

    try {
      const files = fs.readdirSync(manifestsDir);
      for (const f of files) {
        if (f.endsWith('.item')) {
          try {
            const itemData = JSON.parse(fs.readFileSync(path.join(manifestsDir, f), 'utf-8'));
            if (itemData.DisplayName && itemData.InstallLocation && fs.existsSync(itemData.InstallLocation)) {
              const title = itemData.DisplayName.trim();
              const installPath = itemData.InstallLocation;
              const launchExe = itemData.LaunchExecutable;
              const appName = itemData.AppName || itemData.CatalogItemId;

              // Filter out Unreal Engine engine versions
              if (title.toLowerCase().includes('unreal engine') || title.toLowerCase().includes('directx')) {
                continue;
              }

              const fullExePath = launchExe
                ? (path.isAbsolute(launchExe) ? launchExe : path.join(installPath, launchExe))
                : this.findMainExecutable(installPath, title);

              games.push({
                id: `epic-${appName || Date.now()}`,
                source: 'epic',
                platformName: 'Epic Games',
                appName,
                title,
                installPath,
                executablePath: fullExePath,
                launchUri: appName ? `com.epicgames.launcher://apps/${appName}?action=launch&silent=true` : '',
                coverUrl: ''
              });
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return games;
  }

  // EA App / Origin Scanner
  scanEA() {
    const games = [];
    const commonEAPaths = [
      'C:\\Program Files\\EA Games',
      'C:\\Program Files (x86)\\Origin Games',
      'C:\\Program Files\\Origin Games',
      'D:\\EA Games',
      'D:\\Origin Games'
    ];

    for (const eaPath of commonEAPaths) {
      if (fs.existsSync(eaPath)) {
        try {
          const items = fs.readdirSync(eaPath, { withFileTypes: true });
          for (const item of items) {
            if (item.isDirectory()) {
              const fullPath = path.join(eaPath, item.name);
              const title = item.name.replace(/™|®/g, '').trim();
              const exePath = this.findMainExecutable(fullPath, title);

              if (exePath) {
                games.push({
                  id: `ea-${Buffer.from(title).toString('hex').slice(0, 10)}`,
                  source: 'ea',
                  platformName: 'EA App',
                  title,
                  installPath: fullPath,
                  executablePath: exePath,
                  coverUrl: ''
                });
              }
            }
          }
        } catch (e) {}
      }
    }

    return games;
  }

  // GOG Galaxy Scanner
  scanGOG() {
    const games = [];
    try {
      const regQuery = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games" /s', { encoding: 'utf-8' });
      const blocks = regQuery.split('HKEY_LOCAL_MACHINE');
      for (const b of blocks) {
        if (!b.trim()) continue;
        const gameNameMatch = b.match(/gameName\s+REG_SZ\s+(.+)/i);
        const pathMatch = b.match(/path\s+REG_SZ\s+(.+)/i);
        const exeMatch = b.match(/exe\s+REG_SZ\s+(.+)/i);
        const gameIdMatch = b.match(/gameID\s+REG_SZ\s+(\d+)/i);

        if (gameNameMatch && pathMatch) {
          const title = gameNameMatch[1].trim();
          const installPath = pathMatch[1].trim();
          const exe = exeMatch ? exeMatch[1].trim() : '';
          const gameId = gameIdMatch ? gameIdMatch[1].trim() : '';

          if (fs.existsSync(installPath)) {
            const fullExe = exe ? (path.isAbsolute(exe) ? exe : path.join(installPath, exe)) : this.findMainExecutable(installPath, title);
            games.push({
              id: `gog-${gameId || Date.now()}`,
              source: 'gog',
              platformName: 'GOG Galaxy',
              gameId,
              title,
              installPath,
              executablePath: fullExe,
              coverUrl: ''
            });
          }
        }
      }
    } catch (e) {}

    return games;
  }

  // Ubisoft Connect Scanner
  scanUbisoft() {
    const games = [];
    try {
      const regQuery = execSync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs" /s', { encoding: 'utf-8' });
      const lines = regQuery.split('\n');
      for (const l of lines) {
        const match = l.match(/InstallDir\s+REG_SZ\s+(.+)/i);
        if (match) {
          const installDir = match[1].trim();
          const folderName = path.basename(installDir).replace(/™|®/g, '').trim();
          if (fs.existsSync(installDir)) {
            const exePath = this.findMainExecutable(installDir, folderName);
            games.push({
              id: `ubi-${Buffer.from(folderName).toString('hex').slice(0, 10)}`,
              source: 'ubisoft',
              platformName: 'Ubisoft',
              title: folderName,
              installPath: installDir,
              executablePath: exePath,
              coverUrl: ''
            });
          }
        }
      }
    } catch (e) {}

    return games;
  }

  // Heuristic to locate main game executable
  findMainExecutable(folderPath, gameTitle) {
    if (!fs.existsSync(folderPath)) return '';

    try {
      const files = fs.readdirSync(folderPath, { withFileTypes: true });
      const rootExes = [];

      const isIgnoredExe = (filename) => {
        const lower = filename.toLowerCase();
        return (
          lower.includes('unins') ||
          lower.includes('setup') ||
          lower.includes('crash') ||
          lower.includes('reporter') ||
          lower.includes('redist') ||
          lower.includes('dxsetup') ||
          lower.includes('update') ||
          lower.includes('vcredist') ||
          lower.includes('eula') ||
          lower.includes('cleanup') ||
          lower.includes('touchup') ||
          lower.includes('installer') ||
          lower.includes('support') ||
          lower.includes('easyanticheat') ||
          lower.includes('battleye')
        );
      };

      for (const file of files) {
        if (file.isFile() && file.name.toLowerCase().endsWith('.exe')) {
          if (!isIgnoredExe(file.name)) {
            rootExes.push(file.name);
          }
        }
      }

      const cleanTitle = (gameTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      // If matching root exes found, prioritize them
      if (rootExes.length > 0) {
        if (rootExes.length === 1) return path.join(folderPath, rootExes[0]);
        const match = rootExes.find(e => {
          const cleanExe = path.basename(e, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '');
          return cleanExe === cleanTitle || cleanExe.includes(cleanTitle) || cleanTitle.includes(cleanExe);
        });
        return path.join(folderPath, match || rootExes[0]);
      }

      // Look into valid subdirectories (e.g. Game/Bin, Binaries/Win64, bin)
      const validSubDirs = ['game\\bin', 'bin64', 'binaries\\win64', 'bin', 'binaries', 'release', 'x64'];
      for (const sub of validSubDirs) {
        const targetSub = path.join(folderPath, sub);
        if (fs.existsSync(targetSub)) {
          try {
            const subEntries = fs.readdirSync(targetSub);
            const subExes = subEntries.filter(e => e.toLowerCase().endsWith('.exe') && !isIgnoredExe(e));
            if (subExes.length > 0) {
              const match = subExes.find(e => {
                const cleanExe = path.basename(e, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '');
                return cleanExe === cleanTitle || cleanExe.includes(cleanTitle) || cleanTitle.includes(cleanExe);
              });
              return path.join(targetSub, match || subExes[0]);
            }
          } catch (e) {}
        }
      }

      // General fallback to 1-level deep subdirectories excluding installer/support
      for (const dir of files) {
        if (dir.isDirectory()) {
          const dirLower = dir.name.toLowerCase();
          if (dirLower.includes('installer') || dirLower.includes('support') || dirLower.includes('redist') || dirLower.startsWith('_')) {
            continue;
          }
          const subDir = path.join(folderPath, dir.name);
          try {
            const subFiles = fs.readdirSync(subDir);
            for (const sf of subFiles) {
              if (sf.toLowerCase().endsWith('.exe') && !isIgnoredExe(sf)) {
                return path.join(subDir, sf);
              }
            }
          } catch (e) {}
        }
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  // Download and cache remote cover image locally
  async downloadCoverLocally(url) {
    if (!url || !url.startsWith('http')) return '';

    return new Promise((resolve) => {
      try {
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const targetFilename = `cover_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
        const destPath = path.join(this.coversDir, targetFilename);
        const fileStream = fs.createWriteStream(destPath);

        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close();
              resolve(`app-file://${destPath.replace(/\\/g, '/')}`);
            });
          } else {
            fileStream.close();
            try { fs.unlinkSync(destPath); } catch (e) {}
            resolve('');
          }
        });

        req.on('error', () => {
          fileStream.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          resolve('');
        });

        req.setTimeout(8000, () => {
          req.destroy();
          resolve('');
        });
      } catch (e) {
        resolve('');
      }
    });
  }

  // Import selected games into library.json
  async importGames(selectedGames, libraryPath, fetchCoverFn) {
    let library = [];
    if (fs.existsSync(libraryPath)) {
      try {
        library = JSON.parse(fs.readFileSync(libraryPath, 'utf-8'));
      } catch (e) {
        library = [];
      }
    }

    const importedResults = [];

    for (const game of selectedGames) {
      // Check if already in library
      const existsIdx = library.findIndex(
        g => path.normalize(g.folderPath || '').toLowerCase() === path.normalize(game.installPath || '').toLowerCase() ||
             g.title.trim().toLowerCase() === game.title.trim().toLowerCase()
      );

      let coverPath = '';
      if (game.coverUrl) {
        coverPath = await this.downloadCoverLocally(game.coverUrl);
      } else if (fetchCoverFn) {
        try {
          const autoCover = await fetchCoverFn(game.title);
          if (autoCover) coverPath = autoCover;
        } catch (e) {}
      }

      // Fallback header URL if vertical cover was empty
      if (!coverPath && game.headerUrl) {
        coverPath = await this.downloadCoverLocally(game.headerUrl);
      }

      const relativeExe = game.executablePath && path.isAbsolute(game.executablePath)
        ? path.relative(game.installPath, game.executablePath).replace(/\\/g, '/')
        : (game.executablePath || '');

      const newEntry = {
        id: game.id || `imported-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: game.title,
        folderPath: game.installPath.replace(/\\/g, '/'),
        exePath: relativeExe,
        coverPath: coverPath || '',
        favorite: false,
        playtimeMinutes: 0,
        lastPlayed: null,
        source: game.source || 'imported',
        platformName: game.platformName || 'External',
        launchUri: game.launchUri || ''
      };

      if (existsIdx !== -1) {
        // Update existing entry
        library[existsIdx] = { ...library[existsIdx], ...newEntry };
        importedResults.push(library[existsIdx]);
      } else {
        library.push(newEntry);
        importedResults.push(newEntry);
      }
    }

    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf-8');
    return { success: true, count: importedResults.length, games: importedResults };
  }
}

module.exports = GameScanner;
