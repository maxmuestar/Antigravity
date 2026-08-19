const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const AdmZip = require('adm-zip');

class LocalSkinServer {
  constructor() {
    this.port = 28543;
    this.server = null;
    this.currentSkinBuffer = null;
    this.currentProfile = null;
  }

  setSkin(profile, skinBuffer) {
    this.currentProfile = profile;
    this.currentSkinBuffer = skinBuffer;
  }

  start() {
    if (this.server) return Promise.resolve(this.port);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = req.url.split('?')[0];

        if (url === '/' || url === '/api') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            meta: {
              serverName: "AntiGravity Offline Skin Station",
              implementationName: "antigravity-skin-station",
              version: "7.5.0"
            },
            skinDomains: ["127.0.0.1", "localhost", "minotar.net", "mc-heads.net"]
          }));
        }

        if (url.startsWith('/sessionserver/session/minecraft/profile/')) {
          const rawUuid = url.split('/').pop();
          const cleanUuid = rawUuid.replace(/-/g, '');
          const gamertag = this.currentProfile?.gamertag || 'Player';
          const model = this.currentProfile?.skinModel === 'slim' ? 'slim' : 'default';

          const skinUrl = `http://127.0.0.1:${this.port}/textures/${cleanUuid}.png`;
          const texturePayload = {
            timestamp: Date.now(),
            profileId: cleanUuid,
            profileName: gamertag,
            textures: {
              SKIN: {
                url: skinUrl,
                metadata: {
                  model: model
                }
              }
            }
          };

          const base64 = Buffer.from(JSON.stringify(texturePayload)).toString('base64');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            id: cleanUuid,
            name: gamertag,
            properties: [
              {
                name: "textures",
                value: base64
              }
            ]
          }));
        }

        if (url.startsWith('/textures/')) {
          if (this.currentSkinBuffer) {
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Content-Length': this.currentSkinBuffer.length
            });
            return res.end(this.currentSkinBuffer);
          }
        }

        res.writeHead(404);
        res.end();
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[MC SKIN SERVER] Local Yggdrasil mock running on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          this.port++;
          this.server.listen(this.port, '127.0.0.1');
        } else {
          console.warn('[MC SKIN SERVER] Server error:', err.message);
          resolve(this.port);
        }
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

class MinecraftService {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.mcDir = path.join(userDataDir, 'minecraft');
    this.instancesDir = path.join(this.mcDir, 'instances');
    this.forgeDir = path.join(this.mcDir, 'forge-installers');
    this.runtimeDir = path.join(this.mcDir, 'runtime');
    this.skinsDir = path.join(this.mcDir, 'skins');
    this.profilePath = path.join(this.mcDir, 'profile.json');
    this.accountsPath = path.join(this.mcDir, 'accounts.json');
    this.instancesConfigPath = path.join(this.mcDir, 'instances.json');
    this.modMetaCachePath = path.join(this.mcDir, 'mod_metadata_cache.json');

    this.skinServer = new LocalSkinServer();
    this.modMetaCache = this.loadModMetaCache();
    this.ensureDirs();
    this.initDefaultInstance();
  }

  ensureDirs() {
    [this.mcDir, this.instancesDir, this.forgeDir, this.runtimeDir, this.skinsDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  loadModMetaCache() {
    try {
      if (fs.existsSync(this.modMetaCachePath)) {
        return JSON.parse(fs.readFileSync(this.modMetaCachePath, 'utf-8'));
      }
    } catch (e) {}
    return {};
  }

  saveModMetaCache() {
    try {
      fs.writeFileSync(this.modMetaCachePath, JSON.stringify(this.modMetaCache), 'utf-8');
    } catch (e) {}
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
            jvmArgs: '-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M',
            customJavaPath: '',
            windowWidth: 1280,
            windowHeight: 720,
            fullscreen: false,
            serverAddress: '',
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
      icon: 'cube',
      jvmArgs: '',
      customJavaPath: '',
      windowWidth: 1280,
      windowHeight: 720,
      fullscreen: false,
      serverAddress: ''
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

  createInstance({
    name,
    version = '1.20.1',
    loader = 'fabric',
    ramMin = 2,
    ramMax = 4,
    icon = 'cube',
    jvmArgs = '',
    customJavaPath = '',
    windowWidth = 1280,
    windowHeight = 720,
    fullscreen = false,
    serverAddress = ''
  }) {
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
      jvmArgs: jvmArgs || '',
      customJavaPath: customJavaPath || '',
      windowWidth: parseInt(windowWidth, 10) || 1280,
      windowHeight: parseInt(windowHeight, 10) || 720,
      fullscreen: Boolean(fullscreen),
      serverAddress: serverAddress || '',
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
        'User-Agent': 'AntiGravity-Launcher/7.5.0',
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
      https.get(url, { headers: { 'User-Agent': 'AntiGravity-Launcher/7.5.0' } }, (res) => {
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

  getAccountsData() {
    if (fs.existsSync(this.accountsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8'));
        if (data && Array.isArray(data.accounts) && data.accounts.length > 0) {
          return data;
        }
      } catch (e) {}
    }

    // Migrate from legacy profile.json if present
    let initialAccounts = [];
    let initialActiveId = null;

    if (fs.existsSync(this.profilePath)) {
      try {
        const legacyProf = JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
        if (legacyProf && legacyProf.gamertag) {
          const accId = legacyProf.isOffline ? `offline-${legacyProf.uuid || legacyProf.gamertag}` : `ms-${legacyProf.uuid || legacyProf.gamertag}`;
          const migrated = {
            id: accId,
            type: legacyProf.isOffline ? 'offline' : 'microsoft',
            gamertag: legacyProf.gamertag,
            uuid: legacyProf.uuid || this.generateOfflineUuid(legacyProf.gamertag),
            skinUrl: legacyProf.skinUrl,
            bodyUrl: legacyProf.bodyUrl,
            rawSkinUrl: legacyProf.rawSkinUrl,
            skinSource: legacyProf.skinSource || 'username',
            skinValue: legacyProf.skinValue || legacyProf.gamertag,
            skinModel: legacyProf.skinModel || 'classic',
            token: legacyProf.token,
            isOffline: Boolean(legacyProf.isOffline),
            lastUsed: new Date().toISOString()
          };
          initialAccounts.push(migrated);
          initialActiveId = accId;
        }
      } catch (e) {}
    }

    if (initialAccounts.length === 0) {
      const defaultAcc = {
        id: 'offline-Player',
        type: 'offline',
        gamertag: 'Player',
        uuid: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
        skinUrl: 'https://mc-heads.net/avatar/Steve/128',
        bodyUrl: 'https://mc-heads.net/body/Steve/256',
        skinSource: 'preset',
        skinValue: 'Steve',
        skinModel: 'classic',
        isOffline: true,
        token: {
          access_token: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          client_token: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          uuid: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          name: 'Player',
          user_properties: '{}'
        },
        lastUsed: new Date().toISOString()
      };
      initialAccounts.push(defaultAcc);
      initialActiveId = defaultAcc.id;
    }

    const data = {
      activeAccountId: initialActiveId,
      accounts: initialAccounts
    };

    this.saveAccountsData(data);
    return data;
  }

  saveAccountsData(data) {
    try {
      fs.writeFileSync(this.accountsPath, JSON.stringify(data, null, 2), 'utf8');
      const active = data.accounts.find(a => a.id === data.activeAccountId) || data.accounts[0];
      if (active) {
        fs.writeFileSync(this.profilePath, JSON.stringify(active, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('Error saving accounts:', e);
    }
  }

  getActiveAccount() {
    const data = this.getAccountsData();
    let active = data.accounts.find(a => a.id === data.activeAccountId);
    if (!active && data.accounts.length > 0) {
      active = data.accounts[0];
      data.activeAccountId = active.id;
      this.saveAccountsData(data);
    }
    return active;
  }

  async setActiveAccount(accountId) {
    const data = this.getAccountsData();
    const target = data.accounts.find(a => a.id === accountId);
    if (!target) return { success: false, error: 'Account not found' };

    data.activeAccountId = accountId;
    target.lastUsed = new Date().toISOString();
    this.saveAccountsData(data);

    // If offline, also inject skinpack for active instance
    if (target.isOffline) {
      const activeInst = this.getActiveInstance();
      if (activeInst) {
        const instDir = this.getInstanceDir(activeInst.id);
        await this.injectOfflineSkinPack(instDir, target);
      }
    }

    return { success: true, activeAccount: target, accounts: data.accounts };
  }

  addOrUpdateAccount(account) {
    const data = this.getAccountsData();
    const idx = data.accounts.findIndex(a => a.id === account.id || (a.type === account.type && a.gamertag.toLowerCase() === account.gamertag.toLowerCase()));

    if (idx >= 0) {
      data.accounts[idx] = { ...data.accounts[idx], ...account, lastUsed: new Date().toISOString() };
      data.activeAccountId = data.accounts[idx].id;
    } else {
      account.lastUsed = new Date().toISOString();
      data.accounts.push(account);
      data.activeAccountId = account.id;
    }

    this.saveAccountsData(data);
    return { success: true, activeAccount: this.getActiveAccount(), accounts: data.accounts };
  }

  removeAccount(accountId) {
    const data = this.getAccountsData();
    data.accounts = data.accounts.filter(a => a.id !== accountId);

    if (data.accounts.length === 0) {
      const defaultAcc = {
        id: 'offline-Player',
        type: 'offline',
        gamertag: 'Player',
        uuid: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
        skinUrl: 'https://mc-heads.net/avatar/Steve/128',
        bodyUrl: 'https://mc-heads.net/body/Steve/256',
        skinSource: 'preset',
        skinValue: 'Steve',
        skinModel: 'classic',
        isOffline: true,
        token: {
          access_token: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          client_token: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          uuid: 'ec19ab1a-9b54-3aea-9df0-2bad2896c38d',
          name: 'Player',
          user_properties: '{}'
        },
        lastUsed: new Date().toISOString()
      };
      data.accounts.push(defaultAcc);
      data.activeAccountId = defaultAcc.id;
    } else if (data.activeAccountId === accountId) {
      data.activeAccountId = data.accounts[0].id;
    }

    this.saveAccountsData(data);
    return { success: true, activeAccount: this.getActiveAccount(), accounts: data.accounts };
  }

  getProfile() {
    return this.getActiveAccount();
  }

  saveProfile(profile) {
    return this.addOrUpdateAccount(profile);
  }

  logout() {
    const active = this.getActiveAccount();
    if (active) {
      this.removeAccount(active.id);
    }
    return { success: true, activeAccount: this.getActiveAccount() };
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
    let skinUrl = `https://mc-heads.net/avatar/${playerName}/128`;

    if (profileRes.status === 200 && profileRes.data?.name) {
      playerName = profileRes.data.name;
      playerUuid = profileRes.data.id;
      skinUrl = `https://mc-heads.net/avatar/${playerUuid}/128`;
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
      id: `ms-${playerUuid}`,
      type: 'microsoft',
      gamertag: playerName,
      uuid: playerUuid,
      skinUrl: skinUrl,
      bodyUrl: `https://mc-heads.net/body/${playerUuid}/256`,
      skinModel: 'classic',
      token: mclcAuth,
      isOffline: false,
      lastLogin: new Date().toISOString()
    };

    this.addOrUpdateAccount(profile);
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

  generateOfflineUuid(username) {
    const clean = (username || 'Player').trim() || 'Player';
    const md5 = crypto.createHash('md5').update('OfflinePlayer:' + clean).digest();
    md5[6] = (md5[6] & 0x0f) | 0x30;
    md5[8] = (md5[8] & 0x3f) | 0x80;
    const hex = md5.toString('hex');
    return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20, 12)}`;
  }

  async injectOfflineSkinPack(instanceDir, profile) {
    if (!instanceDir || !profile) return;
    try {
      const skinFile = profile.rawSkinUrl && fs.existsSync(profile.rawSkinUrl)
        ? profile.rawSkinUrl
        : path.join(this.skinsDir, `skin_${profile.gamertag}.png`);

      let skinBuffer = null;
      if (fs.existsSync(skinFile)) {
        skinBuffer = fs.readFileSync(skinFile);
      } else if (profile.skinDataUri && profile.skinDataUri.startsWith('data:image/png;base64,')) {
        skinBuffer = Buffer.from(profile.skinDataUri.replace(/^data:image\/png;base64,/, ''), 'base64');
      } else if (profile.skinValue || profile.gamertag) {
        try {
          const dlPath = path.join(this.skinsDir, `skin_${profile.gamertag}.png`);
          await this.downloadFileWithRedirects(`https://minotar.net/skin/${encodeURIComponent(profile.skinValue || profile.gamertag)}`, dlPath);
          if (fs.existsSync(dlPath)) skinBuffer = fs.readFileSync(dlPath);
        } catch (e) {}
      }

      if (!skinBuffer) return;

      // 1. CustomSkinLoader directories for modded instances
      const cslDir = path.join(instanceDir, 'CustomSkinLoader', 'skins');
      if (!fs.existsSync(cslDir)) fs.mkdirSync(cslDir, { recursive: true });
      fs.writeFileSync(path.join(cslDir, `${profile.gamertag}.png`), skinBuffer);
      if (profile.uuid) fs.writeFileSync(path.join(cslDir, `${profile.uuid}.png`), skinBuffer);

      // 2. Local skins folder
      const skinsSubDir = path.join(instanceDir, 'skins');
      if (!fs.existsSync(skinsSubDir)) fs.mkdirSync(skinsSubDir, { recursive: true });
      fs.writeFileSync(path.join(skinsSubDir, `${profile.gamertag}.png`), skinBuffer);

      // 3. Universal Resourcepack for Vanilla & Modded instances
      const packDir = path.join(instanceDir, 'resourcepacks');
      if (!fs.existsSync(packDir)) fs.mkdirSync(packDir, { recursive: true });

      const packZipPath = path.join(packDir, 'AntiGravity_SkinPack.zip');
      const zip = new AdmZip();
      const mcmeta = {
        pack: {
          pack_format: 15,
          description: `AntiGravity Skin Pack - ${profile.gamertag}`
        }
      };
      zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify(mcmeta, null, 2), 'utf8'));

      // Include all textures for wide and slim across all MC releases
      zip.addFile('assets/minecraft/textures/entity/player/wide/steve.png', skinBuffer);
      zip.addFile('assets/minecraft/textures/entity/player/slim/alex.png', skinBuffer);
      zip.addFile('assets/minecraft/textures/entity/player/wide/alex.png', skinBuffer);
      zip.addFile('assets/minecraft/textures/entity/player/slim/steve.png', skinBuffer);
      zip.addFile('assets/minecraft/textures/entity/steve.png', skinBuffer);
      zip.addFile('assets/minecraft/textures/entity/alex.png', skinBuffer);
      zip.writeZip(packZipPath);

      // 4. Force enable in options.txt
      const optionsPath = path.join(instanceDir, 'options.txt');
      let optionsContent = '';
      if (fs.existsSync(optionsPath)) {
        optionsContent = fs.readFileSync(optionsPath, 'utf8');
      }

      const packEntry = '"file/AntiGravity_SkinPack.zip"';
      if (optionsContent.includes('resourcePacks:[')) {
        if (!optionsContent.includes(packEntry)) {
          optionsContent = optionsContent.replace('resourcePacks:[', `resourcePacks:[${packEntry},`);
        }
      } else {
        optionsContent += `\nresourcePacks:[${packEntry},"vanilla"]\n`;
      }
      fs.writeFileSync(optionsPath, optionsContent, 'utf8');
      console.log(`[MC SKIN] Successfully injected offline skin for ${profile.gamertag} into: ${instanceDir}`);
    } catch (e) {
      console.warn('[MC SKIN] Could not inject skinpack:', e.message);
    }
  }

  setOfflineProfile(username = 'Player') {
    const cleanName = (username || 'Player').trim() || 'Player';
    const uuid = this.generateOfflineUuid(cleanName);
    const token = {
      access_token: uuid,
      client_token: uuid,
      uuid: uuid,
      name: cleanName,
      user_properties: '{}'
    };

    const profile = {
      gamertag: cleanName,
      uuid: uuid,
      skinUrl: `https://mc-heads.net/avatar/${encodeURIComponent(cleanName)}/128`,
      bodyUrl: `https://mc-heads.net/body/${encodeURIComponent(cleanName)}/256`,
      rawSkinUrl: `https://minotar.net/skin/${encodeURIComponent(cleanName)}`,
      skinSource: 'username',
      skinValue: cleanName,
      skinModel: 'classic',
      token: token,
      isOffline: true,
      lastLogin: new Date().toISOString()
    };

    this.saveProfile(profile);
    return { success: true, profile };
  }

  async setOfflineProfileWithSkin({ username = 'Player', skinSource = 'username', skinValue = '', skinModel = 'classic', skinDataUri = null }) {
    const cleanName = (username || 'Player').trim() || 'Player';
    const uuid = this.generateOfflineUuid(cleanName);
    const token = {
      access_token: uuid,
      client_token: uuid,
      uuid: uuid,
      name: cleanName,
      user_properties: '{}'
    };

    let skinUrl = `https://mc-heads.net/avatar/${encodeURIComponent(cleanName)}/128`;
    let bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(cleanName)}/256`;
    let rawSkinUrl = `https://minotar.net/skin/${encodeURIComponent(cleanName)}`;
    const localSavedSkinPath = path.join(this.skinsDir, `skin_${cleanName}.png`);

    if (skinSource === 'preset') {
      const presetName = skinValue || 'Steve';
      skinUrl = `https://mc-heads.net/avatar/${encodeURIComponent(presetName)}/128`;
      bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(presetName)}/256`;
      rawSkinUrl = `https://minotar.net/skin/${encodeURIComponent(presetName)}`;
      try {
        await this.downloadFileWithRedirects(rawSkinUrl, localSavedSkinPath);
      } catch (e) {}
    } else if (skinSource === 'username' && skinValue) {
      skinUrl = `https://mc-heads.net/avatar/${encodeURIComponent(skinValue)}/128`;
      bodyUrl = `https://mc-heads.net/body/${encodeURIComponent(skinValue)}/256`;
      rawSkinUrl = `https://minotar.net/skin/${encodeURIComponent(skinValue)}`;
      try {
        await this.downloadFileWithRedirects(rawSkinUrl, localSavedSkinPath);
      } catch (e) {}
    } else if (skinSource === 'custom' && skinDataUri) {
      const base64Data = skinDataUri.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(localSavedSkinPath, Buffer.from(base64Data, 'base64'));
      skinUrl = skinDataUri;
      bodyUrl = skinDataUri;
      rawSkinUrl = localSavedSkinPath;
    }

    const profile = {
      id: `offline-${uuid}`,
      type: 'offline',
      gamertag: cleanName,
      uuid: uuid,
      skinUrl,
      bodyUrl,
      rawSkinUrl: localSavedSkinPath,
      skinSource: skinSource || 'username',
      skinValue: skinValue || cleanName,
      skinModel: skinModel || 'classic',
      token,
      isOffline: true,
      lastLogin: new Date().toISOString()
    };

    this.addOrUpdateAccount(profile);

    const activeInst = this.getActiveInstance();
    if (activeInst) {
      const instDir = this.getInstanceDir(activeInst.id);
      await this.injectOfflineSkinPack(instDir, profile);
    }

    return { success: true, profile, accounts: this.getAccountsData().accounts };
  }

  findInstalledJavaRuntimes() {
    const runtimes = [];
    const searchDirs = [
      path.join(this.runtimeDir, 'java-21'),
      path.join(this.runtimeDir, 'java-17'),
      path.join(this.runtimeDir, 'java-8'),
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
          const checkExe = (targetDir, name) => {
            const javaw = path.join(targetDir, 'bin', 'javaw.exe');
            const java = path.join(targetDir, 'bin', 'java.exe');
            if (fs.existsSync(javaw)) runtimes.push({ name, path: javaw });
            else if (fs.existsSync(java)) runtimes.push({ name, path: java });
          };

          checkExe(baseDir, path.basename(baseDir));

          const subdirs = fs.readdirSync(baseDir);
          subdirs.forEach(sub => {
            const fullPath = path.join(baseDir, sub);
            checkExe(fullPath, sub);
          });
        } catch (e) {}
      }
    });

    return runtimes;
  }

  async ensureJavaRuntime(targetMajor = 17, onProgress) {
    const targetDir = path.join(this.runtimeDir, `java-${targetMajor}`);
    const targetJavaw = path.join(targetDir, 'bin', 'javaw.exe');

    if (fs.existsSync(targetJavaw)) {
      return targetJavaw;
    }

    console.log(`[MC JAVA] Downloading isolated Java ${targetMajor} JRE from Adoptium...`);
    const tempZip = path.join(this.runtimeDir, `jre_${targetMajor}_temp.zip`);

    try {
      const adoptiumApiUrl = `https://api.adoptium.net/v3/binary/latest/${targetMajor}/ga/windows/x64/jre/hotspot/normal/eclipse`;

      if (onProgress) onProgress({ type: 'java', task: `Downloading Java ${targetMajor} portable runtime...`, percent: 20 });
      await this.downloadFileWithRedirects(adoptiumApiUrl, tempZip, (p) => {
        if (onProgress) onProgress({
          type: 'java',
          task: `Downloading Java ${targetMajor} runtime (${p.received} / ${p.total} MB)...`,
          percent: p.percent
        });
      });

      if (onProgress) onProgress({ type: 'java', task: `Extracting Java ${targetMajor} runtime...`, percent: 85 });
      const zip = new AdmZip(tempZip);
      const tempExtractDir = path.join(this.runtimeDir, `extract_${Date.now()}`);
      zip.extractAllTo(tempExtractDir, true);

      // Locate the root folder containing bin/javaw.exe
      const extractedFolders = fs.readdirSync(tempExtractDir);
      let sourceDir = tempExtractDir;
      if (extractedFolders.length === 1 && fs.statSync(path.join(tempExtractDir, extractedFolders[0])).isDirectory()) {
        sourceDir = path.join(tempExtractDir, extractedFolders[0]);
      }

      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(sourceDir, targetDir);

      try {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        fs.unlinkSync(tempZip);
      } catch (e) {}

      console.log(`[MC JAVA] Successfully installed Java ${targetMajor} to: ${targetJavaw}`);
      return targetJavaw;
    } catch (err) {
      try { if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip); } catch (e) {}
      console.error(`[MC JAVA] Failed to auto-download Java ${targetMajor}:`, err);
      return null;
    }
  }

  determineJavaMajor(mcVersion) {
    if (!mcVersion) return 17;
    const clean = String(mcVersion).replace(/[^0-9.]/g, '');
    const parts = clean.split('.').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
    if (parts.length === 0) return 17;

    const major = parts[0];
    const minor = parts.length > 1 ? parts[1] : 0;
    const patch = parts.length > 2 ? parts[2] : 0;

    // Standard Minecraft format '1.x.y'
    if (major === 1) {
      if (minor >= 21 || (minor === 20 && patch >= 5)) {
        return 21;
      } else if (minor >= 17) {
        return 17;
      } else {
        return 8;
      }
    }

    // Modern / snapshot / custom format where major >= 21 (e.g. '26.1.2', '24w...', '21.0')
    if (major >= 21) {
      return 21;
    } else if (major >= 17) {
      return 17;
    } else {
      return 8;
    }
  }

  async resolveJavaPath(mcVersion, onProgress) {
    let targetMajor = this.determineJavaMajor(mcVersion);

    // Attempt to query Mojang version manifest for exact javaVersion if available
    try {
      const manifest = await this.fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const vEntry = manifest?.versions?.find(v => v.id === mcVersion);
      if (vEntry?.url) {
        const vData = await this.fetchJson(vEntry.url);
        if (vData?.javaVersion?.majorVersion) {
          targetMajor = vData.javaVersion.majorVersion;
        }
      }
    } catch (e) {}

    console.log(`[MC JAVA] Target Java version for Minecraft ${mcVersion}: Java ${targetMajor}`);

    // 1. Check existing isolated AntiGravity runtime
    const isolatedJavaw = path.join(this.runtimeDir, `java-${targetMajor}`, 'bin', 'javaw.exe');
    if (fs.existsSync(isolatedJavaw)) {
      console.log(`[MC JAVA] Using isolated AntiGravity Java ${targetMajor}: ${isolatedJavaw}`);
      return isolatedJavaw;
    }

    // 2. Check system runtimes that explicitly match targetMajor
    const runtimes = this.findInstalledJavaRuntimes();
    const exactMatch = runtimes.find(r => {
      const nameOrPath = (r.name + ' ' + r.path).toLowerCase();
      if (targetMajor === 21) {
        return (nameOrPath.includes('21') || nameOrPath.includes('jdk-21') || nameOrPath.includes('jre-21')) &&
               !nameOrPath.includes('1.8') && !nameOrPath.includes('jre8') && !nameOrPath.includes('17');
      }
      if (targetMajor === 17) {
        return (nameOrPath.includes('17') || nameOrPath.includes('jdk-17') || nameOrPath.includes('jre-17')) &&
               !nameOrPath.includes('1.8') && !nameOrPath.includes('jre8') && !nameOrPath.includes('21');
      }
      if (targetMajor === 8) {
        return nameOrPath.includes('1.8') || nameOrPath.includes('jre8') || nameOrPath.includes('jdk8') || nameOrPath.includes('java-8');
      }
      return false;
    });

    if (exactMatch && fs.existsSync(exactMatch.path)) {
      console.log(`[MC JAVA] Using verified system Java ${targetMajor}: ${exactMatch.path}`);
      return exactMatch.path;
    }

    // 3. Auto-download isolated Adoptium Java runtime specifically for targetMajor
    console.log(`[MC JAVA] Downloading isolated portable Java ${targetMajor} for AntiGravity...`);
    const downloaded = await this.ensureJavaRuntime(targetMajor, onProgress);
    if (downloaded && fs.existsSync(downloaded)) {
      return downloaded;
    }

    // 4. Fallback only if download failed
    const fallbackJavaw = runtimes.find(r => r.path.endsWith('javaw.exe'));
    return fallbackJavaw ? fallbackJavaw.path : (runtimes[0]?.path || null);
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

  extractModMetadata(jarPath) {
    const stats = fs.statSync(jarPath);
    const cacheKey = `${jarPath}:${stats.mtimeMs}`;

    if (this.modMetaCache[cacheKey]) {
      return this.modMetaCache[cacheKey];
    }

    const baseName = path.basename(jarPath).replace(/\.disabled$/, '');
    const meta = {
      id: baseName.replace(/\.jar$/, ''),
      name: baseName.replace(/\.jar$/, ''),
      version: '',
      description: '',
      authors: [],
      iconDataUri: null,
      loader: 'unknown'
    };

    try {
      const zip = new AdmZip(jarPath);

      // Fabric / Quilt metadata
      const fabricEntry = zip.getEntry('fabric.mod.json') || zip.getEntry('quilt.mod.json');
      if (fabricEntry) {
        const data = JSON.parse(zip.readAsText(fabricEntry));
        meta.id = data.id || meta.id;
        meta.name = data.name || meta.name;
        meta.version = data.version || meta.version;
        meta.description = data.description || meta.description;
        if (Array.isArray(data.authors)) {
          meta.authors = data.authors.map(a => typeof a === 'string' ? a : a.name);
        } else if (typeof data.authors === 'string') {
          meta.authors = [data.authors];
        }

        const iconPath = typeof data.icon === 'string' ? data.icon : data.icon?.['64'] || data.icon?.['128'] || data.icon?.['32'];
        if (iconPath) {
          const iconEntry = zip.getEntry(iconPath.replace(/^\//, ''));
          if (iconEntry) {
            meta.iconDataUri = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
          }
        }
        meta.loader = 'fabric';
      } else {
        // Forge mods.toml
        const modsToml = zip.getEntry('META-INF/mods.toml');
        if (modsToml) {
          const text = zip.readAsText(modsToml);
          const modIdMatch = text.match(/modId\s*=\s*"([^"]+)"/);
          const nameMatch = text.match(/displayName\s*=\s*"([^"]+)"/);
          const versionMatch = text.match(/version\s*=\s*"([^"]+)"/);
          const descMatch = text.match(/description\s*=\s*'''([^']+)'''/) || text.match(/description\s*=\s*"([^"]+)"/);
          const authorsMatch = text.match(/authors\s*=\s*"([^"]+)"/);
          const logoMatch = text.match(/logoFile\s*=\s*"([^"]+)"/);

          if (modIdMatch) meta.id = modIdMatch[1];
          if (nameMatch) meta.name = nameMatch[1];
          if (versionMatch && versionMatch[1] !== '${file.jarVersion}') meta.version = versionMatch[1];
          if (descMatch) meta.description = descMatch[1].trim();
          if (authorsMatch) meta.authors = [authorsMatch[1]];
          if (logoMatch) {
            const logoEntry = zip.getEntry(logoMatch[1]) || zip.getEntry(`META-INF/${logoMatch[1]}`);
            if (logoEntry) {
              meta.iconDataUri = `data:image/png;base64,${logoEntry.getData().toString('base64')}`;
            }
          }
          meta.loader = 'forge';
        } else {
          // Legacy mcmod.info
          const mcmodInfo = zip.getEntry('mcmod.info');
          if (mcmodInfo) {
            try {
              const data = JSON.parse(zip.readAsText(mcmodInfo));
              const m = Array.isArray(data) ? data[0] : data?.modList?.[0] || data;
              if (m) {
                meta.id = m.modid || meta.id;
                meta.name = m.name || meta.name;
                meta.version = m.version || meta.version;
                meta.description = m.description || meta.description;
                meta.authors = m.authorList || [];
                meta.loader = 'forge';
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    this.modMetaCache[cacheKey] = meta;
    this.saveModMetaCache();
    return meta;
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
        const meta = this.extractModMetadata(fullPath);

        return {
          filename: file,
          cleanName,
          name: meta.name || cleanName,
          id: meta.id,
          version: meta.version || '',
          description: meta.description || '',
          authors: meta.authors || [],
          iconDataUri: meta.iconDataUri,
          loader: meta.loader || 'unknown',
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

  toggleAllMods(enable, instanceId) {
    const instDir = this.getInstanceDir(instanceId);
    const modsDir = path.join(instDir, 'mods');
    if (!fs.existsSync(modsDir)) return { success: true };

    const files = fs.readdirSync(modsDir);
    files.forEach(file => {
      this.toggleMod(file, enable, instanceId);
    });

    return { success: true };
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

  installLocalJars(filePaths, instanceId) {
    const instDir = this.getInstanceDir(instanceId);
    const targetDir = path.join(instDir, 'mods');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    let count = 0;
    (filePaths || []).forEach(src => {
      if (fs.existsSync(src) && (src.endsWith('.jar') || src.endsWith('.zip'))) {
        const dest = path.join(targetDir, path.basename(src));
        fs.copyFileSync(src, dest);
        count++;
      }
    });

    return { success: true, count };
  }

  async checkModUpdates(instanceId) {
    const mods = this.getInstalledMods(instanceId);
    const hashes = {};

    mods.forEach(m => {
      const instDir = this.getInstanceDir(instanceId);
      const p = path.join(instDir, 'mods', m.filename);
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
        const sha512 = crypto.createHash('sha512').update(buf).digest('hex');
        hashes[sha1] = { mod: m, sha512 };
      }
    });

    const sha1List = Object.keys(hashes);
    if (sha1List.length === 0) return { updates: [] };

    try {
      const res = await this.requestJson('https://api.modrinth.com/v2/version_files', {
        method: 'POST',
        body: { hashes: sha1List, algorithm: 'sha1' }
      });

      const updates = [];
      if (res.status === 200 && res.data) {
        for (const [h, versionData] of Object.entries(res.data)) {
          const modItem = hashes[h]?.mod;
          if (modItem && versionData?.project_id) {
            updates.push({
              filename: modItem.filename,
              name: modItem.name,
              currentVersion: versionData.version_number,
              projectId: versionData.project_id
            });
          }
        }
      }

      return { success: true, updates };
    } catch (e) {
      console.warn('Mod update check failed:', e.message);
      return { success: false, updates: [] };
    }
  }

  async uploadLogToMclogs(logText) {
    try {
      const postData = 'content=' + encodeURIComponent(logText || 'Empty log.');
      const res = await this.requestJson('https://api.mclo.gs/1/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        },
        body: postData
      });

      if (res.status === 200 && res.data?.url) {
        return { success: true, url: res.data.url, raw: res.data.raw };
      }
      return { success: false, error: 'Could not upload log to mclo.gs' };
    } catch (err) {
      return { success: false, error: err.message };
    }
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

  async getModrinthProject(projectId) {
    const url = `https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`;
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
          headers: { 'User-Agent': 'AntiGravity-Launcher/7.5.0' }
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

  async installModpack(mrpackUrl, modpackName, onProgress, targetInstanceId) {
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

      let instance;
      if (targetInstanceId) {
        const instances = this.getInstancesData().instances;
        instance = instances.find(i => i.id === targetInstanceId);
      }

      if (!instance) {
        const finalName = indexData.name || modpackName || 'Modpack Instance';
        const createRes = this.createInstance({
          name: finalName,
          version: gameVersion,
          loader,
          ramMin: 2,
          ramMax: 6,
          icon: 'box-open'
        });
        instance = createRes.instance;
      }

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

  async ensureAuthlibInjector() {
    const jarPath = path.join(this.runtimeDir, 'authlib-injector.jar');
    if (fs.existsSync(jarPath) && fs.statSync(jarPath).size > 100000) {
      return jarPath;
    }

    const downloadUrl = 'https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar';
    console.log(`[MC SKIN] Downloading authlib-injector agent from: ${downloadUrl}`);
    try {
      await this.downloadFileWithRedirects(downloadUrl, jarPath);
      return jarPath;
    } catch (e) {
      console.warn('[MC SKIN] Could not download authlib-injector:', e.message);
      return null;
    }
  }

  async launchGame({ instanceId, version, loader, ramMin, ramMax, customJavaPath }, onProgress, onLog, onClose) {
    try {
      const { Client } = require('minecraft-launcher-core');
      const launcher = new Client();
      let profile = this.getProfile();

      if (!profile || !profile.token || !profile.token.access_token) {
        profile = this.setOfflineProfile(profile?.gamertag || 'Player').profile;
      }

      const activeInst = this.getActiveInstance();
      const instId = instanceId || activeInst.id;
      const instVersion = version || activeInst.version || '1.20.1';
      const instLoader = loader || activeInst.loader || 'fabric';
      const instRamMin = ramMin || activeInst.ramMin || 2;
      const instRamMax = ramMax || activeInst.ramMax || 4;
      const customJava = customJavaPath || activeInst.customJavaPath;
      const customJvm = activeInst.jvmArgs ? activeInst.jvmArgs.split(' ').filter(Boolean) : [];

      const instanceDir = this.getInstanceDir(instId);

      if (profile.isOffline) {
        const cleanName = profile.gamertag || 'Player';
        const offlineUuid = this.generateOfflineUuid(cleanName);
        profile.token = {
          access_token: offlineUuid,
          client_token: offlineUuid,
          uuid: offlineUuid,
          name: cleanName,
          user_properties: '{}'
        };

        // 1. Inject local resource pack & CustomSkinLoader
        await this.injectOfflineSkinPack(instanceDir, profile);

        // 2. Start local Yggdrasil skin server and attach authlib-injector
        try {
          const skinFile = profile.rawSkinUrl && fs.existsSync(profile.rawSkinUrl)
            ? profile.rawSkinUrl
            : path.join(this.skinsDir, `skin_${cleanName}.png`);

          let skinBuffer = null;
          if (fs.existsSync(skinFile)) {
            skinBuffer = fs.readFileSync(skinFile);
          } else if (profile.skinDataUri && profile.skinDataUri.startsWith('data:image/png;base64,')) {
            skinBuffer = Buffer.from(profile.skinDataUri.replace(/^data:image\/png;base64,/, ''), 'base64');
          }

          if (skinBuffer) {
            await this.skinServer.start();
            this.skinServer.setSkin(profile, skinBuffer);

            const authlibJar = await this.ensureAuthlibInjector();
            if (authlibJar && fs.existsSync(authlibJar)) {
              const agentArg = `-javaagent:${authlibJar}=http://127.0.0.1:${this.skinServer.port}`;
              if (!customJvm.some(arg => arg.includes('authlib-injector'))) {
                customJvm.push(agentArg);
                console.log(`[MC SKIN] Attached authlib-injector javaagent: ${agentArg}`);
              }
            }
          }
        } catch (skinErr) {
          console.warn('[MC SKIN] Could not setup local skin server:', skinErr.message);
        }
      }

      if (onProgress) onProgress({ type: 'java', task: 'Checking & resolving Java runtime...', percent: 5 });
      const resolvedJava = (customJava && fs.existsSync(customJava)) ? customJava : await this.resolveJavaPath(instVersion, onProgress);

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
        },
        customArgs: customJvm
      };

      // Game window resolution
      if (activeInst.windowWidth || activeInst.windowHeight || activeInst.fullscreen) {
        launchOpts.window = {
          width: activeInst.windowWidth || 1280,
          height: activeInst.windowHeight || 720,
          fullscreen: Boolean(activeInst.fullscreen)
        };
      }

      // Server auto-connect
      if (activeInst.serverAddress && activeInst.serverAddress.trim()) {
        const sParts = activeInst.serverAddress.trim().split(':');
        launchOpts.server = {
          host: sParts[0],
          port: sParts[1] ? parseInt(sParts[1], 10) : 25565
        };
      }

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
        java: launchOpts.javaPath,
        window: launchOpts.window,
        server: launchOpts.server
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
