const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const AdmZip = require('adm-zip');

class MinecraftService {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.mcDir = path.join(userDataDir, 'minecraft');
    this.instancesDir = path.join(this.mcDir, 'instances');
    this.forgeDir = path.join(this.mcDir, 'forge-installers');
    this.profilePath = path.join(this.mcDir, 'profile.json');
    this.instancesConfigPath = path.join(this.mcDir, 'instances.json');

    this.ensureDirs();
    this.initDefaultInstance();
  }

  ensureDirs() {
    [this.mcDir, this.instancesDir, this.forgeDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  initDefaultInstance() {
    if (!fs.existsSync(this.instancesConfigPath)) {
      const defaultId = 'default-fabric';
      const defaultInstanceDir = path.join(this.instancesDir, defaultId);
      ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves'].forEach(sub => {
        const p = path.join(defaultInstanceDir, sub);
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
      });

      const initialData = {
        activeInstanceId: defaultId,
        instances: [
          {
            id: defaultId,
            name: 'Fabric 1.20.1 (Default)',
            version: '1.20.1',
            loader: 'fabric',
            ramMin: 2,
            ramMax: 4,
            icon: 'cube',
            created: new Date().toISOString()
          }
        ]
      };
      fs.writeFileSync(this.instancesConfigPath, JSON.stringify(initialData, null, 2), 'utf-8');
    }
  }

  getInstancesData() {
    try {
      if (fs.existsSync(this.instancesConfigPath)) {
        return JSON.parse(fs.readFileSync(this.instancesConfigPath, 'utf-8'));
      }
    } catch (e) {
      console.warn('Failed to read instances data:', e);
    }
    return { activeInstanceId: 'default-fabric', instances: [] };
  }

  saveInstancesData(data) {
    fs.writeFileSync(this.instancesConfigPath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  }

  getInstances() {
    return this.getInstancesData();
  }

  getActiveInstance() {
    const data = this.getInstancesData();
    let inst = data.instances.find(i => i.id === data.activeInstanceId);
    if (!inst && data.instances.length > 0) {
      inst = data.instances[0];
      data.activeInstanceId = inst.id;
      this.saveInstancesData(data);
    }
    return inst || {
      id: 'default-fabric',
      name: 'Fabric 1.20.1 (Default)',
      version: '1.20.1',
      loader: 'fabric',
      ramMin: 2,
      ramMax: 4,
      icon: 'cube'
    };
  }

  setActiveInstance(instanceId) {
    const data = this.getInstancesData();
    const exists = data.instances.some(i => i.id === instanceId);
    if (exists) {
      data.activeInstanceId = instanceId;
      this.saveInstancesData(data);
      return { success: true, activeInstance: this.getActiveInstance() };
    }
    return { success: false, error: 'Instance not found' };
  }

  createInstance({ name, version = '1.20.1', loader = 'fabric', ramMin = 2, ramMax = 4, icon = 'cube' }) {
    const data = this.getInstancesData();
    const slug = (name || 'instance').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    let id = `${slug}-${Date.now().toString(36)}`;

    const instanceDir = path.join(this.instancesDir, id);
    ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves'].forEach(sub => {
      const p = path.join(instanceDir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });

    const newInstance = {
      id,
      name: name || `Minecraft ${version}`,
      version,
      loader,
      ramMin: parseInt(ramMin, 10) || 2,
      ramMax: parseInt(ramMax, 10) || 4,
      icon: icon || 'cube',
      created: new Date().toISOString()
    };

    data.instances.push(newInstance);
    data.activeInstanceId = id;
    this.saveInstancesData(data);

    return { success: true, instance: newInstance, instances: data.instances };
  }

  updateInstance(instanceId, updates) {
    const data = this.getInstancesData();
    const idx = data.instances.findIndex(i => i.id === instanceId);
    if (idx !== -1) {
      data.instances[idx] = { ...data.instances[idx], ...updates };
      this.saveInstancesData(data);
      return { success: true, instance: data.instances[idx] };
    }
    return { success: false, error: 'Instance not found' };
  }

  deleteInstance(instanceId) {
    const data = this.getInstancesData();
    if (data.instances.length <= 1) {
      return { success: false, error: 'Cannot delete the only remaining instance.' };
    }

    data.instances = data.instances.filter(i => i.id !== instanceId);
    if (data.activeInstanceId === instanceId) {
      data.activeInstanceId = data.instances[0].id;
    }
    this.saveInstancesData(data);

    const instanceDir = path.join(this.instancesDir, instanceId);
    if (fs.existsSync(instanceDir)) {
      try {
        fs.rmSync(instanceDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to remove instance directory:', e);
      }
    }

    return { success: true, activeInstanceId: data.activeInstanceId, instances: data.instances };
  }

  getInstanceDir(instanceId) {
    const active = instanceId || this.getActiveInstance().id;
    const dir = path.join(this.instancesDir, active);
    ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves'].forEach(sub => {
      const p = path.join(dir, sub);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    return dir;
  }

  requestJson(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;

      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'AntiGravity-Launcher/6.5.5',
        ...(options.headers || {})
      };

      if (postData) {
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: options.method || (postData ? 'POST' : 'GET'),
        headers
      }, (res) => {
        let buf = '';
        res.on('data', chunk => buf += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(buf) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: buf });
          }
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
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

  async exchangeMicrosoftAuth(code) {
    console.log('[MC AUTH] Step 1: Exchanging code for Microsoft OAuth tokens...');
    const tokenParams = new URLSearchParams({
      client_id: '00000000402b5328',
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: 'https://login.live.com/oauth20_desktop.srf',
      scope: 'XboxLive.signin offline_access'
    }).toString();

    const msTokenRes = await this.requestJson('https://login.live.com/oauth20_token.srf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams
    });

    if (msTokenRes.status !== 200 || !msTokenRes.data?.access_token) {
      throw new Error(msTokenRes.data?.error_description || 'Failed to obtain Microsoft token');
    }
    const msAccessToken = msTokenRes.data.access_token;
    const msRefreshToken = msTokenRes.data.refresh_token;

    console.log('[MC AUTH] Step 2: Authenticating with Xbox Live (XBL)...');
    const xblRes = await this.requestJson('https://user.auth.xboxlive.com/user/authenticate', {
      method: 'POST',
      body: {
        Properties: {
          AuthMethod: 'RPS',
          SiteName: 'user.auth.xboxlive.com',
          RpsTicket: `d=${msAccessToken}`
        },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      }
    });

    if (xblRes.status !== 200 || !xblRes.data?.Token) {
      throw new Error('Failed to authenticate with Xbox Live');
    }
    const xblToken = xblRes.data.Token;
    const userHash = xblRes.data.DisplayClaims?.xui?.[0]?.uhs;
    const gamertagFromXbl = xblRes.data.DisplayClaims?.xui?.[0]?.gtg;

    console.log('[MC AUTH] Step 3: Acquiring XSTS token for Minecraft Services...');
    const xstsRes = await this.requestJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST',
      body: {
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xblToken]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      }
    });

    if (xstsRes.status !== 200 || !xstsRes.data?.Token) {
      if (xstsRes.data?.XErr === 2148916238) {
        throw new Error('This Microsoft account is under 18 and requires family settings approval.');
      }
      throw new Error('Failed to acquire XSTS security token for Minecraft');
    }
    const xstsToken = xstsRes.data.Token;
    const xstsUserHash = xstsRes.data.DisplayClaims?.xui?.[0]?.uhs || userHash;

    console.log('[MC AUTH] Step 4: Logging in to Minecraft Services...');
    const mcLoginRes = await this.requestJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      method: 'POST',
      body: {
        identityToken: `XBL3.0 x=${xstsUserHash};${xstsToken}`
      }
    });

    if (mcLoginRes.status !== 200 || !mcLoginRes.data?.access_token) {
      throw new Error('Failed to login to Minecraft Services with Xbox token');
    }
    const mcAccessToken = mcLoginRes.data.access_token;

    console.log('[MC AUTH] Step 5: Fetching official Minecraft Java Profile...');
    const profileRes = await this.requestJson('https://api.minecraftservices.com/minecraft/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${mcAccessToken}`
      }
    });

    let playerName = gamertagFromXbl || 'Player';
    let playerUuid = '00000000-0000-0000-0000-000000000000';
    let skinUrl = `https://crafatar.com/avatars/${playerName}?overlay`;

    if (profileRes.status === 200 && profileRes.data?.name) {
      playerName = profileRes.data.name;
      playerUuid = profileRes.data.id;
      skinUrl = `https://crafatar.com/avatars/${playerUuid}?overlay`;
      console.log(`[MC AUTH] Found Minecraft Java Profile: ${playerName} (${playerUuid})`);
    } else {
      console.log(`[MC AUTH] Using Xbox Gamertag: ${playerName}`);
    }

    const mclcAuth = {
      access_token: mcAccessToken,
      client_token: crypto.randomUUID(),
      uuid: playerUuid,
      name: playerName,
      meta: {
        xuid: xstsUserHash,
        type: 'msa',
        demo: false,
        refresh_token: msRefreshToken
      },
      user_properties: {}
    };

    const profile = {
      gamertag: playerName,
      uuid: playerUuid,
      skinUrl: skinUrl,
      token: mclcAuth,
      isOffline: false,
      lastLogin: new Date().toISOString()
    };

    this.saveProfile(profile);
    return profile;
  }

  async loginMicrosoft() {
    return new Promise((resolve) => {
      try {
        const { BrowserWindow } = require('electron');
        const authUrl = 'https://login.live.com/oauth20_authorize.srf?client_id=00000000402b5328&response_type=code&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf&scope=XboxLive.signin%20offline_access&prompt=select_account&mkt=en-US';

        console.log('[MC AUTH] Opening Microsoft login window:', authUrl);

        const loginWin = new BrowserWindow({
          width: 540,
          height: 700,
          title: "Log in with Microsoft - Minecraft",
          autoHideMenuBar: true,
          center: true,
          resizable: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:minecraft_auth'
          }
        });

        let finished = false;

        const checkRedirect = async (url) => {
          if (finished || !url) return;

          if (url.includes('code=') && (url.includes('login.live.com/oauth20_desktop.srf') || url.includes('oauth20_desktop.srf'))) {
            finished = true;
            try {
              const parsedUrl = new URL(url);
              const code = parsedUrl.searchParams.get('code');
              const error = parsedUrl.searchParams.get('error');
              const errorDesc = parsedUrl.searchParams.get('error_description');

              try { loginWin.destroy(); } catch (e) {}

              if (code) {
                const profile = await this.exchangeMicrosoftAuth(code);
                return resolve({ success: true, profile });
              } else {
                return resolve({ success: false, error: errorDesc || error || 'Login cancelled by user' });
              }
            } catch (err) {
              console.error('[MC AUTH] Token exchange error:', err);
              return resolve({ success: false, error: err.message });
            }
          }
        };

        loginWin.webContents.on('will-navigate', (e, url) => checkRedirect(url));
        loginWin.webContents.on('will-redirect', (e, url) => checkRedirect(url));
        loginWin.webContents.on('did-navigate', (e, url) => checkRedirect(url));
        loginWin.webContents.on('did-redirect-navigation', (e, url) => checkRedirect(url));
        loginWin.webContents.on('did-finish-load', () => checkRedirect(loginWin.webContents.getURL()));

        loginWin.on('close', () => {
          if (!finished) {
            finished = true;
            resolve({ success: false, error: 'Login window closed by user' });
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

  findInstalledJavaRuntimes() {
    const runtimes = [];
    const searchDirs = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
      'C:\\Program Files\\BellSoft',
      'C:\\Program Files\\Amazon Corretto',
      path.join(process.env.APPDATA || '', '.minecraft', 'runtime'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium')
    ];

    searchDirs.forEach(baseDir => {
      if (fs.existsSync(baseDir)) {
        try {
          const subdirs = fs.readdirSync(baseDir);
          subdirs.forEach(sub => {
            const fullPath = path.join(baseDir, sub);
            const javawExe = path.join(fullPath, 'bin', 'javaw.exe');
            const javaExe = path.join(fullPath, 'bin', 'java.exe');
            [javawExe, javaExe].forEach(exe => {
              if (fs.existsSync(exe)) {
                runtimes.push({ name: sub, path: exe });
              }
            });
          });
        } catch (e) {}
      }
    });

    return runtimes;
  }

  resolveJavaPath(mcVersion) {
    const runtimes = this.findInstalledJavaRuntimes();
    if (runtimes.length === 0) return null;

    const vParts = (mcVersion || '1.20.1').split('.').map(p => parseInt(p, 10));
    const minor = vParts[1] || 20;
    const patch = vParts[2] || 0;

    let targetMajor = '17';
    if (minor >= 21 || (minor === 20 && patch >= 5)) {
      targetMajor = '21';
    } else if (minor === 17) {
      targetMajor = '16';
    } else if (minor <= 16) {
      targetMajor = '8';
    }

    const exactMatch = runtimes.find(r => r.name.includes(targetMajor) || r.path.includes(targetMajor));
    if (exactMatch) return exactMatch.path;

    const javaw = runtimes.find(r => r.path.endsWith('javaw.exe'));
    return javaw ? javaw.path : runtimes[0].path;
  }

  async prepareLoader(loader, gameVersion, instanceDir) {
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

        // Save to global mcDir/versions
        const versionDir = path.join(this.mcDir, 'versions', versionId);
        if (!fs.existsSync(versionDir)) {
          fs.mkdirSync(versionDir, { recursive: true });
        }
        const versionJsonPath = path.join(versionDir, `${versionId}.json`);
        fs.writeFileSync(versionJsonPath, JSON.stringify(profileJson, null, 2), 'utf-8');

        // Save to instanceDir/versions
        if (instanceDir) {
          const instVerDir = path.join(instanceDir, 'versions', versionId);
          if (!fs.existsSync(instVerDir)) fs.mkdirSync(instVerDir, { recursive: true });
          fs.writeFileSync(path.join(instVerDir, `${versionId}.json`), JSON.stringify(profileJson, null, 2), 'utf-8');
        }

        console.log(`[MC LOADER] Installed Fabric version JSON: ${versionJsonPath}`);
        return { type: 'custom', customVersionId: versionId };
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

        if (instanceDir) {
          const instVerDir = path.join(instanceDir, 'versions', versionId);
          if (!fs.existsSync(instVerDir)) fs.mkdirSync(instVerDir, { recursive: true });
          fs.writeFileSync(path.join(instVerDir, `${versionId}.json`), JSON.stringify(profileJson, null, 2), 'utf-8');
        }

        console.log(`[MC LOADER] Installed Quilt version JSON: ${versionJsonPath}`);
        return { type: 'custom', customVersionId: versionId };
      }

      if (loader === 'forge') {
        console.log(`[MC LOADER] Preparing Forge for Minecraft ${gameVersion}...`);
        const promos = await this.fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        const promoVer = promos.promos?.[`${gameVersion}-recommended`] || promos.promos?.[`${gameVersion}-latest`];

        if (!promoVer) {
          throw new Error(`No Forge build found for Minecraft version ${gameVersion}.`);
        }

        const installerFileName = `forge-${gameVersion}-${promoVer}-installer.jar`;
        const localInstallerPath = path.join(this.forgeDir, installerFileName);

        if (!fs.existsSync(localInstallerPath)) {
          const downloadUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${gameVersion}-${promoVer}/${installerFileName}`;
          console.log(`[MC LOADER] Downloading Forge installer: ${downloadUrl}`);
          await this.downloadFileWithRedirects(downloadUrl, localInstallerPath);
        }

        console.log(`[MC LOADER] Forge installer ready: ${localInstallerPath}`);
        return { type: 'forge', installerPath: localInstallerPath };
      }

      if (loader === 'neoforge') {
        console.log(`[MC LOADER] Preparing NeoForge for Minecraft ${gameVersion}...`);
        const releasesManifest = await this.fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
        const versions = releasesManifest.versions || [];
        const matching = versions.filter(v => v.startsWith(gameVersion) || v.startsWith(gameVersion.replace('1.', '')));
        const latestNeo = matching.pop() || versions[versions.length - 1];

        if (latestNeo) {
          const installerFileName = `neoforge-${latestNeo}-installer.jar`;
          const localInstallerPath = path.join(this.forgeDir, installerFileName);
          if (!fs.existsSync(localInstallerPath)) {
            const downloadUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${latestNeo}/${installerFileName}`;
            console.log(`[MC LOADER] Downloading NeoForge installer: ${downloadUrl}`);
            await this.downloadFileWithRedirects(downloadUrl, localInstallerPath);
          }
          return { type: 'forge', installerPath: localInstallerPath };
        }
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
    if (version && projectType !== 'modpack') {
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
      const parentDir = path.dirname(destPath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

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

  async installModFile(fileUrl, fileName, projectType = 'mod', instanceId, onProgress) {
    const instDir = this.getInstanceDir(instanceId);
    let targetDir = path.join(instDir, 'mods');
    if (projectType === 'resourcepack') targetDir = path.join(instDir, 'resourcepacks');
    if (projectType === 'shader') targetDir = path.join(instDir, 'shaderpacks');

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    const destPath = path.join(targetDir, fileName);
    await this.downloadFileWithRedirects(fileUrl, destPath, onProgress);
    return { success: true, destPath, fileName };
  }

  async installModpack(mrpackUrl, modpackName, onProgress) {
    const tempDir = path.join(this.mcDir, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tempMrpackPath = path.join(tempDir, `pack_${Date.now()}.mrpack`);

    try {
      if (onProgress) onProgress({ phase: 'downloading_pack', text: 'Downloading Modpack archive...', percent: 10 });
      await this.downloadFileWithRedirects(mrpackUrl, tempMrpackPath);

      if (onProgress) onProgress({ phase: 'extracting_pack', text: 'Extracting Modpack manifest...', percent: 30 });
      const zip = new AdmZip(tempMrpackPath);
      const indexEntry = zip.getEntry('modrinth.index.json');
      if (!indexEntry) {
        throw new Error('Invalid .mrpack file: missing modrinth.index.json');
      }

      const indexData = JSON.parse(zip.readAsText(indexEntry));
      const gameVersion = indexData.dependencies?.minecraft || '1.20.1';
      let loader = 'fabric';
      if (indexData.dependencies?.['fabric-loader']) loader = 'fabric';
      else if (indexData.dependencies?.['forge']) loader = 'forge';
      else if (indexData.dependencies?.['neoforge']) loader = 'neoforge';
      else if (indexData.dependencies?.['quilt-loader']) loader = 'quilt';

      const finalName = indexData.name || modpackName || 'Modpack Instance';
      const createRes = this.createInstance({
        name: finalName,
        version: gameVersion,
        loader,
        ramMin: 2,
        ramMax: 6,
        icon: 'box-open'
      });

      const instance = createRes.instance;
      const instanceDir = this.getInstanceDir(instance.id);

      // Extract overrides
      const entries = zip.getEntries();
      entries.forEach(entry => {
        if (entry.entryName.startsWith('overrides/') && !entry.isDirectory) {
          const relativePath = entry.entryName.replace(/^overrides\//, '');
          const dest = path.join(instanceDir, relativePath);
          const destDir = path.dirname(dest);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(dest, entry.getData());
        }
      });

      // Download mod files
      const filesToDownload = (indexData.files || []).filter(f => !f.env || f.env.client !== 'unsupported');
      const totalMods = filesToDownload.length;

      for (let i = 0; i < totalMods; i++) {
        const file = filesToDownload[i];
        const dest = path.join(instanceDir, file.path);
        const downloadUrl = file.downloads?.[0];

        if (downloadUrl) {
          const percent = 30 + Math.round(((i + 1) / totalMods) * 65);
          if (onProgress) onProgress({
            phase: 'downloading_mods',
            text: `Downloading mods (${i + 1}/${totalMods}): ${path.basename(file.path)}`,
            percent
          });
          await this.downloadFileWithRedirects(downloadUrl, dest);
        }
      }

      try { fs.unlinkSync(tempMrpackPath); } catch (e) {}

      if (onProgress) onProgress({ phase: 'complete', text: 'Modpack ready to play!', percent: 100 });
      return { success: true, instance };
    } catch (err) {
      try { if (fs.existsSync(tempMrpackPath)) fs.unlinkSync(tempMrpackPath); } catch (e) {}
      console.error('[MC MODPACK] Installation failed:', err);
      return { success: false, error: err.message };
    }
  }

  getInstalledMods(instanceId) {
    const instDir = this.getInstanceDir(instanceId);
    const modsDir = path.join(instDir, 'mods');
    if (!fs.existsSync(modsDir)) return [];

    const files = fs.readdirSync(modsDir);
    return files
      .filter(f => f.endsWith('.jar') || f.endsWith('.jar.disabled') || f.endsWith('.zip') || f.endsWith('.mrpack'))
      .map(file => {
        const fullPath = path.join(modsDir, file);
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

  toggleMod(filename, enable, instanceId) {
    const instDir = this.getInstanceDir(instanceId);
    const modsDir = path.join(instDir, 'mods');
    const currentPath = path.join(modsDir, filename);
    if (!fs.existsSync(currentPath)) return { success: false, error: 'File not found' };

    let targetFilename;
    if (enable && filename.endsWith('.disabled')) {
      targetFilename = filename.replace(/\.disabled$/, '');
    } else if (!enable && !filename.endsWith('.disabled')) {
      targetFilename = filename + '.disabled';
    } else {
      return { success: true, filename };
    }

    const targetPath = path.join(modsDir, targetFilename);
    fs.renameSync(currentPath, targetPath);
    return { success: true, filename: targetFilename, enabled: enable };
  }

  deleteMod(filename, instanceId) {
    const instDir = this.getInstanceDir(instanceId);
    const filePath = path.join(instDir, 'mods', filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  }

  async getVersions() {
    try {
      const manifest = await this.fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const releases = manifest.versions
        .filter(v => v.type === 'release')
        .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
      return { success: true, latest: manifest.latest, versions: releases.slice(0, 50) };
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
      { id: '1.20.2', type: 'release' },
      { id: '1.20.1', type: 'release' },
      { id: '1.19.4', type: 'release' },
      { id: '1.19.2', type: 'release' },
      { id: '1.18.2', type: 'release' },
      { id: '1.17.1', type: 'release' },
      { id: '1.16.5', type: 'release' },
      { id: '1.15.2', type: 'release' },
      { id: '1.14.4', type: 'release' },
      { id: '1.12.2', type: 'release' },
      { id: '1.8.9', type: 'release' },
      { id: '1.7.10', type: 'release' }
    ];
  }

  async launchGame({ instanceId, version, loader, ramMin, ramMax, customJavaPath }, onProgress, onLog, onClose) {
    try {
      const { Client } = require('minecraft-launcher-core');
      const launcher = new Client();
      let profile = this.getProfile();

      if (!profile || !profile.token) {
        profile = this.setOfflineProfile('Player').profile;
      }

      const activeInst = this.getActiveInstance();
      const instId = instanceId || activeInst.id;
      const instVersion = version || activeInst.version || '1.20.1';
      const instLoader = loader || activeInst.loader || 'fabric';
      const instRamMin = ramMin || activeInst.ramMin || 2;
      const instRamMax = ramMax || activeInst.ramMax || 4;

      const instanceDir = this.getInstanceDir(instId);
      const resolvedJava = customJavaPath || this.resolveJavaPath(instVersion);

      const launchOpts = {
        clientPackage: null,
        authorization: profile.token,
        root: this.mcDir,
        overrides: {
          gameDirectory: instanceDir,
          cwd: instanceDir
        },
        version: {
          number: instVersion,
          type: "release"
        },
        memory: {
          max: `${instRamMax}G`,
          min: `${instRamMin}G`
        }
      };

      if (resolvedJava && fs.existsSync(resolvedJava)) {
        launchOpts.javaPath = resolvedJava;
        console.log(`[MC LAUNCH] Using resolved Java executable: ${resolvedJava}`);
      }

      if (instLoader && instLoader !== 'vanilla') {
        if (onProgress) onProgress({ type: 'loader', task: `Preparing ${instLoader} loader...`, percent: 15 });
        const loaderRes = await this.prepareLoader(instLoader, instVersion, instanceDir);
        if (loaderRes) {
          if (loaderRes.type === 'forge') {
            launchOpts.forge = loaderRes.installerPath;
            console.log(`[MC LAUNCH] Configured Forge installer: ${loaderRes.installerPath}`);
          } else if (loaderRes.type === 'custom') {
            launchOpts.version.custom = loaderRes.customVersionId;
            console.log(`[MC LAUNCH] Configured Custom Loader: ${loaderRes.customVersionId}`);
          }
        }
      }

      console.log('[MC LAUNCH] Starting launch with opts:', {
        instance: activeInst.name,
        instanceRoot: instanceDir,
        mcRoot: this.mcDir,
        version: launchOpts.version,
        forge: launchOpts.forge,
        memory: launchOpts.memory,
        user: profile.gamertag,
        isOffline: profile.isOffline,
        java: launchOpts.javaPath
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
      return { success: true, instanceName: activeInst.name };
    } catch (err) {
      console.error('[MC LAUNCH] Launch failed:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = MinecraftService;
