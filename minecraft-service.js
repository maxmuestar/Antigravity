const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

class MinecraftService {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.mcDir = path.join(userDataDir, 'minecraft');
    this.modsDir = path.join(this.mcDir, 'mods');
    this.resourcePacksDir = path.join(this.mcDir, 'resourcepacks');
    this.shaderPacksDir = path.join(this.mcDir, 'shaderpacks');
    this.profilePath = path.join(this.mcDir, 'profile.json');
    this.configPath = path.join(this.mcDir, 'launcher-config.json');

    this.ensureDirs();
  }

  ensureDirs() {
    [this.mcDir, this.modsDir, this.resourcePacksDir, this.shaderPacksDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'AntiGravity-Launcher/6.5.5' } }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  getProfile() {
    try {
      if (fs.existsSync(this.profilePath)) {
        return JSON.parse(fs.readFileSync(this.profilePath, 'utf-8'));
      }
    } catch (e) {
      console.warn('Failed to read MC profile:', e);
    }
    return null;
  }

  saveProfile(profile) {
    fs.writeFileSync(this.profilePath, JSON.stringify(profile, null, 2), 'utf-8');
    return profile;
  }

  logout() {
    if (fs.existsSync(this.profilePath)) {
      try { fs.unlinkSync(this.profilePath); } catch (e) {}
    }
    return { success: true };
  }

  async loginMicrosoft() {
    return new Promise((resolve) => {
      try {
        const { BrowserWindow } = require('electron');
        const msmc = require('msmc');
        const auth = new msmc.Auth("select_account");
        const authUrl = auth.createLink();

        console.log('[MC AUTH] Opening Microsoft login window:', authUrl);

        const loginWin = new BrowserWindow({
          width: 520,
          height: 680,
          title: "Log in with Microsoft - Minecraft",
          autoHideMenuBar: true,
          alwaysOnTop: true,
          resizable: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        let finished = false;

        const checkRedirect = async (url) => {
          if (finished || !url) return;
          if (url.startsWith('https://login.live.com/oauth20_desktop.srf')) {
            finished = true;
            try {
              const parsedUrl = new URL(url);
              const code = parsedUrl.searchParams.get('code');
              const error = parsedUrl.searchParams.get('error');
              const errorDesc = parsedUrl.searchParams.get('error_description');

              try { loginWin.destroy(); } catch (e) {}

              if (code) {
                console.log('[MC AUTH] Authorization code received, logging in to Xbox & Minecraft...');
                const xbox = await auth.login(code);
                const token = await xbox.getMinecraft();
                const mclcAuth = xbox.mclc();

                const profile = {
                  gamertag: token.profile?.name || 'Player',
                  uuid: token.profile?.id || '00000000-0000-0000-0000-000000000000',
                  skinUrl: token.profile?.id ? `https://crafatar.com/avatars/${token.profile.id}?overlay` : null,
                  token: mclcAuth,
                  rawProfile: token.profile,
                  isOffline: false,
                  lastLogin: new Date().toISOString()
                };

                this.saveProfile(profile);
                return resolve({ success: true, profile });
              } else {
                return resolve({ success: false, error: errorDesc || error || 'Login cancelled by user' });
              }
            } catch (err) {
              console.error('[MC AUTH] Token exchange failed:', err);
              return resolve({ success: false, error: err.message });
            }
          }
        };

        loginWin.webContents.on('will-navigate', (e, url) => checkRedirect(url));
        loginWin.webContents.on('will-redirect', (e, url) => checkRedirect(url));
        loginWin.webContents.on('did-navigate', (e, url) => checkRedirect(url));
        loginWin.webContents.on('did-finish-load', () => checkRedirect(loginWin.webContents.getURL()));

        loginWin.on('close', () => {
          if (!finished) {
            finished = true;
            resolve({ success: false, error: 'Login window closed' });
          }
        });

        loginWin.loadURL(authUrl);
      } catch (err) {
        console.error('[MC AUTH] Login error:', err);
        resolve({ success: false, error: err.message });
      }
    });
  }

  setOfflineProfile(username = 'Player') {
    const { Authenticator } = require('minecraft-launcher-core');
    const auth = Authenticator.getAuth(username || 'Player');
    const profile = {
      gamertag: username || 'Player',
      uuid: auth.uuid,
      skinUrl: `https://crafatar.com/avatars/${auth.uuid}?overlay`,
      token: auth,
      isOffline: true,
      lastLogin: new Date().toISOString()
    };
    this.saveProfile(profile);
    return { success: true, profile };
  }

  getConfig() {
    const defaults = {
      version: '1.20.1',
      loader: 'fabric',
      ramMin: 2,
      ramMax: 4,
      customJavaPath: ''
    };
    try {
      if (fs.existsSync(this.configPath)) {
        return { ...defaults, ...JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) };
      }
    } catch (e) {}
    return defaults;
  }

  saveConfig(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    return config;
  }

  async getVersions() {
    try {
      const manifest = await this.fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const releases = manifest.versions
        .filter(v => v.type === 'release')
        .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
      return { success: true, latest: manifest.latest, versions: releases.slice(0, 40) };
    } catch (err) {
      return { success: false, error: err.message, versions: this.getFallbackVersions() };
    }
  }

  getFallbackVersions() {
    return [
      { id: '1.21.1', type: 'release' },
      { id: '1.21', type: 'release' },
      { id: '1.20.6', type: 'release' },
      { id: '1.20.4', type: 'release' },
      { id: '1.20.1', type: 'release' },
      { id: '1.19.4', type: 'release' },
      { id: '1.18.2', type: 'release' },
      { id: '1.16.5', type: 'release' },
      { id: '1.12.2', type: 'release' },
      { id: '1.8.9', type: 'release' },
      { id: '1.7.10', type: 'release' }
    ];
  }

  async prepareLoader(loader, gameVersion) {
    if (!loader || loader === 'vanilla') return null;

    try {
      if (loader === 'fabric') {
        const loaders = await this.fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`);
        if (!loaders || loaders.length === 0) {
          console.warn(`[MC LOADER] No Fabric loader found for Minecraft ${gameVersion}`);
          return null;
        }

        const loaderVer = loaders[0].loader.version;
        const profileJson = await this.fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVer)}/profile/json`);
        const versionId = profileJson.id || `fabric-loader-${loaderVer}-${gameVersion}`;

        const versionDir = path.join(this.mcDir, 'versions', versionId);
        if (!fs.existsSync(versionDir)) {
          fs.mkdirSync(versionDir, { recursive: true });
        }

        const versionJsonPath = path.join(versionDir, `${versionId}.json`);
        fs.writeFileSync(versionJsonPath, JSON.stringify(profileJson, null, 2), 'utf-8');
        console.log(`[MC LOADER] Installed Fabric version JSON: ${versionJsonPath}`);
        return versionId;
      }

      if (loader === 'quilt') {
        const loaders = await this.fetchJson(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}`);
        if (!loaders || loaders.length === 0) {
          console.warn(`[MC LOADER] No Quilt loader found for Minecraft ${gameVersion}`);
          return null;
        }

        const loaderVer = loaders[0].loader.version;
        const profileJson = await this.fetchJson(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVer)}/profile/json`);
        const versionId = profileJson.id || `quilt-loader-${loaderVer}-${gameVersion}`;

        const versionDir = path.join(this.mcDir, 'versions', versionId);
        if (!fs.existsSync(versionDir)) {
          fs.mkdirSync(versionDir, { recursive: true });
        }

        const versionJsonPath = path.join(versionDir, `${versionId}.json`);
        fs.writeFileSync(versionJsonPath, JSON.stringify(profileJson, null, 2), 'utf-8');
        console.log(`[MC LOADER] Installed Quilt version JSON: ${versionJsonPath}`);
        return versionId;
      }
    } catch (err) {
      console.error('[MC LOADER] Failed to prepare loader:', err);
    }

    return null;
  }

  async searchModrinth({ query = '', projectType = 'mod', loader = '', version = '', limit = 18, offset = 0, index = 'relevance' }) {
    const facets = [];
    if (projectType && projectType !== 'all') {
      facets.push(`["project_type:${projectType}"]`);
    }
    if (loader && loader !== 'vanilla' && projectType === 'mod') {
      facets.push(`["categories:${loader}"]`);
    }
    if (version) {
      facets.push(`["versions:${version}"]`);
    }

    const facetsQuery = facets.length ? `&facets=[${facets.join(',')}]` : '';
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&index=${index}${facetsQuery}`;

    return await this.fetchJson(url);
  }

  async getModrinthProjectVersions(projectId, loader = '', version = '') {
    let url = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`;
    const params = [];
    if (loader && loader !== 'vanilla') params.push(`loaders=["${loader}"]`);
    if (version) params.push(`game_versions=["${version}"]`);
    if (params.length) url += '?' + params.join('&');

    try {
      const res = await this.fetchJson(url);
      if (Array.isArray(res) && res.length > 0) return res;
    } catch (e) {
      console.warn('Initial project versions lookup failed, trying fallback:', e.message);
    }

    // Fallback without strict loader filtering if none found
    try {
      let fallbackUrl = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`;
      if (version) fallbackUrl += `?game_versions=["${version}"]`;
      return await this.fetchJson(fallbackUrl);
    } catch (err) {
      console.error('Failed to get versions:', err);
      return [];
    }
  }

  downloadFileWithRedirects(fileUrl, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      function requestUrl(currentUrl, redirects = 0) {
        if (redirects > 8) return reject(new Error('Too many redirects'));
        const parsed = new URL(currentUrl);
        const client = parsed.protocol === 'https:' ? https : http;

        client.get(currentUrl, {
          headers: { 'User-Agent': 'AntiGravity-Launcher' }
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            return requestUrl(nextUrl, redirects + 1);
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;

          const fileStream = fs.createWriteStream(destPath);
          res.on('data', chunk => {
            received += chunk.length;
            if (onProgress && total > 0) {
              onProgress({
                percent: ((received / total) * 100).toFixed(1),
                received: (received / (1024 * 1024)).toFixed(1),
                total: (total / (1024 * 1024)).toFixed(1)
              });
            }
          });

          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(() => resolve(destPath)));
          fileStream.on('error', err => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        }).on('error', reject);
      }

      requestUrl(fileUrl);
    });
  }

  async installModFile(fileUrl, fileName, projectType = 'mod', onProgress) {
    this.ensureDirs();
    let targetDir = this.modsDir;
    if (projectType === 'resourcepack') targetDir = this.resourcePacksDir;
    if (projectType === 'shader') targetDir = this.shaderPacksDir;

    const destPath = path.join(targetDir, fileName);
    await this.downloadFileWithRedirects(fileUrl, destPath, onProgress);
    return { success: true, destPath, fileName };
  }

  getInstalledMods() {
    this.ensureDirs();
    if (!fs.existsSync(this.modsDir)) return [];

    const files = fs.readdirSync(this.modsDir);
    return files
      .filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled') || f.endsWith('.zip') || f.endsWith('.mrpack'))
      .map(file => {
        const fullPath = path.join(this.modsDir, file);
        const stats = fs.statSync(fullPath);
        const isEnabled = !file.endsWith('.disabled');
        const cleanName = file.replace(/\.disabled$/, '');

        return {
          filename: file,
          cleanName,
          enabled: isEnabled,
          size: (stats.size / 1024).toFixed(1) + ' KB',
          sizeBytes: stats.size,
          lastModified: stats.mtime
        };
      });
  }

  toggleMod(filename, enable) {
    const currentPath = path.join(this.modsDir, filename);
    if (!fs.existsSync(currentPath)) return { success: false, error: 'File not found' };

    let targetFilename;
    if (enable && filename.endsWith('.disabled')) {
      targetFilename = filename.replace(/\.disabled$/, '');
    } else if (!enable && !filename.endsWith('.disabled')) {
      targetFilename = filename + '.disabled';
    } else {
      return { success: true, filename };
    }

    const targetPath = path.join(this.modsDir, targetFilename);
    fs.renameSync(currentPath, targetPath);
    return { success: true, filename: targetFilename, enabled: enable };
  }

  deleteMod(filename) {
    const filePath = path.join(this.modsDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  }

  async launchGame({ version = '1.20.1', loader = 'fabric', ramMin = 2, ramMax = 4, customJavaPath = '' }, onProgress, onLog, onClose) {
    try {
      const { Client, Authenticator } = require('minecraft-launcher-core');
      const launcher = new Client();
      let profile = this.getProfile();

      if (!profile || !profile.token) {
        // Fallback to offline player
        profile = this.setOfflineProfile('Steve').profile;
      }

      const launchOpts = {
        clientPackage: null,
        authorization: profile.token,
        root: this.mcDir,
        version: {
          number: version,
          type: "release"
        },
        memory: {
          max: `${ramMax || 4}G`,
          min: `${ramMin || 2}G`
        }
      };

      if (customJavaPath && fs.existsSync(customJavaPath)) {
        launchOpts.javaPath = customJavaPath;
      }

      if (loader && loader !== 'vanilla') {
        const customVersionId = await this.prepareLoader(loader, version);
        if (customVersionId) {
          launchOpts.version.custom = customVersionId;
        }
      }

      console.log('[MC LAUNCH] Starting launch with opts:', {
        version: launchOpts.version,
        memory: launchOpts.memory,
        root: launchOpts.root,
        user: profile.gamertag
      });

      launcher.on('debug', (e) => {
        if (onLog) onLog(`[DEBUG] ${e}`);
      });

      launcher.on('data', (e) => {
        if (onLog) onLog(`${e}`);
      });

      launcher.on('progress', (e) => {
        if (onProgress) onProgress({
          type: e.type,
          task: e.task,
          total: e.total,
          current: e.current,
          percent: e.total > 0 ? ((e.current / e.total) * 100).toFixed(1) : 0
        });
      });

      launcher.on('download-status', (e) => {
        if (onProgress) onProgress({
          type: e.type,
          name: e.name,
          current: e.current,
          total: e.total,
          percent: e.total > 0 ? ((e.current / e.total) * 100).toFixed(1) : 0
        });
      });

      launcher.on('close', (code) => {
        if (onClose) onClose(code);
      });

      await launcher.launch(launchOpts);
      return { success: true };
    } catch (err) {
      console.error('[MC LAUNCH] Launch failed:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = MinecraftService;
