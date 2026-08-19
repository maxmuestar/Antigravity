// State Management
let appState = {
  activeTab: 'library', // 'library', 'config', 'browser'
  websites: [],
  library: [],
  searchQuery: '',
  activeFilter: 'all', // 'all', 'favorites', 'recent'
  activeSort: 'recent', // 'recent', 'name_asc', 'name_desc', 'playtime', 'added'
  activeDownloads: {},
  pendingSelectionGameId: null,
  pendingLaunchGameId: null,
  bigPictureActive: false,
  bigPictureSelectedIndex: 0,
  bigPictureControllerFrame: null,
  lastControllerInputAt: 0,
  activeWebsite: null,
  lastAllowedUrl: ''
};

const controllerRepeatMs = 220;
const controllerAxisThreshold = 0.55;

// ========================================================
// Procedural Console Audio Synthesizer (Web Audio API)
// ========================================================
class SoundManager {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem('uiSoundEnabled') !== 'false';
  }

  initContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('uiSoundEnabled', this.enabled ? 'true' : 'false');
    this.updateToggleIcon();
    if (this.enabled) {
      this.play('click');
      showToast('Interface Audio ON', 'Console UI sound effects enabled.', 'info', 2000);
    } else {
      showToast('Interface Audio MUTED', 'Console UI sound effects disabled.', 'warning', 2000);
    }
  }

  updateToggleIcon() {
    const btn = document.getElementById('btn-sound-toggle');
    const icon = document.getElementById('sound-toggle-icon');
    if (!btn || !icon) return;
    if (this.enabled) {
      btn.className = 'sound-toggle-btn';
      icon.className = 'fa-solid fa-volume-high';
    } else {
      btn.className = 'sound-toggle-btn muted';
      icon.className = 'fa-solid fa-volume-xmark';
    }
  }

  play(soundType) {
    if (!this.enabled) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;

      if (soundType === 'hover') {
        // PS5 / Nintendo Switch soft menu cursor tick
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.035);
        gain.gain.setValueAtTime(0.045, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.04);
      } else if (soundType === 'click') {
        // Steam Deck tactile menu selection snap
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.05);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (soundType === 'launch') {
        // Xbox / PS5 cinematic game launch power surge
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc1.type = 'sine';
        osc2.type = 'triangle';
        osc1.frequency.setValueAtTime(180, now);
        osc1.frequency.exponentialRampToValueAtTime(720, now + 0.28);
        osc2.frequency.setValueAtTime(360, now);
        osc2.frequency.exponentialRampToValueAtTime(1080, now + 0.28);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.3);
        osc2.stop(now + 0.3);
      } else if (soundType === 'big_picture') {
        // Deep cosmic chord swell
        [329.63, 440.00, 659.25].forEach((freq, i) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + (i * 0.04));
          gain.gain.setValueAtTime(0.08, now + (i * 0.04));
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + (i * 0.04));
          osc.stop(now + 0.46);
        });
      } else if (soundType === 'complete') {
        // Triumphant download chime (C5 -> E5 -> G5)
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          const startTime = now + (idx * 0.08);
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.10, startTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.25);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(startTime);
          osc.stop(startTime + 0.26);
        });
      }
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }
}

const sfx = new SoundManager();

// Toast Notification Engine
function showToast(title, desc = '', type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let iconClass = 'fa-circle-info';
  if (type === 'success') iconClass = 'fa-circle-check';
  else if (type === 'warning') iconClass = 'fa-triangle-exclamation';
  else if (type === 'error') iconClass = 'fa-circle-xmark';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="toast-desc">${escapeHtml(desc)}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 400);
  }, duration);
}

// Helpers for playtime and dates
function formatPlaytime(minutes) {
  if (!minutes || minutes <= 0) return 'New';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatLastPlayed(isoDate) {
  if (!isoDate) return 'Never played';
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return 'Played just now';
  if (diffHours < 24) return 'Played today';
  if (diffHours < 48) return 'Played yesterday';
  const days = Math.floor(diffHours / 24);
  if (days < 30) return `Played ${days}d ago`;
  return `Played on ${new Date(isoDate).toLocaleDateString()}`;
}

async function updateStorageWidget() {
  try {
    const stats = await window.api.getStorageStats();
    if (stats && stats.success) {
      const countEl = document.getElementById('storage-game-count');
      const usedEl = document.getElementById('storage-used-text');
      const barFill = document.getElementById('storage-bar-fill');

      if (countEl) countEl.innerText = `${stats.gameCount} ${stats.gameCount === 1 ? 'game' : 'games'}`;
      
      if (usedEl) {
        if (stats.driveFreeGB && stats.driveFreeGB !== '0') {
          usedEl.innerText = `${stats.totalSizeGB} GB • ${stats.driveFreeGB} GB free (${stats.driveLetter})`;
        } else {
          usedEl.innerText = `${stats.totalSizeGB} GB games used`;
        }
      }
      
      if (barFill) {
        const pct = stats.driveUsedPercent || Math.min(100, Math.max(5, Math.round((parseFloat(stats.totalSizeGB) / 250) * 100)));
        barFill.style.width = `${pct}%`;
        barFill.title = `Schijf ${stats.driveLetter || 'C:'} is ${pct}% vol (${stats.driveFreeGB || 0} GB vrij van ${stats.driveTotalGB || 0} GB)`;
      }
    }
  } catch (e) {
    console.error('Failed to update storage stats widget:', e);
  }
}

// Elements
const webview = document.getElementById('game-webview');
const websitesContainer = document.getElementById('websites-container');
const manageSitesList = document.getElementById('manage-sites-list');
const gamesGrid = document.getElementById('games-grid');
const libraryEmpty = document.getElementById('library-empty');
const downloadsPanel = document.getElementById('downloads-panel');
const downloadsList = document.getElementById('downloads-list');
const downloadCountBadge = document.getElementById('download-count');
const bigPictureOverlay = document.getElementById('big-picture-overlay');
const bigPictureRail = document.getElementById('big-picture-rail');
const bigPictureCover = document.getElementById('big-picture-cover');
const bigPictureTitle = document.getElementById('big-picture-title');
const bigPicturePath = document.getElementById('big-picture-path');

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const modalDownloadDone = document.getElementById('modal-download-done');
const modalSelectExe = document.getElementById('modal-select-exe');
const modalNoExe = document.getElementById('modal-no-exe');
const modalEditGame = document.getElementById('modal-edit-game');
const modalDeleteConfirm = document.getElementById('modal-delete-confirm');
const modalSteamWarning = document.getElementById('modal-steam-warning');
const modalAntivirusReminder = document.getElementById('modal-antivirus-reminder');
const modalPasswordRequired = document.getElementById('modal-password-required');
const modalAppUpdate = document.getElementById('modal-app-update');
let currentUpdateData = null;

// Tab buttons
const btnLibrary = document.getElementById('btn-library');
const btnMinecraft = document.getElementById('btn-minecraft');
const btnConfig = document.getElementById('btn-config');

window.api.onLaunchGameRequested((gameId) => {
  launchGameWithSteamCheck(gameId);
});

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Load data
  await loadWebsites();
  await loadLibrary();
  
  // Attach general listeners
  setupTabNavigation();
  setupBrowserControls();
  setupLibraryActions();
  setupBigPictureControls();
  setupDownloadIPC();
  setupConfigForm();
  setupModalActions();
  setupLibraryToolbar();
  setupAppUpdater();
  setupMinecraftHub();
  await showAntivirusReminder();
});

function setupLibraryToolbar() {
  const searchInput = document.getElementById('library-search-input');
  const searchClear = document.getElementById('library-search-clear');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.trim();
      if (searchClear) searchClear.style.display = appState.searchQuery ? 'block' : 'none';
      renderLibrary();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      appState.searchQuery = '';
      searchClear.style.display = 'none';
      renderLibrary();
    });
  }

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      appState.activeFilter = target.dataset.filter;
      renderLibrary();
    });
  });

  // Custom Sort Dropdown
  const customDropdown = document.getElementById('sort-custom-dropdown');
  const dropdownBtn = document.getElementById('sort-dropdown-btn');
  const selectedLabel = document.getElementById('sort-selected-label');

  if (dropdownBtn && customDropdown) {
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      customDropdown.classList.toggle('open');
    });

    document.querySelectorAll('.custom-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        const val = item.dataset.value;
        appState.activeSort = val;
        
        // Clean text (remove icon text if needed)
        selectedLabel.innerText = item.innerText.trim();
        customDropdown.classList.remove('open');
        renderLibrary();
      });
    });

    document.addEventListener('click', (e) => {
      if (!customDropdown.contains(e.target)) {
        customDropdown.classList.remove('open');
      }
    });
  }

  const refreshStorageBtn = document.getElementById('storage-refresh-btn');
  if (refreshStorageBtn) {
    refreshStorageBtn.addEventListener('click', async () => {
      await updateStorageWidget();
      showToast('Storage Refreshed', 'Game library storage statistics updated.', 'info', 2000);
    });
  }
}

// Load Websites
async function loadWebsites() {
  const result = await window.api.getWebsites();
  appState.websites = result.websites || [];
  renderWebsitesList();
  renderManageSitesList();
}

// Load Library
async function loadLibrary() {
  appState.library = await window.api.getLibrary();
  renderLibrary();
  await updateStorageWidget();
}

// Tab Navigation
function setupTabNavigation() {
  btnLibrary?.addEventListener('click', () => {
    switchTab('library');
  });

  btnMinecraft?.addEventListener('click', () => {
    switchTab('minecraft');
  });
  
  btnConfig?.addEventListener('click', () => {
    switchTab('config');
  });

  const soundBtn = document.getElementById('btn-sound-toggle');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      sfx.toggle();
    });
  }
  sfx.updateToggleIcon();
}

function switchTab(tabId) {
  sfx.play('click');
  appState.activeTab = tabId;
  
  // Update nav buttons active state
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.website-link').forEach(link => link.classList.remove('active'));
  
  if (tabId === 'library') {
    btnLibrary?.classList.add('active');
  } else if (tabId === 'minecraft') {
    btnMinecraft?.classList.add('active');
  } else if (tabId === 'config') {
    btnConfig?.classList.add('active');
  }
  
  // Switch content panel
  document.querySelectorAll('.content-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
}

function setupLibraryActions() {
  document.getElementById('btn-open-games-folder').addEventListener('click', async () => {
    const res = await window.api.openStorageFolder('games');
    if (!res.success) {
      alert(`Could not open games folder: ${res.error}`);
    }
  });

  document.getElementById('btn-open-downloads-folder').addEventListener('click', async () => {
    const res = await window.api.openStorageFolder('downloads');
    if (!res.success) {
      alert(`Could not open downloads folder: ${res.error}`);
    }
  });

  document.getElementById('btn-big-picture').addEventListener('click', () => {
    openBigPicture();
  });
}

function setupBigPictureControls() {
  document.getElementById('big-picture-close')?.addEventListener('click', () => {
    closeBigPicture();
  });

  document.getElementById('bp-btn-play')?.addEventListener('click', () => {
    launchSelectedBigPictureGame();
  });

  document.getElementById('bp-btn-folder')?.addEventListener('click', async () => {
    await openSelectedBigPictureFolder();
  });

  document.getElementById('bp-btn-favorite')?.addEventListener('click', async () => {
    await toggleSelectedBigPictureFavorite();
  });

  document.getElementById('bp-btn-random')?.addEventListener('click', () => {
    selectRandomBigPictureGame();
  });

  // Category Tab switching
  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      setBigPictureTab(e.currentTarget.dataset.bpTab || 'all');
    });
  });

  document.addEventListener('keydown', (event) => {
    if (!appState.bigPictureActive) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeBigPicture();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectBigPictureGame(appState.bigPictureSelectedIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectBigPictureGame(appState.bigPictureSelectedIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      launchSelectedBigPictureGame();
    } else if (event.key.toLowerCase() === 'x' || event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleSelectedBigPictureFavorite();
    } else if (event.key.toLowerCase() === 'y' || event.key.toLowerCase() === 'r') {
      event.preventDefault();
      selectRandomBigPictureGame();
    } else if (event.key === 'Tab' || event.key === 'q') {
      event.preventDefault();
      cycleBigPictureTab(-1);
    } else if (event.key === 'e') {
      event.preventDefault();
      cycleBigPictureTab(1);
    }
  });
}

async function showAntivirusReminder() {
  if (localStorage.getItem('hideAntivirusReminder') === 'true') {
    return;
  }
  const storageInfo = await window.api.getStorageInfo();
  const pathEl = document.getElementById('antivirus-data-path');
  if (pathEl) pathEl.innerText = storageInfo.dataDir || 'Data folder not found';
  showModal(modalAntivirusReminder);
}

async function openSteamAndContinuePendingLaunch() {
  const gameId = appState.pendingLaunchGameId;
  if (!gameId) return;

  const steamResult = await window.api.openSteam();
  if (!steamResult.success) {
    alert(`Could not open Steam: ${steamResult.error}`);
    return;
  }

  closeActiveModal();
  setTimeout(() => launchGame(gameId), 2500);
}

async function continuePendingLaunchAnyway() {
  const gameId = appState.pendingLaunchGameId;
  if (!gameId) return;

  closeActiveModal();
  await launchGame(gameId);
}

// Browser Navigation and setup
function setupBrowserControls() {
  const webBack = document.getElementById('web-back');
  const webForward = document.getElementById('web-forward');
  const webReload = document.getElementById('web-reload');
  const webClose = document.getElementById('web-close');
  const webAddress = document.getElementById('web-address');
  
  webBack.addEventListener('click', () => {
    if (webview.canGoBack()) webview.goBack();
  });
  
  webForward.addEventListener('click', () => {
    if (webview.canGoForward()) webview.goForward();
  });
  
  webReload.addEventListener('click', () => {
    webview.reload();
  });
  
  webClose.addEventListener('click', () => {
    webview.src = 'about:blank';
    appState.activeWebsite = null;
    appState.lastAllowedUrl = '';
    switchTab('library');
  });

  // In-App Adblock Popup Menu Handlers
  const adblockWrapper = document.getElementById('adblock-menu-wrapper');
  const webAdblock = document.getElementById('web-adblock');
  const adblockStatusDot = document.getElementById('adblock-status-dot');
  const adblockBadgeStatus = document.getElementById('adblock-badge-status');
  const adblockCurrentDomain = document.getElementById('adblock-current-domain');
  const adblockSiteState = document.getElementById('adblock-site-state');
  const adblockSiteToggle = document.getElementById('adblock-site-toggle');
  const adblockGlobalToggle = document.getElementById('adblock-global-toggle');
  const adblockBlockedCount = document.getElementById('adblock-blocked-count');
  const adblockTrackersCount = document.getElementById('adblock-trackers-count');
  const adblockBtnReload = document.getElementById('adblock-btn-reload');
  const adblockBtnUpdate = document.getElementById('adblock-btn-update');

  async function refreshAdblockMenuUI() {
    const currentUrl = webAddress.value || webview.getURL() || 'about:blank';
    const status = await window.api.getAdblockStatus(currentUrl);

    if (adblockCurrentDomain) adblockCurrentDomain.innerText = status.currentSite;
    if (adblockSiteToggle) adblockSiteToggle.checked = status.isSiteEnabled;
    if (adblockGlobalToggle) adblockGlobalToggle.checked = status.globalEnabled;
    if (adblockBlockedCount) adblockBlockedCount.innerText = status.blockedRequests;
    if (adblockTrackersCount) adblockTrackersCount.innerText = status.blockedTrackers;

    if (status.globalEnabled && status.isSiteEnabled) {
      if (adblockStatusDot) adblockStatusDot.className = 'adblock-status-dot active';
      if (adblockBadgeStatus) {
        adblockBadgeStatus.className = 'adblock-badge active';
        adblockBadgeStatus.innerText = 'PROTECTED';
      }
      if (adblockSiteState) {
        adblockSiteState.innerText = 'Ads & trackers blocked';
        adblockSiteState.style.color = 'var(--text-secondary)';
      }
    } else {
      if (adblockStatusDot) adblockStatusDot.className = 'adblock-status-dot';
      if (adblockBadgeStatus) {
        adblockBadgeStatus.className = 'adblock-badge';
        adblockBadgeStatus.innerText = 'PAUSED';
      }
      if (adblockSiteState) {
        adblockSiteState.innerText = status.globalEnabled ? 'Disabled on this site' : 'Adblocking paused globally';
        adblockSiteState.style.color = 'var(--accent-red)';
      }
    }
  }

  if (webAdblock && adblockWrapper) {
    webAdblock.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isOpen = adblockWrapper.classList.toggle('open');
      if (isOpen) {
        await refreshAdblockMenuUI();
      }
    });

    if (adblockSiteToggle) {
      adblockSiteToggle.addEventListener('change', async () => {
        const currentUrl = webAddress.value || webview.getURL() || '';
        let domain = '';
        try { domain = new URL(currentUrl).hostname; } catch (e) {}
        if (domain) {
          await window.api.toggleAdblockSite(domain);
          await refreshAdblockMenuUI();
          webview.reload();
          showToast(adblockSiteToggle.checked ? 'Adblock Enabled' : 'Adblock Disabled', `Updated rule for ${domain}`, 'info');
        }
      });
    }

    if (adblockGlobalToggle) {
      adblockGlobalToggle.addEventListener('change', async () => {
        await window.api.toggleAdblockGlobal();
        await refreshAdblockMenuUI();
        webview.reload();
        showToast(adblockGlobalToggle.checked ? 'Shield ON' : 'Shield OFF', adblockGlobalToggle.checked ? 'Global adblocking enabled' : 'Global adblocking paused', adblockGlobalToggle.checked ? 'success' : 'warning');
      });
    }

    if (adblockBtnReload) {
      adblockBtnReload.addEventListener('click', () => {
        adblockWrapper.classList.remove('open');
        webview.reload();
      });
    }

    if (adblockBtnUpdate) {
      adblockBtnUpdate.addEventListener('click', async () => {
        showToast('Updating Filters', 'Fetching latest blocklists...', 'info');
        const res = await window.api.updateAdblockFilters();
        if (res.success) {
          showToast('Filters Updated', 'Adblock lists are up to date.', 'success');
        } else {
          showToast('Update Failed', res.error || 'Could not update filters', 'error');
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!adblockWrapper.contains(e.target)) {
        adblockWrapper.classList.remove('open');
      }
    });

    window.api.onAdblockStatsUpdated((data) => {
      if (adblockBlockedCount) adblockBlockedCount.innerText = data.blockedRequests;
      if (adblockTrackersCount) adblockTrackersCount.innerText = data.blockedTrackers;
    });
  }
  
  // Intercept navigation before it starts
  webview.addEventListener('will-navigate', (e) => {
    if (appState.activeWebsite && !isUrlAllowed(e.url, appState.activeWebsite)) {
      e.preventDefault();
      showBlockedNotification(e.url);
    } else {
      appState.lastAllowedUrl = e.url;
    }
  });

  // Monitor address changes inside the webview
  webview.addEventListener('did-start-navigation', (e) => {
    if (!e.isMainFrame) return;

    if (appState.activeWebsite && !isUrlAllowed(e.url, appState.activeWebsite)) {
      webview.stop();
      webAddress.value = appState.lastAllowedUrl || appState.activeWebsite.url;
      showBlockedNotification(e.url);
    } else {
      webAddress.value = e.url;
    }
  });
  
  webview.addEventListener('did-navigate', (e) => {
    if (appState.activeWebsite && !isUrlAllowed(e.url, appState.activeWebsite)) {
      webview.stop();
      if (webview.canGoBack()) {
        webview.goBack();
      } else {
        webview.src = appState.activeWebsite.url;
      }
      showBlockedNotification(e.url);
    } else {
      webAddress.value = e.url;
      appState.lastAllowedUrl = e.url;
    }
  });
  
  webview.addEventListener('did-navigate-in-page', (e) => {
    if (appState.activeWebsite && !isUrlAllowed(e.url, appState.activeWebsite)) {
      webview.stop();
      if (webview.canGoBack()) {
        webview.goBack();
      } else {
        webview.src = appState.activeWebsite.url;
      }
      showBlockedNotification(e.url);
    } else {
      webAddress.value = e.url;
      appState.lastAllowedUrl = e.url;
    }
  });
}

// Open Webpage in the browser tab
function openWebsite(site, element) {
  appState.activeWebsite = site;
  appState.lastAllowedUrl = site.url;
  
  switchTab('browser');
  webview.src = site.url;
  
  // Highlight active website in sidebar
  document.querySelectorAll('.website-link').forEach(link => link.classList.remove('active'));
  if (element) {
    element.classList.add('active');
  }
}

// Render Websites in sidebar
function renderWebsitesList() {
  websitesContainer.innerHTML = '';
  
  if (appState.websites.length === 0) {
    websitesContainer.innerHTML = '<span class="sidebar-section-title" style="padding-left: 1rem; text-transform: none; letter-spacing: 0;">No sites configured</span>';
    return;
  }
  
  appState.websites.forEach(site => {
    const btn = document.createElement('button');
    btn.className = 'website-link';
    btn.innerHTML = `
      <span>${escapeHtml(site.name)}</span>
      <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem; opacity: 0.5;"></i>
    `;
    btn.addEventListener('click', () => {
      openWebsite(site, btn);
    });
    websitesContainer.appendChild(btn);
  });
}

// Render Website settings table
function renderManageSitesList() {
  manageSitesList.innerHTML = '';
  
  if (appState.websites.length === 0) {
    manageSitesList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No websites configured. Add one above.</p>';
    return;
  }
  
  appState.websites.forEach((site, index) => {
    const item = document.createElement('div');
    item.className = 'manage-site-item';
    
    const keywordsHtml = site.keywords 
      ? `<div class="manage-site-keywords"><i class="fa-solid fa-key"></i>Keywords: ${escapeHtml(site.keywords)}</div>` 
      : '';
      
    item.innerHTML = `
      <div class="manage-site-info">
        <div class="manage-site-name">${escapeHtml(site.name)}</div>
        <div class="manage-site-url">${escapeHtml(site.url)}</div>
        ${keywordsHtml}
      </div>
      <button class="icon-only-btn delete-hover" title="Remove Site">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    
    // Attach delete handler
    item.querySelector('.delete-hover').addEventListener('click', async () => {
      appState.websites.splice(index, 1);
      await window.api.saveWebsites(appState.websites);
      await loadWebsites();
    });
    
    manageSitesList.appendChild(item);
  });
}

// Add Website Form setup
function setupConfigForm() {
  const form = document.getElementById('add-website-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('new-site-name');
    const urlInput = document.getElementById('new-site-url');
    const keywordsInput = document.getElementById('new-site-keywords');
    
    const newSite = {
      name: nameInput.value.trim(),
      url: urlInput.value.trim(),
      keywords: keywordsInput.value.trim()
    };
    
    appState.websites.push(newSite);
    await window.api.saveWebsites(appState.websites);
    
    // Reset form and reload list
    nameInput.value = '';
    urlInput.value = '';
    keywordsInput.value = '';
    await loadWebsites();
  });
}

// Helper to extract hostname from URL
function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

// Helper to check if URL is allowed based on site keywords
function isUrlAllowed(url, site) {
  if (!site) return true;
  if (url === 'about:blank') return true;
  
  // Always permit the website's initial hostname and its subdomains
  const targetHost = getHostname(url);
  const siteHost = getHostname(site.url);
  if (targetHost && siteHost && (targetHost === siteHost || targetHost.endsWith('.' + siteHost))) {
    return true;
  }
  
  const keywords = site.keywords;
  if (!keywords || keywords.trim() === '') {
    return true; // No keywords configured, navigation is unrestricted
  }
  
  const lowerUrl = url.toLowerCase();
  const keywordList = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (keywordList.length === 0) return true;
  
  return keywordList.some(kw => lowerUrl.includes(kw));
}

// Show a custom floating toast notification when navigation is blocked
function showBlockedNotification(url) {
  let notification = document.getElementById('browser-blocked-notification');
  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'browser-blocked-notification';
    notification.className = 'browser-notification';
    document.body.appendChild(notification);
  }
  
  notification.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Navigation blocked: URL contains no allowed keywords.`;
  notification.classList.add('show');
  
  if (notification.timeoutId) {
    clearTimeout(notification.timeoutId);
  }
  
  notification.timeoutId = setTimeout(() => {
    notification.classList.remove('show');
  }, 4000);
}

// Setup Dialog/Modal Overlays
function showModal(modalElement) {
  if (!modalOverlay || !modalElement) return;
  modalOverlay.classList.add('active');
  document.querySelectorAll('.modal-content').forEach(m => m.classList.remove('active'));
  modalElement.classList.add('active');
}

function closeActiveModal() {
  if (modalOverlay) modalOverlay.classList.remove('active');
  document.querySelectorAll('.modal-content').forEach(m => m.classList.remove('active'));
  appState.pendingSelectionGameId = null;
}

window.showModal = showModal;
window.closeActiveModal = closeActiveModal;

// Modal actions and button hooks
function setupModalActions() {
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      closeActiveModal();
    }
  });

  // Download finished actions
  document.getElementById('modal-btn-download-more')?.addEventListener('click', () => {
    closeActiveModal();
  });
  const btnCloseApp = document.getElementById('modal-btn-close-app');
  if (btnCloseApp) {
    btnCloseApp.addEventListener('click', () => {
      window.api.closeApp();
    });
  }
  
  // Select Launcher confirm (Multiple found)
  document.getElementById('modal-btn-confirm-exe').addEventListener('click', async () => {
    const dropdown = document.getElementById('select-exe-dropdown');
    const selectedExe = dropdown.value;
    if (appState.pendingSelectionGameId && selectedExe) {
      const result = await window.api.resolveExecutableSelection(appState.pendingSelectionGameId, selectedExe);
      if (!result?.success) {
        alert(`Could not save startup file: ${result?.error || 'Unknown error'}`);
        return;
      }
      closeActiveModal();
      await loadLibrary();
    }
  });
  
  // Select Startup script confirm (No exe found)
  document.getElementById('modal-btn-confirm-no-exe').addEventListener('click', async () => {
    const dropdown = document.getElementById('select-no-exe-dropdown');
    const selectedExe = dropdown.value;
    if (appState.pendingSelectionGameId && selectedExe && selectedExe !== '(No files extracted)') {
      const result = await window.api.resolveExecutableSelection(appState.pendingSelectionGameId, selectedExe);
      if (!result?.success) {
        alert(`Could not save startup file: ${result?.error || 'Unknown error'}`);
        return;
      }
      closeActiveModal();
      await loadLibrary();
    }
  });
  
  // Manual file browse button in "No exe found"
  document.getElementById('modal-btn-browse-exe').addEventListener('click', async () => {
    const selectedPath = await window.api.selectManualExe();
    if (selectedPath) {
      // Find the folder path for the pending game to make it relative if possible
      const gameId = appState.pendingSelectionGameId;
      const gameInLibrary = appState.library.find(g => g.id === gameId);
      
      let relativePath = selectedPath;
      if (gameInLibrary) {
        relativePath = selectedPath.replace(gameInLibrary.folderPath + '/', '');
      }
      
      // Select dropdown or insert custom option
      const dropdown = document.getElementById('select-no-exe-dropdown');
      const opt = document.createElement('option');
      opt.value = relativePath;
      opt.text = relativePath;
      dropdown.add(opt);
      dropdown.value = relativePath;
    }
  });

  // Edit modal cover image selection
  document.getElementById('edit-btn-change-cover').addEventListener('click', async () => {
    const coverPath = await window.api.selectCoverImage();
    if (coverPath) {
      const preview = document.getElementById('edit-cover-preview-img');
      preview.innerHTML = '';
      preview.style.backgroundImage = `url('${coverPath.replace('app-file://', 'app-file:///')}')`;
      preview.dataset.coverPath = coverPath;
    }
  });

  document.getElementById('edit-btn-open-folder').addEventListener('click', async () => {
    const gameId = document.getElementById('edit-game-id').value;
    if (!gameId) return;

    const res = await window.api.openGameFolder(gameId);
    if (!res.success) {
      alert(`Could not open folder: ${res.error}`);
    }
  });
  
  // Edit modal manual exe selector
  document.getElementById('edit-btn-browse-exe-path').addEventListener('click', async () => {
    const selectedPath = await window.api.selectManualExe();
    if (selectedPath) {
      const gameId = document.getElementById('edit-game-id').value;
      const game = appState.library.find(g => g.id === gameId);
      
      let relativePath = selectedPath;
      if (game && selectedPath.includes(game.folderPath)) {
        relativePath = selectedPath.replace(game.folderPath + '/', '');
      }
      document.getElementById('edit-game-exe').value = relativePath;
    }
  });
  
  // Save edited game details
  document.getElementById('edit-btn-save').addEventListener('click', async (e) => {
    e.preventDefault();
    const gameId = document.getElementById('edit-game-id').value;
    const gameIndex = appState.library.findIndex(g => g.id === gameId);
    
    if (gameIndex !== -1) {
      const game = appState.library[gameIndex];
      game.title = document.getElementById('edit-game-title').value.trim();
      game.exePath = document.getElementById('edit-game-exe').value;
      
      const coverPath = document.getElementById('edit-cover-preview-img').dataset.coverPath;
      if (coverPath) {
        game.coverPath = coverPath;
      }
      
      await window.api.saveLibrary(appState.library);
      closeActiveModal();
      await loadLibrary();
    }
  });

  document.getElementById('modal-btn-open-steam').addEventListener('click', openSteamAndContinuePendingLaunch);
  document.getElementById('modal-btn-launch-anyway').addEventListener('click', continuePendingLaunchAnyway);

  document.getElementById('modal-btn-open-data-folder').addEventListener('click', async () => {
    const res = await window.api.openStorageFolder('data');
    if (!res.success) {
      alert(`Could not open data folder: ${res.error}`);
    }
  });

  document.getElementById('modal-btn-open-security').addEventListener('click', async () => {
    const res = await window.api.openWindowsSecurity();
    if (!res.success) {
      alert(`Could not open Windows Security: ${res.error}`);
    }
  });

  const saveAntivirusChoice = () => {
    const cb = document.getElementById('antivirus-dont-show-checkbox');
    if (cb && cb.checked) {
      localStorage.setItem('hideAntivirusReminder', 'true');
    }
    closeActiveModal();
  };

  document.getElementById('modal-btn-ok-antivirus').addEventListener('click', saveAntivirusChoice);
  document.getElementById('modal-btn-close-antivirus').addEventListener('click', saveAntivirusChoice);

  // Decrypt & Extract confirm
  document.getElementById('modal-btn-submit-password').addEventListener('click', async () => {
    const passwordInput = document.getElementById('extraction-password-input');
    const password = passwordInput.value;
    const gameId = appState.pendingSelectionGameId;

    if (gameId) {
      // Close the modal immediately as requested so the user doesn't wait
      closeActiveModal();
      passwordInput.value = '';

      // Run extraction asynchronously in the background
      window.api.submitArchivePassword(gameId, password).then((result) => {
        if (result && result.success) {
          loadLibrary();
        }
      }).catch((err) => {
        console.error('Extraction background error:', err);
      });
    }
  });

  // Cancel Decrypt & Extract
  document.getElementById('modal-btn-cancel-extraction').addEventListener('click', async () => {
    const gameId = appState.pendingSelectionGameId;
    if (gameId) {
      await window.api.cancelArchiveExtraction(gameId);
      document.getElementById('extraction-password-input').value = '';
      document.getElementById('password-error-message').style.display = 'none';
        closeActiveModal();
    }
  });
}

// GitHub App Updater UI logic
function setupAppUpdater() {
  window.api.onAppUpdateAvailable((updateData) => {
    showUpdateModal(updateData);
  });

  window.api.onUpdateDownloadProgress((data) => {
    const changelogCard = document.getElementById('update-changelog-card');
    const progressCard = document.getElementById('update-progress-card');
    const statusTitle = document.getElementById('update-status-title');
    const percentBadge = document.getElementById('update-percent-badge');
    const barFill = document.getElementById('update-progress-bar-fill');
    const sizeInfo = document.getElementById('update-size-info');
    const speedInfo = document.getElementById('update-speed-info');
    const downloadBtn = document.getElementById('btn-download-update');
    const restartBtn = document.getElementById('btn-restart-update');
    const cancelBtn = document.getElementById('btn-update-cancel');

    if (data.status === 'downloading') {
      if (changelogCard) changelogCard.style.display = 'none';
      if (progressCard) progressCard.style.display = 'flex';
      if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Downloading Update...';
      if (percentBadge) percentBadge.innerText = `${data.percent}%`;
      if (barFill) barFill.style.width = `${data.percent}%`;
      if (sizeInfo) sizeInfo.innerText = `${data.received} / ${data.total} MB`;
      if (speedInfo) speedInfo.innerText = `${data.speed} MB/s`;
      if (downloadBtn) downloadBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
    } else if (data.status === 'extracting') {
      if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-gear spin-icon"></i> Extracting Update Files...';
      if (percentBadge) percentBadge.innerText = '100%';
      if (barFill) barFill.style.width = '100%';
      if (sizeInfo) sizeInfo.innerText = 'Unpacking files';
      if (speedInfo) speedInfo.innerText = 'Please wait...';
    } else if (data.status === 'ready_to_install') {
      sfx.play('complete');
      if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-circle-check text-success"></i> Update Ready to Install!';
      if (percentBadge) percentBadge.innerText = 'Ready';
      if (sizeInfo) sizeInfo.innerText = 'All user data preserved';
      if (speedInfo) speedInfo.innerText = 'Restart required';
      if (downloadBtn) downloadBtn.style.display = 'none';
      if (restartBtn) restartBtn.style.display = 'inline-flex';
      if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
        cancelBtn.innerText = 'Restart Later';
      }
      showToast('Update Ready!', 'Click Restart to apply the new version.', 'success');
    } else if (data.status === 'error') {
      if (statusTitle) statusTitle.innerHTML = '<i class="fa-solid fa-circle-xmark text-danger"></i> Update Failed';
      if (sizeInfo) sizeInfo.innerText = data.error || 'Unknown error';
      if (downloadBtn) {
        downloadBtn.style.display = 'inline-flex';
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Retry Download';
      }
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
    }
  });

  const checkBtn = document.getElementById('btn-check-update');
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.classList.add('checking');
      sfx.play('click');
      try {
        const res = await window.api.checkAppUpdate(true);
        checkBtn.classList.remove('checking');
        if (!res.success) {
          showToast('Update Check Failed', res.error || 'Could not connect to GitHub.', 'error');
          return;
        }
        if (res.updateAvailable) {
          showUpdateModal(res);
        } else {
          showToast('Up to Date! 🎉', `You are running the latest version (${res.currentVersion}).`, 'success');
        }
      } catch (err) {
        checkBtn.classList.remove('checking');
        showToast('Update Check Failed', err.message, 'error');
      }
    });
  }

  const downloadBtn = document.getElementById('btn-download-update');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      if (currentUpdateData?.assetDownloadUrl) {
        sfx.play('launch');
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Starting...';
        await window.api.startAppUpdateDownload(currentUpdateData.assetDownloadUrl);
      }
    });
  }

  const restartBtn = document.getElementById('btn-restart-update');
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      sfx.play('launch');
      restartBtn.disabled = true;
      restartBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Restarting...';
      window.api.applyAppUpdateAndRestart();
    });
  }

  const openReleaseBtn = document.getElementById('btn-open-release-page');
  if (openReleaseBtn) {
    openReleaseBtn.addEventListener('click', () => {
      if (currentUpdateData?.releaseUrl) {
        sfx.play('click');
        window.api.openExternalUrl(currentUpdateData.releaseUrl);
      }
    });
  }
}

function showUpdateModal(data) {
  currentUpdateData = data;
  const curEl = document.getElementById('update-current-ver');
  const newEl = document.getElementById('update-new-ver');
  const titleEl = document.getElementById('update-release-title');
  const notesEl = document.getElementById('update-release-notes');
  const sizeEl = document.getElementById('update-asset-size');
  const changelogCard = document.getElementById('update-changelog-card');
  const progressCard = document.getElementById('update-progress-card');
  const downloadBtn = document.getElementById('btn-download-update');
  const restartBtn = document.getElementById('btn-restart-update');
  const cancelBtn = document.getElementById('btn-update-cancel');

  // Reset modal state
  if (changelogCard) changelogCard.style.display = 'flex';
  if (progressCard) progressCard.style.display = 'none';
  if (downloadBtn) {
    downloadBtn.style.display = 'inline-flex';
    downloadBtn.disabled = false;
    downloadBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Update Now (${data.assetSize || '103 MB'})`;
  }
  if (restartBtn) restartBtn.style.display = 'none';
  if (cancelBtn) {
    cancelBtn.style.display = 'inline-block';
    cancelBtn.innerText = 'Later';
  }

  if (curEl) curEl.innerText = `v${data.currentVersion}`;
  if (newEl) newEl.innerText = `v${data.latestVersion.replace(/^v/, '')}`;
  if (titleEl) titleEl.innerText = data.releaseName || `AntiGravity ${data.latestVersion}`;
  if (notesEl) notesEl.innerText = data.releaseNotes || 'Bug fixes and performance improvements.';
  if (sizeEl) sizeEl.innerText = data.assetSize || 'Release Package';

  sfx.play('complete');
  showModal(modalAppUpdate);
}

// Download IPC Event Hooks
function setupDownloadIPC() {
  // Download progress update
  window.api.onDownloadProgress((data) => {
    appState.activeDownloads[data.id] = data;
    renderDownloads();
  });
  
  // Download completed
  window.api.onDownloadCompleted((data) => {
    delete appState.activeDownloads[data.id];
    renderDownloads();
    document.getElementById('completed-game-name').innerText = data.name;
    sfx.play('complete');
    showModal(modalDownloadDone);
  });
  
  // Download failed
  window.api.onDownloadFailed((data) => {
    delete appState.activeDownloads[data.id];
    renderDownloads();
    alert(`Download failed for: ${data.name}\nReason: ${data.error}`);
  });
  
  // Prompts from zip processing
  window.api.onPromptExecutables((data) => {
    appState.pendingSelectionGameId = data.id;
    document.querySelectorAll('.game-target-title').forEach(el => el.innerText = data.title);
    
    const dropdown = document.getElementById('select-exe-dropdown');
    dropdown.innerHTML = '';
    data.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      dropdown.appendChild(option);
    });
    
    showModal(modalSelectExe);
  });
  
  window.api.onPromptNoExecutable((data) => {
    appState.pendingSelectionGameId = data.id;
    document.querySelectorAll('.game-target-title').forEach(el => el.innerText = data.title);
    
    const dropdown = document.getElementById('select-no-exe-dropdown');
    dropdown.innerHTML = '';
    data.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      dropdown.appendChild(option);
    });
    
    showModal(modalNoExe);
  });
  
  // Auto load library when game gets auto-added by main process
  window.api.onGameAdded((game) => {
    loadLibrary();
  });

  window.api.onLibraryUpdated(() => {
    loadLibrary();
  });

  window.api.onPromptArchivePassword((data) => {
    appState.pendingSelectionGameId = data.id;
    document.getElementById('password-game-name').innerText = data.title;
    document.getElementById('extraction-password-input').value = '';
    
    const errorMsg = document.getElementById('password-error-message');
    if (data.isRetry) {
      errorMsg.style.display = 'block';
    } else {
      errorMsg.style.display = 'none';
    }
    showModal(modalPasswordRequired);
  });

}

// Render downloads list
function renderDownloads() {
  const ids = Object.keys(appState.activeDownloads);
  const count = ids.length;
  
  if (count === 0) {
    downloadsPanel.style.display = 'none';
    downloadCountBadge.innerText = '0';
    return;
  }
  
  downloadsPanel.style.display = 'block';
  downloadCountBadge.innerText = count;
  downloadsList.innerHTML = '';
  
  ids.forEach(id => {
    const item = appState.activeDownloads[id];
    const div = document.createElement('div');
    div.className = 'download-item';
    
    // Format eta
    let etaStr = '--:--';
    if (item.eta > 0) {
      const minutes = Math.floor(item.eta / 60);
      const seconds = item.eta % 60;
      etaStr = `${minutes}m ${seconds}s`;
    }

    const isExtracting = item.status === 'extracting';
    const isProcessing = item.status === 'processing';
    const statusLabel = isExtracting
      ? 'Extracting...'
      : isProcessing
        ? 'Processing...'
        : `${item.speed} MB/s | ETA: ${etaStr}`;
    
    div.innerHTML = `
      <div class="download-item-title" title="${item.name}">${item.name}</div>
      <div class="download-progress-bar-bg">
        <div class="download-progress-bar-fill" style="width: ${item.percent}%"></div>
      </div>
      <div class="download-meta">
        <span>${item.percent}% (${item.received} / ${item.total} MB)</span>
        <span>${statusLabel}</span>
      </div>
    `;
    downloadsList.appendChild(div);
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function launchGame(gameId) {
  sfx.play('launch');
  const res = await window.api.runGame(gameId);
  if (!res.success) {
    alert(`Error starting game: ${res.error}`);
  }
}

async function launchGameWithSteamCheck(gameId) {
  const status = await window.api.getGameLaunchStatus(gameId);
  if (!status.success) {
    alert(`Error starting game: ${status.error}`);
    return;
  }

  if (!status.steamRunning) {
    appState.pendingLaunchGameId = gameId;
    document.getElementById('steam-warning-game-title').innerText = status.gameTitle || 'This game';
    showModal(modalSteamWarning);
    return;
  }

  await launchGame(gameId);
}

function getCoverUrl(game) {
  return game.coverPath
    ? game.coverPath.replace('app-file://', 'app-file:///')
    : '';
}

let bpClockInterval = null;

function updateBigPictureClock() {
  const clockEl = document.getElementById('bp-clock');
  if (!clockEl) return;
  const now = new Date();
  clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateBigPictureBattery() {
  const pill = document.getElementById('bp-battery-pill');
  const icon = document.getElementById('bp-battery-icon');
  const text = document.getElementById('bp-battery-text');
  if (!pill || !text || !navigator.getBattery) return;

  navigator.getBattery().then(battery => {
    pill.style.display = 'flex';
    text.innerText = `${Math.round(battery.level * 100)}%`;
    if (battery.charging) {
      if (icon) icon.className = 'fa-solid fa-bolt text-success';
    } else if (battery.level > 0.6) {
      if (icon) icon.className = 'fa-solid fa-battery-full text-success';
    } else if (battery.level > 0.2) {
      if (icon) icon.className = 'fa-solid fa-battery-half text-warning';
    } else {
      if (icon) icon.className = 'fa-solid fa-battery-quarter text-danger';
    }
  }).catch(() => {});
}

const MINECRAFT_DEFAULT_COVER = 'https://launchercontent.mojang.com/gameDetails/java.png';

function getMinecraftBigPictureItems() {
  const instances = mcState.instancesData?.instances || [];
  if (instances.length === 0) {
    const active = mcState.activeInstance || { name: 'Fabric 1.20.1', version: '1.20.1', loader: 'fabric' };
    return [{
      id: 'minecraft-default',
      instanceId: active.id || 'default-fabric',
      isMinecraft: true,
      title: 'Minecraft: Java Edition',
      version: active.version || '1.20.1',
      loader: active.loader || 'fabric',
      coverPath: MINECRAFT_DEFAULT_COVER,
      exePath: `Minecraft Java Edition • ${active.version || '1.20.1'} (${(active.loader || 'fabric').toUpperCase()})`,
      favorite: false,
      lastPlayed: active.lastPlayed || 0,
      playtimeMinutes: active.playtimeMinutes || 0
    }];
  }

  return instances.map(inst => ({
    id: `minecraft-${inst.id}`,
    instanceId: inst.id,
    isMinecraft: true,
    title: inst.name || `Minecraft ${inst.version}`,
    version: inst.version,
    loader: inst.loader,
    coverPath: inst.coverPath || MINECRAFT_DEFAULT_COVER,
    exePath: `Minecraft Java Edition • ${inst.version} (${inst.loader.toUpperCase()})`,
    favorite: inst.favorite || false,
    lastPlayed: inst.lastPlayed || 0,
    playtimeMinutes: inst.playtimeMinutes || 0
  }));
}

function getBigPictureFilteredGames() {
  const tab = appState.bigPictureTab || 'all';
  const mcItems = getMinecraftBigPictureItems();

  if (tab === 'minecraft') {
    return mcItems;
  } else if (tab === 'favorites') {
    const favGames = appState.library.filter(g => g.favorite);
    const favMc = mcItems.filter(m => m.favorite);
    return [...favMc, ...favGames];
  } else if (tab === 'recent') {
    const combined = [...mcItems, ...appState.library];
    return combined.sort((a, b) => {
      const timeA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
      const timeB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
      return timeB - timeA;
    });
  }
  
  // 'all': Show Minecraft instances + library games
  return [...mcItems, ...appState.library];
}

function getSelectedBigPictureGame() {
  const list = getBigPictureFilteredGames();
  return list[appState.bigPictureSelectedIndex] || null;
}

async function openBigPicture() {
  sfx.play('big_picture');
  appState.bigPictureActive = true;
  appState.bigPictureTab = 'all';
  appState.bigPictureSelectedIndex = 0;

  const overlay = document.getElementById('big-picture-overlay');
  if (overlay) {
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
  }
  document.body.classList.add('big-picture-open');

  // Enter true fullscreen for console experience
  await window.api.setWindowFullscreen(true);

  updateBigPictureClock();
  updateBigPictureBattery();
  clearInterval(bpClockInterval);
  bpClockInterval = setInterval(updateBigPictureClock, 1000);

  // Set active tab UI
  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.bpTab === 'all');
  });

  renderBigPicture();
  startBigPictureControllerSupport();
}

async function closeBigPicture() {
  sfx.play('click');
  appState.bigPictureActive = false;
  stopBigPictureControllerSupport();
  clearInterval(bpClockInterval);

  const overlay = document.getElementById('big-picture-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('big-picture-open');

  // Exit fullscreen and return to maximized window
  await window.api.setWindowFullscreen(false);
}

function selectBigPictureGame(index) {
  const list = getBigPictureFilteredGames();
  if (list.length === 0) return;
  sfx.play('hover');

  const maxIndex = list.length - 1;
  if (index < 0) {
    appState.bigPictureSelectedIndex = maxIndex;
  } else if (index > maxIndex) {
    appState.bigPictureSelectedIndex = 0;
  } else {
    appState.bigPictureSelectedIndex = index;
  }

  renderBigPictureSelection();
}

function selectRandomBigPictureGame() {
  const list = getBigPictureFilteredGames();
  if (list.length <= 1) return;
  sfx.play('action');
  let nextIdx;
  do {
    nextIdx = Math.floor(Math.random() * list.length);
  } while (nextIdx === appState.bigPictureSelectedIndex);
  appState.bigPictureSelectedIndex = nextIdx;
  renderBigPictureSelection();
  showToast('Random Game!', `Selected: ${list[nextIdx].title}`, 'info', 2000);
}

function setBigPictureTab(tabKey) {
  sfx.play('click');
  appState.bigPictureTab = tabKey;
  appState.bigPictureSelectedIndex = 0;

  document.querySelectorAll('.bp-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.bpTab === tabKey);
  });

  renderBigPicture();
}

function renderBigPicture() {
  const rail = document.getElementById('bp-cards-rail');
  const countEl = document.getElementById('bp-game-count');
  const headingEl = document.getElementById('bp-carousel-heading');
  const list = getBigPictureFilteredGames();

  if (countEl) countEl.innerText = list.length;
  if (headingEl) {
    const tabNames = { all: 'All Games', favorites: 'Favorite Games', recent: 'Recently Played', minecraft: 'Minecraft Editions' };
    headingEl.innerText = `${tabNames[appState.bigPictureTab || 'all']} (${list.length})`;
  }

  if (!rail) return;
  rail.innerHTML = '';

  if (list.length === 0) {
    rail.innerHTML = `<div style="padding: 2.5rem 1rem; color: var(--text-secondary); font-size: 0.95rem; display: flex; align-items: center; gap: 0.75rem;"><i class="fa-solid fa-gamepad"></i> No games found in this category.</div>`;
    renderBigPictureSelection();
    return;
  }

  list.forEach((game, index) => {
    const card = document.createElement('div');
    card.className = 'bp-card';
    card.dataset.index = index;

    const coverUrl = getCoverUrl(game);
    const favBadge = game.favorite ? `<div class="bp-card-fav-star"><i class="fa-solid fa-star"></i></div>` : '';
    const tag = game.isMinecraft ? `${game.loader || 'Java'} ${game.version || ''}`.trim() : 'Game';

    card.innerHTML = coverUrl
      ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(game.title)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
         <div class="bp-card-fallback" style="display: none;"><i class="fa-solid ${game.isMinecraft ? 'fa-cube text-success' : 'fa-gamepad'}"></i><span>${escapeHtml(game.title)}</span></div>
         <div class="bp-card-overlay"><div class="bp-card-overlay-title">${escapeHtml(game.title)}</div><div class="bp-card-overlay-tag">${escapeHtml(tag)}</div></div>
         ${favBadge}`
      : `<div class="bp-card-fallback"><i class="fa-solid ${game.isMinecraft ? 'fa-cube text-success' : 'fa-gamepad'}"></i><span>${escapeHtml(game.title)}</span></div>
         <div class="bp-card-overlay"><div class="bp-card-overlay-title">${escapeHtml(game.title)}</div><div class="bp-card-overlay-tag">${escapeHtml(tag)}</div></div>
         ${favBadge}`;

    card.onclick = () => selectBigPictureGame(index);
    card.ondblclick = () => launchSelectedBigPictureGame();

    rail.appendChild(card);
  });

  renderBigPictureSelection();
}

function renderBigPictureSelection() {
  const list = getBigPictureFilteredGames();
  const game = list[appState.bigPictureSelectedIndex] || null;

  const heroCoverImg = document.getElementById('bp-hero-cover-img');
  const heroCoverFallback = document.getElementById('bp-hero-cover-fallback');
  const heroTitle = document.getElementById('bp-hero-title');
  const heroSubtitle = document.getElementById('bp-hero-subtitle');
  const favLabel = document.getElementById('bp-fav-label');
  const heroBadge = document.getElementById('bp-hero-badge');
  const ambientGlow = document.getElementById('bp-ambient-glow');

  if (!game) {
    if (heroCoverImg) heroCoverImg.style.display = 'none';
    if (heroCoverFallback) heroCoverFallback.style.display = 'flex';
    if (heroTitle) heroTitle.innerText = 'No Game Available';
    if (heroSubtitle) heroSubtitle.innerText = 'Download or add games to your library.';
    if (heroBadge) heroBadge.innerText = 'EMPTY CATEGORY';
    return;
  }

  const coverUrl = getCoverUrl(game);
  if (coverUrl) {
    if (heroCoverImg) {
      heroCoverImg.src = coverUrl;
      heroCoverImg.style.display = 'block';
      heroCoverImg.onerror = () => {
        heroCoverImg.style.display = 'none';
        if (heroCoverFallback) heroCoverFallback.style.display = 'flex';
      };
    }
    if (heroCoverFallback) heroCoverFallback.style.display = 'none';
  } else {
    if (heroCoverImg) heroCoverImg.style.display = 'none';
    if (heroCoverFallback) {
      heroCoverFallback.style.display = 'flex';
      heroCoverFallback.innerHTML = `<i class="fa-solid ${game.isMinecraft ? 'fa-cube text-success' : 'fa-gamepad'}"></i>`;
    }
  }

  const playtimeStr = formatPlaytime(game.playtimeMinutes);
  const lastPlayedStr = formatLastPlayed(game.lastPlayed);
  if (heroTitle) heroTitle.innerText = game.title;
  if (heroSubtitle) heroSubtitle.innerText = `${game.exePath ? game.exePath.split('/').pop() : 'Direct Launch'} • ${playtimeStr} • ${lastPlayedStr}`;
  if (heroBadge) heroBadge.innerText = game.isMinecraft ? '⛏️ MINECRAFT EDITION' : (game.favorite ? '⭐ FAVORITE GAME' : 'READY TO PLAY');
  if (favLabel) favLabel.innerText = game.favorite ? 'Favorited' : 'Favorite';

  // Dynamic ambient glowing color
  if (ambientGlow) {
    const hue = Math.abs(game.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 360;
    ambientGlow.style.background = `radial-gradient(circle at 25% 35%, hsla(${hue}, 80%, 55%, 0.22), transparent 65%), radial-gradient(circle at 80% 65%, hsla(${(hue + 60) % 360}, 75%, 50%, 0.18), transparent 60%)`;
  }

  document.querySelectorAll('.bp-card').forEach(card => {
    const isSelected = Number(card.dataset.index) === appState.bigPictureSelectedIndex;
    card.classList.toggle('selected', isSelected);
    if (isSelected) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });
}

async function launchSelectedBigPictureGame() {
  const game = getSelectedBigPictureGame();
  if (!game) return;
  sfx.play('launch');

  if (game.isMinecraft) {
    if (game.instanceId && mcState.instancesData?.instances) {
      const targetInst = mcState.instancesData.instances.find(i => i.id === game.instanceId);
      if (targetInst && targetInst.id !== mcState.activeInstance?.id) {
        await window.api.mcSetActiveInstance(targetInst.id);
        mcState.activeInstance = await window.api.mcGetActiveInstance();
        renderMinecraftHub();
      }
    }
    showToast('Launching Minecraft', `Starting ${game.title}...`, 'info', 4000);
    await launchMinecraft();
    return;
  }

  await launchGameWithSteamCheck(game.id);
}

async function toggleSelectedBigPictureFavorite() {
  const game = getSelectedBigPictureGame();
  if (!game) return;
  sfx.play('action');
  if (!game.isMinecraft) {
    await window.api.toggleGameFavorite(game.id);
  }
  game.favorite = !game.favorite;
  renderBigPicture();
}

async function openSelectedBigPictureFolder() {
  const game = getSelectedBigPictureGame();
  if (!game) return;
  if (game.isMinecraft) {
    window.api.mcOpenFolder('root', game.instanceId || mcState.activeInstance?.id);
    return;
  }
  const res = await window.api.openGameFolder(game.id);
  if (!res.success) {
    alert(`Could not open folder: ${res.error}`);
  }
}

function getFirstConnectedGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  return Array.from(gamepads).find(Boolean) || null;
}

function startBigPictureControllerSupport() {
  stopBigPictureControllerSupport();
  appState.lastControllerInputAt = 0;
  appState.bigPictureControllerFrame = requestAnimationFrame(pollBigPictureController);
}

function stopBigPictureControllerSupport() {
  if (appState.bigPictureControllerFrame) {
    cancelAnimationFrame(appState.bigPictureControllerFrame);
    appState.bigPictureControllerFrame = null;
  }
}

function pollBigPictureController(timestamp) {
  if (!appState.bigPictureActive) return;

  const gamepad = getFirstConnectedGamepad();
  const gamepadIndicator = document.getElementById('bp-gamepad-indicator');
  const gamepadNameEl = document.getElementById('bp-gamepad-name');

  if (gamepad) {
    if (gamepadIndicator) {
      gamepadIndicator.style.display = 'flex';
      if (gamepadNameEl) gamepadNameEl.innerText = gamepad.id.slice(0, 18) || 'Gamepad Connected';
    }
  } else {
    if (gamepadIndicator) gamepadIndicator.style.display = 'none';
  }

  const canHandleInput = timestamp - appState.lastControllerInputAt > controllerRepeatMs;

  if (gamepad && canHandleInput) {
    const buttons = gamepad.buttons;
    const axisX = gamepad.axes[0] || 0;
    let handled = false;

    if (buttons[14]?.pressed || axisX < -controllerAxisThreshold) {
      selectBigPictureGame(appState.bigPictureSelectedIndex - 1);
      handled = true;
    } else if (buttons[15]?.pressed || axisX > controllerAxisThreshold) {
      selectBigPictureGame(appState.bigPictureSelectedIndex + 1);
      handled = true;
    } else if (buttons[0]?.pressed) {
      // Button A: Launch
      launchSelectedBigPictureGame();
      handled = true;
    } else if (buttons[1]?.pressed) {
      // Button B: Exit Big Picture
      closeBigPicture();
      handled = true;
    } else if (buttons[2]?.pressed) {
      // Button X: Favorite
      toggleSelectedBigPictureFavorite();
      handled = true;
    } else if (buttons[3]?.pressed) {
      // Button Y: Random Game
      selectRandomBigPictureGame();
      handled = true;
    } else if (buttons[4]?.pressed) {
      // LB: Previous Category
      cycleBigPictureTab(-1);
      handled = true;
    } else if (buttons[5]?.pressed) {
      // RB: Next Category
      cycleBigPictureTab(1);
      handled = true;
    }

    if (handled) {
      appState.lastControllerInputAt = timestamp;
    }
  }

  appState.bigPictureControllerFrame = requestAnimationFrame(pollBigPictureController);
}

function cycleBigPictureTab(dir) {
  const tabs = ['all', 'favorites', 'recent', 'minecraft'];
  const curIdx = tabs.indexOf(appState.bigPictureTab || 'all');
  const nextIdx = (curIdx + dir + tabs.length) % tabs.length;
  setBigPictureTab(tabs[nextIdx]);
}

// Render games library list
function renderLibrary() {
  gamesGrid.innerHTML = '';
  
  if (appState.library.length === 0) {
    libraryEmpty.style.display = 'flex';
    const emptyTitle = document.querySelector('#library-empty h3');
    const emptyDesc = document.querySelector('#library-empty p');
    if (emptyTitle) emptyTitle.innerText = 'No games in library';
    if (emptyDesc) emptyDesc.innerText = 'Choose a website from the sidebar to browse, download, and launch games!';
    if (appState.bigPictureActive) {
      renderBigPicture();
    }
    return;
  }
  
  // 1. Filter games based on search query and active filter pill
  let filtered = [...appState.library];

  if (appState.searchQuery) {
    const q = appState.searchQuery.toLowerCase();
    filtered = filtered.filter(g => g.title && g.title.toLowerCase().includes(q));
  }

  if (appState.activeFilter === 'favorites') {
    filtered = filtered.filter(g => g.favorite);
  } else if (appState.activeFilter === 'recent') {
    filtered = filtered.filter(g => g.lastPlayed);
  }

  // 2. Sort games based on dropdown selection
  if (appState.activeSort === 'name_asc') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (appState.activeSort === 'name_desc') {
    filtered.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
  } else if (appState.activeSort === 'playtime') {
    filtered.sort((a, b) => (b.playtimeMinutes || 0) - (a.playtimeMinutes || 0));
  } else if (appState.activeSort === 'added') {
    filtered.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  } else {
    // 'recent'
    filtered.sort((a, b) => {
      const timeA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
      const timeB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
      if (timeA === timeB) return Number(b.id || 0) - Number(a.id || 0);
      return timeB - timeA;
    });
  }

  if (filtered.length === 0) {
    libraryEmpty.style.display = 'flex';
    const emptyTitle = document.querySelector('#library-empty h3');
    const emptyDesc = document.querySelector('#library-empty p');
    if (emptyTitle) emptyTitle.innerText = 'No matching games found';
    if (emptyDesc) emptyDesc.innerText = 'Try adjusting your search terms or filter category.';
  } else {
    libraryEmpty.style.display = 'none';
  }

  appState.bigPictureSelectedIndex = Math.min(appState.bigPictureSelectedIndex, Math.max(0, filtered.length - 1));

  filtered.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';
    const safeTitle = escapeHtml(game.title);
    const safeExePath = escapeHtml(game.exePath);
    const safeGameId = escapeHtml(game.id);
    const isFavorited = !!game.favorite;
    const playtimeText = formatPlaytime(game.playtimeMinutes);
    const lastPlayedText = formatLastPlayed(game.lastPlayed);
    
    // Cover rendering
    let coverHtml = `
      <div class="game-cover-placeholder">
        <i class="fa-solid fa-gamepad"></i>
        <span>${safeTitle}</span>
      </div>
    `;
    
    if (game.coverPath) {
      const formattedCover = game.coverPath.replace('app-file://', 'app-file:///');
      coverHtml = `<img src="${escapeHtml(formattedCover)}" class="game-cover" alt="${safeTitle}">`;
    }
    
    card.innerHTML = `
      <div class="game-cover-container">
        ${coverHtml}
        <button class="game-favorite-btn ${isFavorited ? 'favorited' : ''}" data-id="${safeGameId}" title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
          <i class="fa-solid fa-star"></i>
        </button>
        <div class="game-playtime-badge">
          <i class="fa-solid fa-clock"></i> ${escapeHtml(playtimeText)}
        </div>
        <div class="game-actions-overlay">
          <button class="play-btn" data-id="${safeGameId}">
            <i class="fa-solid fa-play"></i> PLAY
          </button>
          <div class="cover-quick-actions">
            <button class="quick-action-btn folder-btn" data-id="${safeGameId}" title="Open game folder">
              <i class="fa-solid fa-folder-open"></i> Folder
            </button>
            <button class="quick-action-btn shortcut-btn" data-id="${safeGameId}" title="Create desktop shortcut">
              <i class="fa-solid fa-link"></i> Shortcut
            </button>
          </div>
        </div>
      </div>
      <div class="game-card-info">
        <div>
          <div class="game-title" title="${safeTitle}">${safeTitle}</div>
          <div class="game-exe-label" title="${safeExePath}">${safeExePath}</div>
          <div class="game-card-meta-row">
            <span><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(lastPlayedText)}</span>
            <span><i class="fa-brands fa-steam"></i> Steam check</span>
          </div>
        </div>
        <div class="action-buttons-row">
          <button class="icon-only-btn edit-btn" data-id="${safeGameId}" title="Edit game details">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="icon-only-btn delete-btn delete-hover" data-id="${safeGameId}" title="Uninstall game">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;

    // Attach favorite toggle event
    card.querySelector('.game-favorite-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const gId = e.currentTarget.dataset.id;
      const res = await window.api.toggleGameFavorite(gId);
      if (res.success) {
        showToast(res.favorite ? 'Added to Favorites ⭐' : 'Removed from Favorites', game.title, 'info', 2000);
        await loadLibrary();
      }
    });

    // Attach play event
    card.querySelector('.play-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      await launchGameWithSteamCheck(gId);
    });

    card.querySelector('.folder-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      const res = await window.api.openGameFolder(gId);
      if (!res.success) {
        showToast('Could not open folder', res.error, 'error');
      }
    });

    card.querySelector('.shortcut-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      const res = await window.api.createGameShortcut(gId);
      if (res.success) {
        showToast('Desktop Shortcut Created', `Created shortcut for ${game.title}`, 'success');
      } else {
        showToast('Shortcut Failed', res.error, 'error');
      }
    });
    
    // Attach edit event
    card.querySelector('.edit-btn').addEventListener('click', (e) => {
      const gId = e.currentTarget.dataset.id;
      openEditModal(gId);
    });
    
    // Attach delete event
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      const gId = e.currentTarget.dataset.id;
      openDeleteModal(gId);
    });
    
    // Audio feedback on hover
    card.addEventListener('mouseenter', () => {
      sfx.play('hover');
    });

    gamesGrid.appendChild(card);
  });

  if (appState.bigPictureActive) {
    renderBigPicture();
  }
}

// Open Edit modal
function openEditModal(gameId) {
  const game = appState.library.find(g => g.id === gameId);
  if (!game) return;
  
  document.getElementById('edit-game-id').value = game.id;
  document.getElementById('edit-game-title').value = game.title;
  document.getElementById('edit-game-exe').value = game.exePath;
  
  const preview = document.getElementById('edit-cover-preview-img');
  preview.innerHTML = '';
  
  if (game.coverPath) {
    const formattedCover = game.coverPath.replace('app-file://', 'app-file:///');
    preview.style.backgroundImage = `url('${formattedCover}')`;
    preview.dataset.coverPath = game.coverPath;
  } else {
    preview.style.backgroundImage = 'none';
    preview.innerHTML = '<i class="fa-solid fa-image placeholder-icon"></i>';
    preview.dataset.coverPath = '';
  }
  
  showModal(modalEditGame);
}

// Open Delete modal
function openDeleteModal(gameId) {
  const game = appState.library.find(g => g.id === gameId);
  if (!game) return;
  
  document.getElementById('delete-game-title').innerText = game.title;
  const confirmBtn = document.getElementById('modal-btn-confirm-delete');
  
  // Clone button to clear old event listeners
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  
  newConfirmBtn.addEventListener('click', async () => {
    const deleteFiles = document.getElementById('delete-files-checkbox').checked;
    const res = await window.api.deleteGame(gameId, deleteFiles);
    if (res.success) {
      closeActiveModal();
      await loadLibrary();
    } else {
      alert('Failed to delete game.');
    }
  });
  
  showModal(modalDeleteConfirm);
}

// ========================================================
// Minecraft Launcher & Mod Center Frontend Controller
// ========================================================
// Minecraft Launcher & Mod Center Frontend Controller
// ========================================================
let mcState = {
  activeTab: 'mod', // 'mod', 'modpack', 'resourcepack', 'shader', 'installed', 'logs'
  profile: null,
  instancesData: { activeInstanceId: 'default-fabric', instances: [] },
  activeInstance: null,
  searchQuery: '',
  searchDebounce: null,
  isLaunching: false,
  installedMods: [],
  installedFilter: 'all', // 'all', 'enabled', 'disabled'
  installedSearch: '',
  modUpdates: [],
  rawLogLines: [],
  logFilter: 'all', // 'all', 'info', 'warn', 'error'
  autoScrollLogs: true
};

let mcHubInitialized = false;

async function setupMinecraftHub() {
  if (mcHubInitialized) return;
  mcHubInitialized = true;

  const btnLoginMs = document.getElementById('mc-btn-login-ms');
  const btnOffline = document.getElementById('mc-btn-offline-mode');
  const btnLogout = document.getElementById('mc-btn-logout');
  const selectInstance = document.getElementById('mc-select-instance');
  const btnNewInstance = document.getElementById('mc-btn-new-instance');
  const btnDeleteInstance = document.getElementById('mc-btn-delete-instance');
  const selectVersion = document.getElementById('mc-select-version');
  const selectLoader = document.getElementById('mc-select-loader');
  const ramSlider = document.getElementById('mc-ram-slider');
  const ramDisplay = document.getElementById('mc-ram-display');
  const btnLaunch = document.getElementById('mc-btn-launch');
  const searchInput = document.getElementById('mc-mod-search-input');
  const searchClear = document.getElementById('mc-mod-search-clear');
  const sortSelect = document.getElementById('mc-filter-sort');
  const btnOpenMods = document.getElementById('mc-btn-open-mods-folder');
  const btnOpenMc = document.getElementById('mc-btn-open-mc-folder');

  // Installed mods UI elements
  const installedSearchInput = document.getElementById('mc-installed-search-input');
  const btnEnableAll = document.getElementById('mc-btn-enable-all');
  const btnDisableAll = document.getElementById('mc-btn-disable-all');
  const btnCheckUpdates = document.getElementById('mc-btn-check-updates');
  const dropzone = document.getElementById('mc-mod-dropzone');
  const fileInput = document.getElementById('mc-mod-file-input');

  // Logs UI elements
  const btnCopyLogs = document.getElementById('mc-btn-copy-logs');
  const btnUploadMclogs = document.getElementById('mc-btn-upload-mclogs');
  const btnClearLogs = document.getElementById('mc-btn-clear-logs');
  const logAutoScrollCheck = document.getElementById('mc-log-autoscroll');

  try {
    mcState.profile = await window.api.mcGetProfile();
    mcState.instancesData = await window.api.mcGetInstances();
    mcState.activeInstance = await window.api.mcGetActiveInstance();
  } catch (e) {
    console.warn('Failed to load initial MC profile/instances:', e);
  }

  renderMinecraftAccount();
  renderMinecraftInstances();

  // Fetch official versions to populate both Hero and Modal dropdowns
  window.api.mcGetVersions().then(res => {
    if (res && res.versions) {
      const modalVerSelect = document.getElementById('mc-modal-inst-version');

      [selectVersion, modalVerSelect].forEach(selectEl => {
        if (!selectEl) return;
        const currentVal = selectEl.value;
        selectEl.innerHTML = '';
        res.versions.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.id;
          opt.innerText = v.id === res.latest?.release ? `${v.id} (Latest Release)` : v.id;
          if (v.id === currentVal || (!currentVal && v.id === '1.20.1')) opt.selected = true;
          selectEl.appendChild(opt);
        });
      });

      if (mcState.activeInstance?.version && selectVersion) {
        selectVersion.value = mcState.activeInstance.version;
      }
    }
  }).catch(() => {});

  // Instance Selector Change
  selectInstance?.addEventListener('change', async (e) => {
    const selectedId = e.target.value;
    sfx.play('click');
    const res = await window.api.mcSetActiveInstance(selectedId);
    if (res && res.success) {
      mcState.activeInstance = res.activeInstance;
      syncConfigFromActiveInstance();
      loadInstalledMods();
      searchModrinthMods();
      showToast('Instance Switched', `Active instance: ${res.activeInstance.name}`, 'info', 2500);
    }
  });

  // Modal Version/Loader change auto-updates instance name
  const modalNameInput = document.getElementById('mc-modal-inst-name');
  const modalVerSelect = document.getElementById('mc-modal-inst-version');
  const modalLoaderSelect = document.getElementById('mc-modal-inst-loader');

  const updateModalDefaultName = () => {
    if (!modalNameInput || !modalVerSelect || !modalLoaderSelect) return;
    const v = modalVerSelect.value || '1.20.1';
    const l = modalLoaderSelect.value || 'fabric';
    const lTitle = l.charAt(0).toUpperCase() + l.slice(1);
    modalNameInput.value = `${lTitle} ${v}`;
  };

  modalVerSelect?.addEventListener('change', updateModalDefaultName);
  modalLoaderSelect?.addEventListener('change', updateModalDefaultName);

  // New Instance Modal Open
  btnNewInstance?.addEventListener('click', () => {
    sfx.play('click');
    const modal = document.getElementById('modal-mc-create-instance');
    const modalRam = document.getElementById('mc-modal-inst-ram');
    const modalRamDisp = document.getElementById('mc-modal-ram-display');
    if (modalRam && modalRamDisp) {
      modalRam.value = 4;
      modalRamDisp.innerText = '4 GB';
      modalRam.oninput = (e) => { modalRamDisp.innerText = `${e.target.value} GB`; };
    }
    updateModalDefaultName();
    showModal(modal);
  });

  // Create Instance Confirm
  const btnModalCreate = document.getElementById('mc-modal-btn-create');
  btnModalCreate?.addEventListener('click', async () => {
    const name = modalNameInput?.value?.trim() || 'New Instance';
    const version = modalVerSelect?.value || '1.20.1';
    const loader = modalLoaderSelect?.value || 'fabric';
    const ramInput = document.getElementById('mc-modal-inst-ram');
    const ramMax = parseInt(ramInput?.value || '4', 10);

    const res = await window.api.mcCreateInstance({
      name,
      version,
      loader,
      ramMax,
      ramMin: Math.max(2, Math.floor(ramMax / 2)),
      icon: 'cube'
    });

    if (res && res.success) {
      sfx.play('action');
      closeActiveModal();
      mcState.instancesData.instances = res.instances;
      mcState.instancesData.activeInstanceId = res.instance.id;
      mcState.activeInstance = res.instance;
      renderMinecraftInstances();
      loadInstalledMods();
      searchModrinthMods();
      showToast('Instance Created!', `Created & activated "${res.instance.name}".`, 'success', 3500);
    }
  });

  // Delete Instance
  btnDeleteInstance?.addEventListener('click', async () => {
    if (!mcState.activeInstance) return;
    if (mcState.instancesData.instances.length <= 1) {
      alert('You must keep at least one instance.');
      return;
    }

    if (confirm(`Are you sure you want to delete the instance "${mcState.activeInstance.name}"? All its mods and saves will be removed.`)) {
      sfx.play('click');
      const res = await window.api.mcDeleteInstance(mcState.activeInstance.id);
      if (res && res.success) {
        mcState.instancesData.instances = res.instances;
        mcState.instancesData.activeInstanceId = res.activeInstanceId;
        mcState.activeInstance = await window.api.mcGetActiveInstance();
        renderMinecraftInstances();
        loadInstalledMods();
        searchModrinthMods();
        showToast('Instance Deleted', 'Instance removed successfully.', 'info', 3000);
      }
    }
  });

  // Config change listeners for active instance
  const saveCurrentInstanceConfig = () => {
    if (!mcState.activeInstance || !selectVersion || !selectLoader || !ramSlider) return;
    const updates = {
      version: selectVersion.value,
      loader: selectLoader.value,
      ramMax: parseInt(ramSlider.value, 10),
      ramMin: Math.max(2, Math.floor(parseInt(ramSlider.value, 10) / 2))
    };
    mcState.activeInstance = { ...mcState.activeInstance, ...updates };
    window.api.mcUpdateInstance(mcState.activeInstance.id, updates);
  };

  selectVersion?.addEventListener('change', () => {
    saveCurrentInstanceConfig();
    searchModrinthMods();
  });
  selectLoader?.addEventListener('change', () => {
    saveCurrentInstanceConfig();
    searchModrinthMods();
  });
  ramSlider?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (ramDisplay) ramDisplay.innerText = `${val} GB`;
    saveCurrentInstanceConfig();
  });

  // Microsoft Login
  btnLoginMs?.addEventListener('click', async () => {
    sfx.play('click');
    showToast('Microsoft Login', 'Opening secure Microsoft login window...', 'info', 4000);
    const res = await window.api.mcLoginMicrosoft();
    if (res && res.success) {
      mcState.profile = res.profile;
      renderMinecraftAccount();
      sfx.play('action');
      showToast('Welcome, ' + res.profile.gamertag + '!', 'Microsoft Account linked successfully.', 'success', 4000);
    } else {
      showToast('Login Canceled / Failed', res?.error || 'Could not authenticate Microsoft account.', 'error', 4000);
    }
  });

  // Advanced Options Open
  const btnOpenAdvanced = document.getElementById('mc-btn-open-advanced');
  btnOpenAdvanced?.addEventListener('click', () => {
    sfx.play('click');
    openAdvancedOptions();
  });

  // Account Manager Modal Open
  const btnSwitchAccount = document.getElementById('mc-btn-switch-account');
  btnSwitchAccount?.addEventListener('click', () => {
    sfx.play('click');
    openMinecraftAccountManagerModal();
  });

  const modalBtnAddMs = document.getElementById('mc-modal-btn-add-ms');
  modalBtnAddMs?.addEventListener('click', async () => {
    sfx.play('click');
    showToast('Microsoft Login', 'Opening secure Microsoft login window...', 'info', 4000);
    const res = await window.api.mcLoginMicrosoft();
    if (res && res.success) {
      mcState.profile = res.profile;
      renderMinecraftAccount();
      openMinecraftAccountManagerModal();
      sfx.play('action');
      showToast('Welcome, ' + res.profile.gamertag + '!', 'Microsoft Account linked successfully.', 'success', 4000);
    } else {
      showToast('Login Canceled / Failed', res?.error || 'Could not authenticate Microsoft account.', 'error', 4000);
    }
  });

  const modalBtnAddOffline = document.getElementById('mc-modal-btn-add-offline');
  modalBtnAddOffline?.addEventListener('click', () => {
    sfx.play('click');
    closeActiveModal();
    openSkinStudio();
  });

  // Offline Skin Studio Open (via offline button or clicking avatar)
  btnOffline?.addEventListener('click', () => {
    sfx.play('click');
    openSkinStudio();
  });

  const accountAvatar = document.getElementById('mc-account-avatar');
  const accountAvatarBtn = document.getElementById('mc-account-avatar-btn');
  [accountAvatar, accountAvatarBtn].forEach(el => {
    el?.addEventListener('click', () => {
      if (mcState.profile?.isOffline || !mcState.profile) {
        sfx.play('click');
        openSkinStudio();
      } else {
        openMinecraftAccountManagerModal();
      }
    });
  });

  // Microsoft Login
  btnLoginMs?.addEventListener('click', async () => {
    sfx.play('click');
    showToast('Microsoft Login', 'Opening secure Microsoft login window...', 'info', 4000);
    const res = await window.api.mcLoginMicrosoft();
    if (res && res.success) {
      mcState.profile = res.profile;
      renderMinecraftAccount();
      sfx.play('action');
      showToast('Welcome, ' + res.profile.gamertag + '!', 'Microsoft Account linked successfully.', 'success', 4000);
    } else {
      showToast('Login Canceled / Failed', res?.error || 'Could not authenticate Microsoft account.', 'error', 4000);
    }
  });

  // Logout
  btnLogout?.addEventListener('click', async () => {
    sfx.play('click');
    await window.api.mcLogout();
    mcState.profile = null;
    renderMinecraftAccount();
    showToast('Signed Out', 'Minecraft account disconnected.', 'info', 2500);
  });

  // Folder Openers
  btnOpenMods?.addEventListener('click', () => {
    sfx.play('click');
    window.api.mcOpenFolder('mods', mcState.activeInstance?.id);
  });
  btnOpenMc?.addEventListener('click', () => {
    sfx.play('click');
    window.api.mcOpenFolder('root', mcState.activeInstance?.id);
  });

  // Mod Center Tab switching
  document.querySelectorAll('.mc-mod-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      sfx.play('hover');
      document.querySelectorAll('.mc-mod-tab').forEach(t => t.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      mcState.activeTab = target.dataset.tab;

      const browseToolbar = document.getElementById('mc-browse-toolbar');
      const modsGrid = document.getElementById('mc-mods-grid');
      const installedContainer = document.getElementById('mc-installed-container');
      const logsContainer = document.getElementById('mc-logs-container');

      if (mcState.activeTab === 'installed') {
        if (browseToolbar) browseToolbar.style.display = 'none';
        if (modsGrid) modsGrid.style.display = 'none';
        if (installedContainer) installedContainer.style.display = 'flex';
        if (logsContainer) logsContainer.style.display = 'none';
        loadInstalledMods();
      } else if (mcState.activeTab === 'logs') {
        if (browseToolbar) browseToolbar.style.display = 'none';
        if (modsGrid) modsGrid.style.display = 'none';
        if (installedContainer) installedContainer.style.display = 'none';
        if (logsContainer) {
          logsContainer.style.display = 'flex';
          const wrapper = document.getElementById('mc-logs-terminal-wrapper');
          if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
        }
      } else {
        if (browseToolbar) browseToolbar.style.display = 'flex';
        if (modsGrid) modsGrid.style.display = 'grid';
        if (installedContainer) installedContainer.style.display = 'none';
        if (logsContainer) logsContainer.style.display = 'none';
        searchModrinthMods();
      }
    });
  });

  // Installed Mods Filter Pills
  document.querySelectorAll('.mc-filter-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      sfx.play('click');
      document.querySelectorAll('.mc-filter-pill').forEach(p => p.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      mcState.installedFilter = target.dataset.modFilter;
      renderInstalledModsList();
    });
  });

  // Installed Mods Search Filter
  installedSearchInput?.addEventListener('input', (e) => {
    mcState.installedSearch = e.target.value.toLowerCase().trim();
    renderInstalledModsList();
  });

  // Enable All / Disable All
  btnEnableAll?.addEventListener('click', async () => {
    sfx.play('click');
    const instId = mcState.activeInstance?.id;
    await window.api.mcToggleAllMods(true, instId);
    showToast('All Mods Enabled', 'Enabled all mods in active instance.', 'success', 2000);
    loadInstalledMods();
  });

  btnDisableAll?.addEventListener('click', async () => {
    sfx.play('click');
    const instId = mcState.activeInstance?.id;
    await window.api.mcToggleAllMods(false, instId);
    showToast('All Mods Disabled', 'Disabled all mods in active instance.', 'info', 2000);
    loadInstalledMods();
  });

  // Check Mod Updates
  btnCheckUpdates?.addEventListener('click', async () => {
    sfx.play('click');
    const icon = document.getElementById('mc-icon-check-updates');
    if (icon) icon.classList.add('spin-icon');
    showToast('Checking Mod Updates', 'Scanning installed mods against Modrinth...', 'info', 3000);

    const instId = mcState.activeInstance?.id;
    const res = await window.api.mcCheckModUpdates(instId);
    if (icon) icon.classList.remove('spin-icon');

    if (res && res.updates) {
      mcState.modUpdates = res.updates;
      renderInstalledModsList();
      if (res.updates.length > 0) {
        showToast('Updates Found!', `${res.updates.length} mod(s) have updates available.`, 'success', 4000);
      } else {
        showToast('All Mods Up to Date', 'All installed mods match latest versions.', 'success', 3000);
      }
    }
  });

  // Drag and Drop Zone
  if (dropzone) {
    dropzone.addEventListener('click', () => {
      fileInput?.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');

      const files = Array.from(e.dataTransfer?.files || []);
      const filePaths = files
        .map(f => f.path)
        .filter(p => p && (p.endsWith('.jar') || p.endsWith('.zip')));

      if (filePaths.length > 0) {
        sfx.play('action');
        const instId = mcState.activeInstance?.id;
        const res = await window.api.mcInstallLocalJars(filePaths, instId);
        if (res && res.success) {
          sfx.play('download_complete');
          showToast('Mods Installed!', `Successfully installed ${res.count} mod file(s).`, 'success', 3500);
          loadInstalledMods();
        }
      } else {
        showToast('Invalid File Type', 'Please drop .jar or .zip Minecraft mod files.', 'warning', 3000);
      }
    });
  }

  fileInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const filePaths = files.map(f => f.path).filter(p => p && (p.endsWith('.jar') || p.endsWith('.zip')));
    if (filePaths.length > 0) {
      const instId = mcState.activeInstance?.id;
      const res = await window.api.mcInstallLocalJars(filePaths, instId);
      if (res && res.success) {
        sfx.play('download_complete');
        showToast('Mods Installed!', `Successfully installed ${res.count} mod file(s).`, 'success', 3500);
        loadInstalledMods();
      }
    }
  });

  // Game Logs Controller
  document.querySelectorAll('.mc-log-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      sfx.play('click');
      document.querySelectorAll('.mc-log-filter-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      mcState.logFilter = target.dataset.level;
      filterConsoleLogs();
    });
  });

  logAutoScrollCheck?.addEventListener('change', (e) => {
    mcState.autoScrollLogs = e.target.checked;
  });

  btnCopyLogs?.addEventListener('click', () => {
    sfx.play('click');
    const raw = mcState.rawLogLines.join('\n');
    navigator.clipboard.writeText(raw).then(() => {
      showToast('Logs Copied', 'Console logs copied to clipboard.', 'success', 2500);
    });
  });

  btnUploadMclogs?.addEventListener('click', async () => {
    sfx.play('click');
    const raw = mcState.rawLogLines.join('\n');
    if (!raw.trim()) {
      showToast('Console Empty', 'No logs to share yet.', 'warning', 2500);
      return;
    }

    showToast('Uploading to mclo.gs', 'Publishing log to secure pastebin...', 'info', 3000);
    const res = await window.api.mcUploadLog(raw);
    if (res && res.success && res.url) {
      navigator.clipboard.writeText(res.url);
      sfx.play('action');
      showToast('Log Shared!', `Link copied to clipboard: ${res.url}`, 'success', 6000);
    } else {
      showToast('Upload Failed', res?.error || 'Could not upload to mclo.gs', 'error', 4000);
    }
  });

  btnClearLogs?.addEventListener('click', () => {
    sfx.play('click');
    mcState.rawLogLines = [];
    const terminal = document.getElementById('mc-logs-terminal');
    const counter = document.getElementById('mc-logs-line-counter');
    if (terminal) terminal.innerHTML = '';
    if (counter) counter.innerText = '0 lines';
    appendGameLog('[ANTIGRAVITY] Console cleared.');
  });

  // Search & Filters for Modrinth
  searchInput?.addEventListener('input', (e) => {
    mcState.searchQuery = e.target.value.trim();
    if (searchClear) searchClear.style.display = mcState.searchQuery ? 'block' : 'none';
    clearTimeout(mcState.searchDebounce);
    mcState.searchDebounce = setTimeout(() => {
      searchModrinthMods();
    }, 350);
  });

  searchClear?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    mcState.searchQuery = '';
    searchClear.style.display = 'none';
    searchModrinthMods();
  });

  sortSelect?.addEventListener('change', () => {
    searchModrinthMods();
  });

  // Play Minecraft Button
  btnLaunch?.addEventListener('click', () => {
    launchMinecraft();
  });

  // Progress Listeners
  window.api.onMcLaunchProgress((data) => {
    const progressBox = document.getElementById('mc-launch-progress-box');
    const statusText = document.getElementById('mc-launch-status-text');
    const percentEl = document.getElementById('mc-launch-percent');
    const barFill = document.getElementById('mc-launch-bar-fill');

    if (progressBox) progressBox.style.display = 'flex';
    if (percentEl) percentEl.innerText = `${data.percent || 0}%`;
    if (barFill) barFill.style.width = `${data.percent || 0}%`;
    if (statusText) {
      if (data.type === 'java') {
        statusText.innerHTML = `<i class="fa-solid fa-mug-saucer spin-icon"></i> ${escapeHtml(data.task || 'Preparing Java Runtime...')}`;
      } else if (data.type === 'loader') {
        statusText.innerHTML = `<i class="fa-solid fa-gear spin-icon"></i> ${escapeHtml(data.task || 'Preparing Loader...')}`;
      } else if (data.type === 'assets') {
        statusText.innerHTML = `<i class="fa-solid fa-cloud-arrow-down spin-icon"></i> Downloading Assets (${data.current || 0}/${data.total || 0})...`;
      } else if (data.type === 'natives' || data.type === 'classes') {
        statusText.innerHTML = `<i class="fa-solid fa-layer-group spin-icon"></i> Unpacking Libraries & Natives...`;
      } else {
        statusText.innerHTML = `<i class="fa-solid fa-arrows-rotate spin-icon"></i> Loading ${escapeHtml(data.name || data.task || 'Minecraft')}...`;
      }
    }
  });

  window.api.onMcModpackProgress((data) => {
    const progressBox = document.getElementById('mc-launch-progress-box');
    const statusText = document.getElementById('mc-launch-status-text');
    const percentEl = document.getElementById('mc-launch-percent');
    const barFill = document.getElementById('mc-launch-bar-fill');

    if (progressBox) progressBox.style.display = 'flex';
    if (percentEl) percentEl.innerText = `${data.percent || 0}%`;
    if (barFill) barFill.style.width = `${data.percent || 0}%`;
    if (statusText) statusText.innerHTML = `<i class="fa-solid fa-box-open spin-icon"></i> ${escapeHtml(data.text || 'Installing Modpack...')}`;
  });

  window.api.onMcLog((log) => {
    appendGameLog(log);
  });

  window.api.onMcClosed((data) => {
    mcState.isLaunching = false;
    const btnLaunch = document.getElementById('mc-btn-launch');
    const progressBox = document.getElementById('mc-launch-progress-box');
    if (btnLaunch) {
      btnLaunch.disabled = false;
      btnLaunch.innerHTML = '<i class="fa-solid fa-play"></i> <span>PLAY MINECRAFT</span>';
    }
    if (progressBox) {
      setTimeout(() => { progressBox.style.display = 'none'; }, 2000);
    }
    appendGameLog(`[ANTIGRAVITY] Game process exited with code ${data?.exitCode || 0}.`);
    showToast('Minecraft Closed', `Game process finished (code ${data?.exitCode || 0}).`, 'info', 3000);
  });

  // Initial load
  loadInstalledMods();
  searchModrinthMods();
}

// ========================================================
// Advanced Launch Options Dialog Controller
// ========================================================
function openAdvancedOptions() {
  const modal = document.getElementById('modal-mc-advanced-options');
  const titleEl = document.getElementById('mc-adv-inst-title');
  const jvmInput = document.getElementById('mc-adv-jvm-args');
  const javaPathInput = document.getElementById('mc-adv-java-path');
  const widthInput = document.getElementById('mc-adv-width');
  const heightInput = document.getElementById('mc-adv-height');
  const fsCheck = document.getElementById('mc-adv-fullscreen');
  const serverInput = document.getElementById('mc-adv-server');
  const btnBrowseJava = document.getElementById('mc-adv-btn-browse-java');
  const btnClearJava = document.getElementById('mc-adv-btn-clear-java');
  const btnSave = document.getElementById('mc-adv-btn-save');

  const inst = mcState.activeInstance;
  if (!inst) return;

  if (titleEl) titleEl.innerText = inst.name;
  if (jvmInput) jvmInput.value = inst.jvmArgs || '';
  if (javaPathInput) javaPathInput.value = inst.customJavaPath || '';
  if (widthInput) widthInput.value = inst.windowWidth || 1280;
  if (heightInput) heightInput.value = inst.windowHeight || 720;
  if (fsCheck) fsCheck.checked = Boolean(inst.fullscreen);
  if (serverInput) serverInput.value = inst.serverAddress || '';

  btnBrowseJava.onclick = async () => {
    const res = await window.api.mcBrowseFile('java');
    if (res && res.filePath) {
      javaPathInput.value = res.filePath;
    }
  };

  btnClearJava.onclick = () => {
    javaPathInput.value = '';
  };

  btnSave.onclick = async () => {
    sfx.play('action');
    const updates = {
      jvmArgs: jvmInput?.value?.trim() || '',
      customJavaPath: javaPathInput?.value?.trim() || '',
      windowWidth: parseInt(widthInput?.value || '1280', 10),
      windowHeight: parseInt(heightInput?.value || '720', 10),
      fullscreen: Boolean(fsCheck?.checked),
      serverAddress: serverInput?.value?.trim() || ''
    };

    mcState.activeInstance = { ...mcState.activeInstance, ...updates };
    await window.api.mcUpdateInstance(inst.id, updates);
    closeActiveModal();
    showToast('Settings Saved', `Updated launch options for "${inst.name}".`, 'success', 3000);
  };

  showModal(modal);
}

// ========================================================
// Offline Player & Skin Studio Controller
// ========================================================
const SKIN_PRESETS = [
  { id: 'Steve', name: 'Steve', model: 'classic', avatar: 'https://mc-heads.net/avatar/Steve/128', body: 'https://mc-heads.net/body/Steve/256' },
  { id: 'Alex', name: 'Alex', model: 'slim', avatar: 'https://mc-heads.net/avatar/Alex/128', body: 'https://mc-heads.net/body/Alex/256' },
  { id: 'Technoblade', name: 'Technoblade', model: 'classic', avatar: 'https://mc-heads.net/avatar/Technoblade/128', body: 'https://mc-heads.net/body/Technoblade/256' },
  { id: 'Notch', name: 'Notch', model: 'classic', avatar: 'https://mc-heads.net/avatar/Notch/128', body: 'https://mc-heads.net/body/Notch/256' },
  { id: 'Dream', name: 'Dream', model: 'classic', avatar: 'https://mc-heads.net/avatar/Dream/128', body: 'https://mc-heads.net/body/Dream/256' },
  { id: 'Herobrine', name: 'Herobrine', model: 'classic', avatar: 'https://mc-heads.net/avatar/Herobrine/128', body: 'https://mc-heads.net/body/Herobrine/256' },
  { id: 'DanTDM', name: 'DanTDM', model: 'classic', avatar: 'https://mc-heads.net/avatar/DanTDM/128', body: 'https://mc-heads.net/body/DanTDM/256' },
  { id: 'MumboJumbo', name: 'MumboJumbo', model: 'classic', avatar: 'https://mc-heads.net/avatar/MumboJumbo/128', body: 'https://mc-heads.net/body/MumboJumbo/256' }
];

let skinStudioState = {
  source: 'preset', // 'preset', 'username', 'custom'
  value: 'Steve',
  model: 'classic',
  customDataUri: null,
  extractedFaceUri: null
};

function extractFaceFromSkinDataUri(dataUri) {
  return new Promise((resolve) => {
    if (!dataUri || !dataUri.startsWith('data:image/png;base64,')) return resolve(dataUri);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        // Base face (x:8, y:8, w:8, h:8)
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
        // Hat / hair overlay (x:40, y:8, w:8, h:8)
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);

        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(dataUri);
      }
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

function openSkinStudio() {
  const modal = document.getElementById('modal-mc-offline-skin-studio');
  const nameInput = document.getElementById('mc-skin-input-name');
  const modelClassic = document.getElementById('mc-model-classic');
  const modelSlim = document.getElementById('mc-model-slim');
  const presetsGrid = document.getElementById('mc-presets-grid');
  const previewBody = document.getElementById('mc-skin-preview-body-img');
  const previewFace = document.getElementById('mc-skin-preview-face-img');
  const previewName = document.getElementById('mc-skin-preview-name-disp');
  const previewModel = document.getElementById('mc-skin-preview-model-disp');
  const previewTag = document.getElementById('mc-skin-preview-type');
  const fetchInput = document.getElementById('mc-skin-fetch-name');
  const btnFetch = document.getElementById('mc-btn-fetch-skin');
  const dropzoneSkin = document.getElementById('mc-skin-file-dropzone');
  const uploadFilename = document.getElementById('mc-skin-upload-filename');
  const btnApply = document.getElementById('mc-btn-apply-offline-skin');

  const currentProf = mcState.profile;
  const initialName = currentProf?.gamertag || 'Player';
  nameInput.value = initialName;

  skinStudioState = {
    source: currentProf?.skinSource || 'preset',
    value: currentProf?.skinValue || (initialName !== 'Player' ? initialName : 'Steve'),
    model: currentProf?.skinModel || 'classic',
    customDataUri: currentProf?.rawSkinDataUri || null,
    extractedFaceUri: currentProf?.skinUrl?.startsWith('data:') ? currentProf.skinUrl : null
  };

  if (skinStudioState.model === 'slim') modelSlim.checked = true;
  else modelClassic.checked = true;

  const updatePreviewUI = () => {
    const enteredName = nameInput.value.trim() || 'Player';
    if (previewName) previewName.innerText = enteredName;
    if (previewModel) previewModel.innerText = skinStudioState.model === 'slim' ? 'Slim 3px Arms (Alex)' : 'Classic 4px Arms (Steve)';

    if (skinStudioState.source === 'custom' && skinStudioState.customDataUri) {
      if (previewBody) previewBody.src = skinStudioState.extractedFaceUri || skinStudioState.customDataUri;
      if (previewFace) previewFace.src = skinStudioState.extractedFaceUri || skinStudioState.customDataUri;
      if (previewTag) previewTag.innerText = 'Custom Skin File';
    } else {
      const skinKey = encodeURIComponent(skinStudioState.value || 'Steve');
      if (previewBody) previewBody.src = `https://mc-heads.net/body/${skinKey}/256`;
      if (previewFace) previewFace.src = `https://mc-heads.net/avatar/${skinKey}/128`;
      if (previewTag) previewTag.innerText = `${skinStudioState.value} (${skinStudioState.source})`;
    }
  };

  // Render presets
  presetsGrid.innerHTML = '';
  SKIN_PRESETS.forEach(p => {
    const item = document.createElement('div');
    item.className = `mc-preset-item ${skinStudioState.value === p.id ? 'active' : ''}`;
    item.innerHTML = `
      <img class="mc-preset-img" src="${p.avatar}" alt="${p.name}" onerror="this.src='https://mc-heads.net/avatar/Steve/64';">
      <span class="mc-preset-label">${p.name}</span>
    `;

    item.onclick = () => {
      sfx.play('click');
      document.querySelectorAll('.mc-preset-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      skinStudioState.source = 'preset';
      skinStudioState.value = p.id;
      skinStudioState.customDataUri = null;
      skinStudioState.extractedFaceUri = null;
      updatePreviewUI();
    };

    presetsGrid.appendChild(item);
  });

  // Tab switching inside Skin Studio
  document.querySelectorAll('.mc-skin-subtab').forEach(tab => {
    tab.onclick = (e) => {
      sfx.play('hover');
      document.querySelectorAll('.mc-skin-subtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.skintab;

      document.getElementById('mc-skin-tab-presets').style.display = target === 'presets' ? 'block' : 'none';
      document.getElementById('mc-skin-tab-username').style.display = target === 'username' ? 'block' : 'none';
      document.getElementById('mc-skin-tab-upload').style.display = target === 'upload' ? 'block' : 'none';
    };
  });

  nameInput.oninput = updatePreviewUI;

  modelClassic.onchange = () => { skinStudioState.model = 'classic'; updatePreviewUI(); };
  modelSlim.onchange = () => { skinStudioState.model = 'slim'; updatePreviewUI(); };

  btnFetch.onclick = () => {
    const uname = fetchInput?.value?.trim();
    if (!uname) {
      showToast('Empty Username', 'Please enter a Minecraft username.', 'warning', 2500);
      return;
    }
    sfx.play('click');
    skinStudioState.source = 'username';
    skinStudioState.value = uname;
    skinStudioState.customDataUri = null;
    skinStudioState.extractedFaceUri = null;
    showToast('Skin Loaded', `Loaded skin for ${uname}.`, 'info', 2000);
    updatePreviewUI();
  };

  dropzoneSkin.onclick = async () => {
    const res = await window.api.mcBrowseFile('skin');
    if (res && res.dataUri) {
      skinStudioState.source = 'custom';
      skinStudioState.customDataUri = res.dataUri;
      skinStudioState.extractedFaceUri = await extractFaceFromSkinDataUri(res.dataUri);
      if (uploadFilename) uploadFilename.innerText = res.filePath ? res.filePath.split('\\').pop() : 'Custom Skin Loaded';
      showToast('Skin Uploaded', 'Custom skin file loaded!', 'success', 2500);
      updatePreviewUI();
    }
  };

  btnApply.onclick = async () => {
    sfx.play('action');
    const uname = nameInput.value.trim() || 'Player';
    let faceUri = skinStudioState.extractedFaceUri;
    if (skinStudioState.source === 'custom' && !faceUri && skinStudioState.customDataUri) {
      faceUri = await extractFaceFromSkinDataUri(skinStudioState.customDataUri);
    }

    const res = await window.api.mcSetOfflineSkin({
      username: uname,
      skinSource: skinStudioState.source,
      skinValue: skinStudioState.value,
      skinModel: skinStudioState.model,
      skinDataUri: skinStudioState.customDataUri
    });

    if (res && res.success) {
      mcState.profile = res.profile;
      if (faceUri && skinStudioState.source === 'custom') {
        mcState.profile.skinUrl = faceUri;
        mcState.profile.rawSkinDataUri = skinStudioState.customDataUri;
      }
      renderMinecraftAccount();
      closeActiveModal();
      showToast('Skin Applied!', `Offline profile & skin updated for "${uname}".`, 'success', 3500);
    }
  };

  updatePreviewUI();
  showModal(modal);
}

// ========================================================
// Mod & Modpack Version & Target Instance Picker Controller
// ========================================================
async function openModVersionPicker(project) {
  const modal = document.getElementById('modal-mc-mod-version-picker');
  const titleEl = document.getElementById('mc-picker-title');
  const iconEl = document.getElementById('mc-picker-icon');
  const nameEl = document.getElementById('mc-picker-project-name');
  const descEl = document.getElementById('mc-picker-project-desc');
  const tagsEl = document.getElementById('mc-picker-tags');
  const instSelect = document.getElementById('mc-picker-instance-select');
  const versionsContainer = document.getElementById('mc-picker-versions-container');

  if (!project || !modal) return;

  const isModpack = project.project_type === 'modpack';
  titleEl.innerText = isModpack ? 'Select Modpack Version & Target' : 'Select Mod Version & Target';
  if (nameEl) nameEl.innerText = project.title || 'Project';
  if (descEl) descEl.innerText = project.description || '';
  if (iconEl) iconEl.src = project.icon_url || 'https://mc-heads.net/avatar/Steve/64';

  if (tagsEl) {
    tagsEl.innerHTML = (project.categories || []).map(c => `<span class="mc-tag">${escapeHtml(c)}</span>`).join('');
  }

  // Populate instances dropdown
  if (instSelect) {
    instSelect.innerHTML = '';
    const currentInstId = mcState.activeInstance?.id;
    mcState.instancesData.instances.forEach(inst => {
      const opt = document.createElement('option');
      opt.value = inst.id;
      opt.innerText = `${inst.name} (${inst.version} - ${inst.loader})`;
      if (inst.id === currentInstId) opt.selected = true;
      instSelect.appendChild(opt);
    });

    if (isModpack) {
      const newOpt = document.createElement('option');
      newOpt.value = 'NEW_INSTANCE';
      newOpt.innerText = `+ Create New Instance for "${project.title}"`;
      instSelect.appendChild(newOpt);
    }
  }

  versionsContainer.innerHTML = '<div class="mc-picker-loading"><i class="fa-solid fa-arrows-rotate spin-icon"></i> Fetching all available versions from Modrinth...</div>';
  showModal(modal);

  try {
    const rawVersions = await window.api.mcGetProjectVersions(project.project_id || project.slug);
    if (!rawVersions || rawVersions.length === 0) {
      versionsContainer.innerHTML = '<div class="mc-picker-loading"><i class="fa-solid fa-circle-exclamation"></i> No versions available for this project.</div>';
      return;
    }

    let activeChannelFilter = 'all';

    const renderVersionsList = () => {
      let filtered = rawVersions;
      if (activeChannelFilter !== 'all') {
        filtered = filtered.filter(v => (v.version_type || 'release').toLowerCase() === activeChannelFilter);
      }

      if (filtered.length === 0) {
        versionsContainer.innerHTML = '<div class="mc-picker-loading">No versions matching selected channel filter.</div>';
        return;
      }

      versionsContainer.innerHTML = '';
      filtered.forEach(v => {
        const row = document.createElement('div');
        row.className = 'mc-version-row';

        const type = (v.version_type || 'release').toLowerCase();
        const badgeClass = type === 'alpha' ? 'mc-version-badge-alpha' : type === 'beta' ? 'mc-version-badge-beta' : 'mc-version-badge-release';

        const gameVers = (v.game_versions || []).slice(0, 4).join(', ');
        const loaders = (v.loaders || []).join(', ');
        const file = v.files?.find(f => f.primary || f.filename?.endsWith('.mrpack') || f.filename?.endsWith('.jar')) || v.files?.[0];
        const sizeMb = file?.size ? (file.size / (1024 * 1024)).toFixed(1) + ' MB' : '';

        row.innerHTML = `
          <div class="mc-version-meta-left">
            <div class="mc-version-title-line">
              <span class="mc-version-number">${escapeHtml(v.name || v.version_number)}</span>
              <span class="${badgeClass}">${escapeHtml(type.toUpperCase())}</span>
              ${loaders ? `<span class="mc-installed-loader-tag">${escapeHtml(loaders)}</span>` : ''}
            </div>
            <div class="mc-version-subline">
              <span><i class="fa-solid fa-gamepad"></i> MC ${escapeHtml(gameVers)}</span>
              ${sizeMb ? `<span><i class="fa-solid fa-file"></i> ${sizeMb}</span>` : ''}
              <span><i class="fa-solid fa-download"></i> ${v.downloads || 0}</span>
            </div>
          </div>
          <button class="primary-btn btn-sm btn-success mc-btn-install-version" style="white-space: nowrap;">
            <i class="fa-solid fa-download"></i> Install
          </button>
        `;

        const btnInstall = row.querySelector('.mc-btn-install-version');
        btnInstall.onclick = async () => {
          if (!file?.url) {
            showToast('Download Error', 'No downloadable file in this version.', 'error', 3000);
            return;
          }

          sfx.play('click');
          btnInstall.disabled = true;
          btnInstall.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Installing...';

          const targetInstId = instSelect.value;
          if (isModpack) {
            const res = await window.api.mcInstallModpack(file.url, project.title);
            if (res && res.success) {
              sfx.play('download_complete');
              closeActiveModal();
              mcState.instancesData = await window.api.mcGetInstances();
              mcState.activeInstance = res.instance;
              renderMinecraftInstances();
              loadInstalledMods();
              showToast('Modpack Ready!', `Installed version "${v.version_number}".`, 'success', 4000);
            } else {
              btnInstall.disabled = false;
              btnInstall.innerHTML = '<i class="fa-solid fa-download"></i> Install';
              showToast('Install Failed', res?.error || 'Modpack installation failed.', 'error', 4000);
            }
          } else {
            const res = await window.api.mcInstallMod(file.url, file.filename, project.project_type || 'mod', targetInstId);
            if (res && res.success) {
              sfx.play('download_complete');
              btnInstall.className = 'secondary-btn btn-sm';
              btnInstall.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
              showToast('Mod Installed!', `Added "${project.title}" ${v.version_number} to instance.`, 'success', 3000);
              loadInstalledMods();
            } else {
              btnInstall.disabled = false;
              btnInstall.innerHTML = '<i class="fa-solid fa-download"></i> Install';
              showToast('Install Failed', res?.error || 'Mod installation failed.', 'error', 4000);
            }
          }
        };

        versionsContainer.appendChild(row);
      });
    };

    // Filter pill buttons
    document.querySelectorAll('#modal-mc-mod-version-picker .mc-filter-pill').forEach(pill => {
      pill.onclick = () => {
        sfx.play('click');
        document.querySelectorAll('#modal-mc-mod-version-picker .mc-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeChannelFilter = pill.dataset.channel;
        renderVersionsList();
      };
    });

    renderVersionsList();
  } catch (err) {
    versionsContainer.innerHTML = `<div class="mc-picker-loading"><i class="fa-solid fa-triangle-exclamation"></i> Error loading versions: ${escapeHtml(err.message)}</div>`;
  }
}

function appendGameLog(rawLog) {
  if (!rawLog) return;
  const terminal = document.getElementById('mc-logs-terminal');
  const counter = document.getElementById('mc-logs-line-counter');
  const wrapper = document.getElementById('mc-logs-terminal-wrapper');

  const lines = rawLog.split(/\r?\n/).filter(l => l.length > 0);

  lines.forEach(line => {
    mcState.rawLogLines.push(line);

    if (terminal) {
      const lineEl = document.createElement('div');
      let levelClass = 'mc-log-info';
      let tag = '[INFO]';
      let time = new Date().toTimeString().split(' ')[0];

      const lower = line.toLowerCase();
      if (lower.includes('error') || lower.includes('fatal') || lower.includes('exception') || lower.includes('crash') || lower.includes('severe')) {
        levelClass = 'mc-log-error';
        tag = '[ERROR]';
      } else if (lower.includes('warn') || lower.includes('warning')) {
        levelClass = 'mc-log-warn';
        tag = '[WARN]';
      }

      lineEl.className = `mc-log-line ${levelClass}`;
      lineEl.dataset.level = levelClass.replace('mc-log-', '');

      // Apply current log filter
      if (mcState.logFilter !== 'all' && lineEl.dataset.level !== mcState.logFilter) {
        lineEl.style.display = 'none';
      }

      lineEl.innerHTML = `
        <span class="mc-log-time">[${time}]</span>
        <span class="mc-log-tag">${tag}</span>
        <span class="mc-log-msg">${escapeHtml(line)}</span>
      `;

      terminal.appendChild(lineEl);
    }
  });

  if (counter) {
    counter.innerText = `${mcState.rawLogLines.length} lines`;
  }

  if (mcState.autoScrollLogs && wrapper) {
    wrapper.scrollTop = wrapper.scrollHeight;
  }
}

function filterConsoleLogs() {
  const terminal = document.getElementById('mc-logs-terminal');
  if (!terminal) return;

  const lines = terminal.querySelectorAll('.mc-log-line');
  lines.forEach(line => {
    if (mcState.logFilter === 'all' || line.dataset.level === mcState.logFilter) {
      line.style.display = 'flex';
    } else {
      line.style.display = 'none';
    }
  });
}

function renderMinecraftInstances() {
  const selectInstance = document.getElementById('mc-select-instance');
  if (!selectInstance) return;

  const data = mcState.instancesData;
  selectInstance.innerHTML = '';

  data.instances.forEach(inst => {
    const opt = document.createElement('option');
    opt.value = inst.id;
    opt.innerText = `${inst.name} (${inst.version} - ${inst.loader})`;
    if (inst.id === data.activeInstanceId) opt.selected = true;
    selectInstance.appendChild(opt);
  });

  const instBadge = document.getElementById('mc-installed-inst-badge');
  if (instBadge && mcState.activeInstance) {
    instBadge.innerText = mcState.activeInstance.name;
  }

  syncConfigFromActiveInstance();
}

function syncConfigFromActiveInstance() {
  const selectVersion = document.getElementById('mc-select-version');
  const selectLoader = document.getElementById('mc-select-loader');
  const ramSlider = document.getElementById('mc-ram-slider');
  const ramDisplay = document.getElementById('mc-ram-display');
  const instBadge = document.getElementById('mc-installed-inst-badge');

  if (!mcState.activeInstance) return;

  if (instBadge) {
    instBadge.innerText = mcState.activeInstance.name;
  }
  if (selectVersion && mcState.activeInstance.version) {
    selectVersion.value = mcState.activeInstance.version;
  }
  if (selectLoader && mcState.activeInstance.loader) {
    selectLoader.value = mcState.activeInstance.loader;
  }
  if (ramSlider && mcState.activeInstance.ramMax) {
    ramSlider.value = mcState.activeInstance.ramMax;
    if (ramDisplay) ramDisplay.innerText = `${mcState.activeInstance.ramMax} GB`;
  }
}

function renderMinecraftAccount() {
  const avatar = document.getElementById('mc-account-avatar');
  const nameEl = document.getElementById('mc-account-name');
  const typeEl = document.getElementById('mc-account-type');
  const btnLoginMs = document.getElementById('mc-btn-login-ms');
  const btnOffline = document.getElementById('mc-btn-offline-mode');
  const btnLogout = document.getElementById('mc-btn-logout');
  const btnSwitch = document.getElementById('mc-btn-switch-account');

  if (mcState.profile) {
    if (avatar) avatar.src = mcState.profile.skinUrl || 'https://mc-heads.net/avatar/Steve/128';
    if (nameEl) nameEl.innerText = mcState.profile.gamertag || 'Player';
    if (typeEl) {
      if (mcState.profile.isOffline) {
        typeEl.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Offline Profile (Change skin)';
        typeEl.style.cursor = 'pointer';
        typeEl.onclick = () => openSkinStudio();
      } else {
        typeEl.innerHTML = '<i class="fa-brands fa-microsoft"></i> Microsoft Account';
        typeEl.style.cursor = 'default';
        typeEl.onclick = null;
      }
    }
    if (btnLoginMs) btnLoginMs.style.display = 'none';
    if (btnOffline) btnOffline.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-flex';
    if (btnSwitch) btnSwitch.style.display = 'inline-flex';
  } else {
    if (avatar) avatar.src = 'https://mc-heads.net/avatar/Steve/128';
    if (nameEl) nameEl.innerText = 'Not Logged In';
    if (typeEl) {
      typeEl.innerText = 'Microsoft / Offline';
      typeEl.style.cursor = 'default';
      typeEl.onclick = null;
    }
    if (btnLoginMs) btnLoginMs.style.display = 'inline-flex';
    if (btnOffline) btnOffline.style.display = 'inline-flex';
    if (btnLogout) btnLogout.style.display = 'none';
    if (btnSwitch) btnSwitch.style.display = 'none';
  }
}

async function openMinecraftAccountManagerModal() {
  const modal = document.getElementById('modal-mc-account-manager');
  const grid = document.getElementById('mc-accounts-grid');
  if (!modal || !grid) return;

  grid.innerHTML = '<div class="library-loading"><i class="fa-solid fa-arrows-rotate spin-icon"></i> Loading accounts...</div>';
  showModal(modal);

  try {
    const data = await window.api.mcGetAccounts();
    const activeId = data.activeAccountId;
    const accounts = data.accounts || [];

    grid.innerHTML = '';
    if (accounts.length === 0) {
      grid.innerHTML = '<div class="library-empty"><p>No saved accounts yet. Add a Microsoft or Offline profile!</p></div>';
      return;
    }

    accounts.forEach(acc => {
      const item = document.createElement('div');
      const isActive = acc.id === activeId;
      item.className = `mc-account-item ${isActive ? 'active' : ''}`;

      const avatarSrc = acc.skinUrl || 'https://mc-heads.net/avatar/Steve/128';
      const isMs = acc.type === 'microsoft' || !acc.isOffline;
      const typeBadge = isMs
        ? `<span class="mc-account-type-badge ms"><i class="fa-brands fa-microsoft"></i> Microsoft</span>`
        : `<span class="mc-account-type-badge offline"><i class="fa-solid fa-user"></i> Offline</span>`;

      const actionHtml = isActive
        ? `<span class="mc-account-active-tag"><i class="fa-solid fa-circle-check"></i> Active</span>`
        : `<button class="primary-btn btn-sm btn-success mc-btn-switch-to-account">Switch</button>`;

      item.innerHTML = `
        <img class="mc-account-item-avatar" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(acc.gamertag)}" onerror="this.src='https://mc-heads.net/avatar/Steve/128';">
        <div class="mc-account-item-info">
          <div class="mc-account-item-name" title="${escapeHtml(acc.gamertag)}">${escapeHtml(acc.gamertag)}</div>
          <div class="mc-account-item-meta">
            ${typeBadge}
          </div>
        </div>
        <div class="mc-account-item-actions">
          ${actionHtml}
          ${accounts.length > 1 ? `<button class="icon-only-btn text-danger mc-btn-delete-acc" title="Remove account"><i class="fa-solid fa-trash-can"></i></button>` : ''}
        </div>
      `;

      const switchBtn = item.querySelector('.mc-btn-switch-to-account');
      if (switchBtn) {
        switchBtn.onclick = async () => {
          sfx.play('action');
          const res = await window.api.mcSetActiveAccount(acc.id);
          if (res && res.success) {
            mcState.profile = res.activeAccount;
            renderMinecraftAccount();
            openMinecraftAccountManagerModal();
            showToast('Account Switched!', `Now playing as "${acc.gamertag}".`, 'success', 3000);
          }
        };
      }

      const delBtn = item.querySelector('.mc-btn-delete-acc');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (confirm(`Remove account "${acc.gamertag}" from your saved accounts?`)) {
            sfx.play('click');
            const res = await window.api.mcDeleteAccount(acc.id);
            if (res && res.success) {
              mcState.profile = res.activeAccount;
              renderMinecraftAccount();
              openMinecraftAccountManagerModal();
              showToast('Account Removed', `Removed "${acc.gamertag}".`, 'info', 2500);
            }
          }
        };
      }

      grid.appendChild(item);
    });
  } catch (err) {
    grid.innerHTML = `<div class="library-empty text-danger"><p>Error loading accounts: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function searchModrinthMods() {
  const grid = document.getElementById('mc-mods-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="library-loading"><i class="fa-solid fa-arrows-rotate spin-icon"></i> Loading items from Modrinth...</div>';

  const selectVersion = document.getElementById('mc-select-version');
  const selectLoader = document.getElementById('mc-select-loader');
  const sortSelect = document.getElementById('mc-filter-sort');

  const version = selectVersion ? selectVersion.value : '1.20.1';
  const loader = selectLoader ? selectLoader.value : 'fabric';
  const index = sortSelect ? sortSelect.value : 'relevance';

  try {
    const res = await window.api.mcSearchModrinth({
      query: mcState.searchQuery,
      projectType: mcState.activeTab,
      loader: loader,
      version: version,
      limit: 18,
      index: index
    });

    renderModrinthCards(res.hits || []);
  } catch (err) {
    console.error('Failed to search Modrinth:', err);
    grid.innerHTML = `<div class="library-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load items: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderModrinthCards(hits) {
  const grid = document.getElementById('mc-mods-grid');
  if (!grid) return;

  if (hits.length === 0) {
    grid.innerHTML = '<div class="library-empty"><i class="fa-solid fa-magnifying-glass"></i><p>No items found matching your query or version.</p></div>';
    return;
  }

  grid.innerHTML = '';
  hits.forEach(item => {
    const card = document.createElement('div');
    card.className = 'mc-mod-card';

    const iconHtml = item.icon_url
      ? `<img class="mc-mod-icon" src="${escapeHtml(item.icon_url)}" alt="${escapeHtml(item.title)}">`
      : `<div class="mc-mod-icon-placeholder"><i class="fa-solid fa-cube"></i></div>`;

    const downloadsFormatted = item.downloads > 1000000
      ? (item.downloads / 1000000).toFixed(1) + 'M'
      : item.downloads > 1000
      ? (item.downloads / 1000).toFixed(1) + 'k'
      : item.downloads;

    const tagsHtml = (item.categories || []).slice(0, 3).map(cat => `<span class="mc-tag">${escapeHtml(cat)}</span>`).join('');

    const isModpack = item.project_type === 'modpack';
    const btnLabel = isModpack ? '<i class="fa-solid fa-box-open"></i> Install Pack' : '<i class="fa-solid fa-plus"></i> Install';

    card.innerHTML = `
      <div class="mc-mod-header-row">
        ${iconHtml}
        <div class="mc-mod-meta">
          <div class="mc-mod-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="mc-mod-author">by ${escapeHtml(item.author || 'Author')}</div>
        </div>
      </div>
      <div class="mc-mod-desc">${escapeHtml(item.description || 'No description available.')}</div>
      <div class="mc-mod-footer-row">
        <div class="mc-mod-tags">
          <span class="mc-downloads-chip"><i class="fa-solid fa-download"></i> ${downloadsFormatted}</span>
          ${tagsHtml}
        </div>
        <div style="display: flex; gap: 0.4rem; align-items: center;">
          <button class="secondary-btn btn-sm mc-versions-btn" title="View all versions, loaders & changelogs" style="padding: 0.35rem 0.65rem; font-size: 0.76rem;">
            <i class="fa-solid fa-list-ul"></i> Versions
          </button>
          <button class="mc-install-btn" data-project-id="${escapeHtml(item.project_id || item.slug)}" data-project-type="${escapeHtml(item.project_type || 'mod')}">
            ${btnLabel}
          </button>
        </div>
      </div>
    `;

    const installBtn = card.querySelector('.mc-install-btn');
    const versionsBtn = card.querySelector('.mc-versions-btn');

    installBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      installModrinthProject(item, installBtn);
    });

    versionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.play('click');
      openModVersionPicker(item);
    });

    card.addEventListener('click', () => {
      sfx.play('click');
      openModVersionPicker(item);
    });

    grid.appendChild(card);
  });
}

async function installModrinthProject(project, btn) {
  sfx.play('click');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Fetching...';

  const isModpack = project.project_type === 'modpack';
  const selectVersion = document.getElementById('mc-select-version');
  const selectLoader = document.getElementById('mc-select-loader');
  const version = selectVersion ? selectVersion.value : '1.20.1';
  const loader = selectLoader ? selectLoader.value : 'fabric';

  try {
    const versions = await window.api.mcGetProjectVersions(project.project_id || project.slug, isModpack ? '' : loader, isModpack ? '' : version);
    if (!versions || versions.length === 0) {
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i> No version';
      showToast('Version Unavailable', `No compatible version found for ${project.title}.`, 'warning', 3000);
      setTimeout(() => { btn.disabled = false; btn.innerHTML = originalHtml; }, 2500);
      return;
    }

    const latestVer = versions[0];
    const file = latestVer.files.find(f => f.primary || f.filename.endsWith('.mrpack') || f.filename.endsWith('.jar')) || latestVer.files[0];
    if (!file) {
      throw new Error('No downloadable file attached');
    }

    if (isModpack) {
      btn.innerHTML = '<i class="fa-solid fa-box-open spin-icon"></i> Installing Pack...';
      showToast('Installing Modpack', `Downloading and creating instance for "${project.title}"...`, 'info', 4000);

      const res = await window.api.mcInstallModpack(file.url, project.title);
      if (res && res.success) {
        sfx.play('download_complete');
        btn.className = 'mc-install-btn installed';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Pack Ready';

        mcState.instancesData = await window.api.mcGetInstances();
        mcState.activeInstance = res.instance;
        renderMinecraftInstances();
        loadInstalledMods();
        showToast('Modpack Ready!', `Instance "${res.instance.name}" is ready to launch!`, 'success', 4000);
      } else {
        throw new Error(res?.error || 'Modpack installation failed');
      }
    } else {
      btn.innerHTML = '<i class="fa-solid fa-download spin-icon"></i> Downloading...';
      const instId = mcState.activeInstance?.id;
      const res = await window.api.mcInstallMod(file.url, file.filename, project.project_type || 'mod', instId);
      if (res && res.success) {
        sfx.play('download_complete');
        btn.className = 'mc-install-btn installed';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Installed';
        showToast('Item Installed!', `${project.title} added to "${mcState.activeInstance?.name || 'Instance'}".`, 'success', 3000);
        loadInstalledMods();
      } else {
        throw new Error(res?.error || 'Installation failed');
      }
    }
  } catch (err) {
    console.error('Install error:', err);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
    showToast('Installation Failed', err.message, 'error', 3500);
    setTimeout(() => { btn.innerHTML = originalHtml; }, 3000);
  }
}

async function loadInstalledMods() {
  const countBadge = document.getElementById('mc-installed-count');
  const instId = mcState.activeInstance?.id;
  const mods = await window.api.mcGetInstalledMods(instId);
  mcState.installedMods = mods;
  if (countBadge) countBadge.innerText = mods.length;

  renderInstalledModsList();
}

function renderInstalledModsList() {
  const installedList = document.getElementById('mc-installed-list');
  if (!installedList) return;

  const instId = mcState.activeInstance?.id;
  let filtered = mcState.installedMods;

  if (mcState.installedFilter === 'enabled') {
    filtered = filtered.filter(m => m.enabled);
  } else if (mcState.installedFilter === 'disabled') {
    filtered = filtered.filter(m => !m.enabled);
  }

  if (mcState.installedSearch) {
    const q = mcState.installedSearch;
    filtered = filtered.filter(m =>
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.cleanName && m.cleanName.toLowerCase().includes(q)) ||
      (m.description && m.description.toLowerCase().includes(q)) ||
      (m.authors && m.authors.some(a => a.toLowerCase().includes(q)))
    );
  }

  if (filtered.length === 0) {
    installedList.innerHTML = `<div class="library-empty"><i class="fa-solid fa-box-open"></i><p>No mods found for current filter in "${escapeHtml(mcState.activeInstance?.name || 'Default')}". Drop .jar files above or browse Modrinth!</p></div>`;
    return;
  }

  installedList.innerHTML = '';
  filtered.forEach(mod => {
    const item = document.createElement('div');
    item.className = `mc-installed-item ${mod.enabled ? '' : 'disabled'}`;

    const iconHtml = mod.iconDataUri
      ? `<img class="mc-installed-icon" src="${mod.iconDataUri}" alt="${escapeHtml(mod.name)}">`
      : `<div class="mc-installed-icon-placeholder"><i class="fa-solid fa-cube"></i></div>`;

    const authorsText = (mod.authors && mod.authors.length > 0) ? `by ${mod.authors.slice(0, 2).join(', ')}` : '';
    const verBadge = mod.version ? `<span class="mc-installed-ver-badge">v${escapeHtml(mod.version)}</span>` : '';
    const loaderTag = mod.loader && mod.loader !== 'unknown' ? `<span class="mc-installed-loader-tag">${escapeHtml(mod.loader)}</span>` : '';

    const hasUpdate = mcState.modUpdates.find(u => u.filename === mod.filename);
    const updateBadge = hasUpdate ? `<span class="mc-installed-ver-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444;"><i class="fa-solid fa-cloud-arrow-down"></i> Update v${escapeHtml(hasUpdate.currentVersion || '')}</span>` : '';

    item.innerHTML = `
      <div class="mc-installed-item-info">
        ${iconHtml}
        <div class="mc-installed-meta">
          <div class="mc-installed-name-row">
            <span class="mc-installed-name" title="${escapeHtml(mod.name)}">${escapeHtml(mod.name)}</span>
            ${verBadge}
            ${loaderTag}
            ${updateBadge}
          </div>
          ${mod.description ? `<div class="mc-installed-desc" title="${escapeHtml(mod.description)}">${escapeHtml(mod.description)}</div>` : ''}
          <div class="mc-installed-submeta">
            ${authorsText ? `<span>${escapeHtml(authorsText)}</span>` : ''}
            <span>${escapeHtml(mod.size)}</span>
            <span style="font-family: var(--font-mono);">${escapeHtml(mod.filename)}</span>
          </div>
        </div>
      </div>
      <div class="mc-installed-item-actions">
        <label class="switch" title="Toggle Mod Enabled/Disabled">
          <input type="checkbox" class="mc-mod-toggle" ${mod.enabled ? 'checked' : ''}>
          <span class="slider round"></span>
        </label>
        <button class="icon-only-btn text-danger mc-btn-delete-mod" title="Delete mod file">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    const toggle = item.querySelector('.mc-mod-toggle');
    toggle.addEventListener('change', async (e) => {
      sfx.play('click');
      const enable = e.target.checked;
      await window.api.mcToggleMod(mod.filename, enable, instId);
      loadInstalledMods();
    });

    const deleteBtn = item.querySelector('.mc-btn-delete-mod');
    deleteBtn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete ${mod.name || mod.cleanName}?`)) {
        sfx.play('click');
        await window.api.mcDeleteMod(mod.filename, instId);
        showToast('Mod Removed', `${mod.name || mod.cleanName} deleted.`, 'info', 2000);
        loadInstalledMods();
      }
    });

    installedList.appendChild(item);
  });
}

async function launchMinecraft() {
  if (mcState.isLaunching) return;

  const btnLaunch = document.getElementById('mc-btn-launch');
  const progressBox = document.getElementById('mc-launch-progress-box');
  const statusText = document.getElementById('mc-launch-status-text');
  const percentEl = document.getElementById('mc-launch-percent');
  const barFill = document.getElementById('mc-launch-bar-fill');

  mcState.isLaunching = true;
  sfx.play('launch');

  const active = mcState.activeInstance;
  const version = active?.version || '1.20.1';
  const loader = active?.loader || 'fabric';
  const ramMax = active?.ramMax || 4;

  if (btnLaunch) {
    btnLaunch.disabled = true;
    btnLaunch.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> <span>STARTING...</span>';
  }
  if (progressBox) {
    progressBox.style.display = 'flex';
    if (barFill) barFill.style.width = '5%';
    if (percentEl) percentEl.innerText = '5%';
    if (statusText) statusText.innerHTML = '<i class="fa-solid fa-arrows-rotate spin-icon"></i> Resolving Version & Java Runtime...';
  }

  appendGameLog(`[ANTIGRAVITY] Launching instance "${active?.name || 'Default'}" - Minecraft ${version} (${loader})...`);
  showToast('Launching Minecraft', `Starting "${active?.name || 'Default'}" with ${ramMax} GB RAM...`, 'info', 3000);

  const res = await window.api.mcLaunchGame({
    instanceId: active?.id,
    version: version,
    loader: loader,
    ramMin: active?.ramMin || 2,
    ramMax: ramMax
  });

  if (!res.success) {
    mcState.isLaunching = false;
    if (btnLaunch) {
      btnLaunch.disabled = false;
      btnLaunch.innerHTML = '<i class="fa-solid fa-play"></i> <span>PLAY MINECRAFT</span>';
    }
    if (progressBox) progressBox.style.display = 'none';
    appendGameLog(`[ANTIGRAVITY] Launch Error: ${res.error || 'Unknown error'}`);
    showToast('Launch Failed', res.error || 'Could not launch Minecraft.', 'error', 5000);
  }
}


