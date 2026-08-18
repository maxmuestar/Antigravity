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
  btnLibrary.addEventListener('click', () => {
    switchTab('library');
  });
  
  btnConfig.addEventListener('click', () => {
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
    btnLibrary.classList.add('active');
  } else if (tabId === 'config') {
    btnConfig.classList.add('active');
  }
  
  // Switch content panel
  document.querySelectorAll('.content-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
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
  document.getElementById('big-picture-close').addEventListener('click', () => {
    closeBigPicture();
  });

  document.getElementById('big-picture-fullscreen').addEventListener('click', async () => {
    await toggleBigPictureFullscreen();
  });

  document.getElementById('big-picture-play').addEventListener('click', () => {
    launchSelectedBigPictureGame();
  });

  document.getElementById('big-picture-folder').addEventListener('click', async () => {
    await openSelectedBigPictureFolder();
  });

  document.getElementById('big-picture-shortcut').addEventListener('click', async () => {
    await createSelectedBigPictureShortcut();
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
  modalOverlay.classList.add('active');
  // Close all other modals
  document.querySelectorAll('.modal-content').forEach(m => m.classList.remove('active'));
  modalElement.classList.add('active');
}

function closeActiveModal() {
  modalOverlay.classList.remove('active');
  document.querySelectorAll('.modal-content').forEach(m => m.classList.remove('active'));
  appState.pendingSelectionGameId = null;
}

// Modal actions and button hooks
function setupModalActions() {
  // Download finished actions
  document.getElementById('modal-btn-download-more').addEventListener('click', () => {
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

function getSelectedBigPictureGame() {
  return appState.library[appState.bigPictureSelectedIndex] || null;
}

async function enterBigPictureFullscreen() {
  const result = await window.api.setWindowFullscreen(true);
  if (!result?.success) {
    console.warn('Could not enter fullscreen:', result?.error);
  }
}

async function exitBigPictureFullscreen() {
  const result = await window.api.setWindowFullscreen(false);
  if (!result?.success) {
    console.warn('Could not exit fullscreen:', result?.error);
  }
}

async function toggleBigPictureFullscreen() {
  const isFullscreen = await window.api.isWindowFullscreen();
  const result = await window.api.setWindowFullscreen(!isFullscreen);
  if (!result?.success) {
    console.warn('Could not toggle fullscreen:', result?.error);
  }
}

async function openBigPicture() {
  sfx.play('big_picture');
  appState.bigPictureActive = true;
  appState.bigPictureSelectedIndex = Math.min(
    appState.bigPictureSelectedIndex,
    Math.max(appState.library.length - 1, 0)
  );
  bigPictureOverlay.classList.add('active');
  bigPictureOverlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('big-picture-open');
  renderBigPicture();
  startBigPictureControllerSupport();
  await enterBigPictureFullscreen();
}

async function closeBigPicture() {
  sfx.play('click');
  appState.bigPictureActive = false;
  stopBigPictureControllerSupport();
  bigPictureOverlay.classList.remove('active');
  bigPictureOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('big-picture-open');

  if (document.fullscreenElement === bigPictureOverlay) {
    document.exitFullscreen().catch(() => {});
  }

  await exitBigPictureFullscreen();
}

function selectBigPictureGame(index) {
  if (appState.library.length === 0) return;
  sfx.play('hover');

  const lastIndex = appState.library.length - 1;
  if (index < 0) {
    appState.bigPictureSelectedIndex = lastIndex;
  } else if (index > lastIndex) {
    appState.bigPictureSelectedIndex = 0;
  } else {
    appState.bigPictureSelectedIndex = index;
  }

  renderBigPictureSelection();
}

function renderBigPicture() {
  bigPictureRail.innerHTML = '';

  if (appState.library.length === 0) {
    bigPictureTitle.innerText = 'No games yet';
    bigPicturePath.innerText = 'Download or add a game first.';
    bigPictureCover.style.backgroundImage = 'none';
    bigPictureCover.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i>';
    return;
  }

  appState.library.forEach((game, index) => {
    const item = document.createElement('button');
    item.className = 'big-picture-game';
    item.dataset.index = index;

    const coverUrl = getCoverUrl(game);
    item.innerHTML = coverUrl
      ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(game.title)}">`
      : `<div class="big-picture-game-placeholder"><i class="fa-solid fa-gamepad"></i><span>${escapeHtml(game.title)}</span></div>`;

    item.addEventListener('click', () => {
      selectBigPictureGame(index);
    });

    item.addEventListener('dblclick', () => {
      launchSelectedBigPictureGame();
    });

    bigPictureRail.appendChild(item);
  });

  renderBigPictureSelection();
}

function renderBigPictureSelection() {
  const game = getSelectedBigPictureGame();
  if (!game) return;

  const coverUrl = getCoverUrl(game);
  const playtimeStr = formatPlaytime(game.playtimeMinutes);
  const lastPlayedStr = formatLastPlayed(game.lastPlayed);
  const favStar = game.favorite ? ' ⭐' : '';

  bigPictureTitle.innerText = `${game.title}${favStar}`;
  bigPicturePath.innerText = `${game.exePath || 'No startup path selected'} • ${playtimeStr} • ${lastPlayedStr}`;
  bigPictureCover.style.backgroundImage = coverUrl ? `url("${coverUrl}")` : 'none';
  bigPictureCover.innerHTML = coverUrl ? '' : '<i class="fa-solid fa-gamepad"></i>';

  document.querySelectorAll('.big-picture-game').forEach((item) => {
    const isSelected = Number(item.dataset.index) === appState.bigPictureSelectedIndex;
    item.classList.toggle('selected', isSelected);
    if (isSelected) {
      item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });
}

async function launchSelectedBigPictureGame() {
  const game = getSelectedBigPictureGame();
  if (!game) return;
  await launchGameWithSteamCheck(game.id);
}

async function openSelectedBigPictureFolder() {
  const game = getSelectedBigPictureGame();
  if (!game) return;

  const res = await window.api.openGameFolder(game.id);
  if (!res.success) {
    alert(`Could not open folder: ${res.error}`);
  }
}

async function createSelectedBigPictureShortcut() {
  const game = getSelectedBigPictureGame();
  if (!game) return;

  const res = await window.api.createGameShortcut(game.id);
  if (res.success) {
    alert(`Shortcut created on your desktop:\n${res.path}`);
  } else {
    alert(`Could not create shortcut: ${res.error}`);
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
  const canHandleInput = timestamp - appState.lastControllerInputAt > controllerRepeatMs;

  if (gamepad && canHandleInput) {
    const buttons = gamepad.buttons;
    const axisX = gamepad.axes[0] || 0;
    let handled = false;

    if (modalSteamWarning.classList.contains('active')) {
      if (buttons[0]?.pressed) {
        openSteamAndContinuePendingLaunch();
        handled = true;
      } else if (buttons[1]?.pressed) {
        continuePendingLaunchAnyway();
        handled = true;
      }
    } else if (modalAntivirusReminder.classList.contains('active')) {
      if (buttons[0]?.pressed || buttons[1]?.pressed) {
        closeActiveModal();
        handled = true;
      } else if (buttons[2]?.pressed) {
        window.api.openStorageFolder('data');
        handled = true;
      } else if (buttons[3]?.pressed) {
        window.api.openWindowsSecurity();
        handled = true;
      }
    } else if (buttons[14]?.pressed || axisX < -controllerAxisThreshold) {
      selectBigPictureGame(appState.bigPictureSelectedIndex - 1);
      handled = true;
    } else if (buttons[15]?.pressed || axisX > controllerAxisThreshold) {
      selectBigPictureGame(appState.bigPictureSelectedIndex + 1);
      handled = true;
    } else if (buttons[0]?.pressed) {
      launchSelectedBigPictureGame();
      handled = true;
    } else if (buttons[1]?.pressed) {
      closeBigPicture();
      handled = true;
    } else if (buttons[2]?.pressed) {
      openSelectedBigPictureFolder();
      handled = true;
    } else if (buttons[3]?.pressed) {
      createSelectedBigPictureShortcut();
      handled = true;
    } else if (buttons[9]?.pressed) {
      toggleBigPictureFullscreen();
      handled = true;
    }

    if (handled) {
      appState.lastControllerInputAt = timestamp;
    }
  }

  appState.bigPictureControllerFrame = requestAnimationFrame(pollBigPictureController);
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
