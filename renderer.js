// State Management
let appState = {
  activeTab: 'library', // 'library', 'config', 'browser'
  websites: [],
  library: [],
  activeDownloads: {},
  pendingSelectionGameId: null,
  pendingLaunchGameId: null,
  bigPictureActive: false,
  bigPictureSelectedIndex: 0,
  bigPictureControllerFrame: null,
  lastControllerInputAt: 0
};

const controllerRepeatMs = 220;
const controllerAxisThreshold = 0.55;

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
  await showAntivirusReminder();
});

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
}

// Tab Navigation
function setupTabNavigation() {
  btnLibrary.addEventListener('click', () => {
    switchTab('library');
  });
  
  btnConfig.addEventListener('click', () => {
    switchTab('config');
  });
}

function switchTab(tabId) {
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
  const storageInfo = await window.api.getStorageInfo();
  document.getElementById('antivirus-data-path').innerText = storageInfo.dataDir || 'Data folder not found';
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
    switchTab('library');
  });
  
  // Monitor address changes inside the webview
  webview.addEventListener('did-start-navigation', (e) => {
    webAddress.value = e.url;
  });
  webview.addEventListener('did-navigate', (e) => {
    webAddress.value = e.url;
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    webAddress.value = e.url;
  });
}

// Open Webpage in the browser tab
function openWebsite(url, name, element) {
  switchTab('browser');
  webview.src = url;
  
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
      <span>${site.name}</span>
      <i class="fa-solid fa-chevron-right" style="font-size: 0.7rem; opacity: 0.5;"></i>
    `;
    btn.addEventListener('click', () => {
      openWebsite(site.url, site.name, btn);
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
    item.innerHTML = `
      <div class="manage-site-info">
        <div class="manage-site-name">${site.name}</div>
        <div class="manage-site-url">${site.url}</div>
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
    
    const newSite = {
      name: nameInput.value.trim(),
      url: urlInput.value.trim()
    };
    
    appState.websites.push(newSite);
    await window.api.saveWebsites(appState.websites);
    
    // Reset form and reload list
    nameInput.value = '';
    urlInput.value = '';
    await loadWebsites();
  });
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
  document.getElementById('modal-btn-close-app').addEventListener('click', () => {
    window.api.closeApp();
  });
  
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

  document.getElementById('modal-btn-ok-antivirus').addEventListener('click', closeActiveModal);
  document.getElementById('modal-btn-close-antivirus').addEventListener('click', closeActiveModal);
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
      ? `<img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(game.title)}"><span>${escapeHtml(game.title)}</span>`
      : `<div class="big-picture-game-placeholder"><i class="fa-solid fa-gamepad"></i></div><span>${escapeHtml(game.title)}</span>`;

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
  bigPictureTitle.innerText = game.title;
  bigPicturePath.innerText = game.exePath || 'No startup path selected';
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
    if (appState.bigPictureActive) {
      renderBigPicture();
    }
    return;
  }
  
  libraryEmpty.style.display = 'none';
  appState.bigPictureSelectedIndex = Math.min(appState.bigPictureSelectedIndex, appState.library.length - 1);
  
  appState.library.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';
    const safeTitle = escapeHtml(game.title);
    const safeExePath = escapeHtml(game.exePath);
    const safeGameId = escapeHtml(game.id);
    
    // Cover rendering
    let coverHtml = `
      <div class="game-cover-placeholder">
        <i class="fa-solid fa-gamepad"></i>
        <span>${safeTitle}</span>
      </div>
    `;
    
    if (game.coverPath) {
      // Load file using custom protocol
      // Ensure the cover path has proper app-file:// structure
      const formattedCover = game.coverPath.replace('app-file://', 'app-file:///');
      coverHtml = `<img src="${escapeHtml(formattedCover)}" class="game-cover" alt="${safeTitle}">`;
    }
    
    card.innerHTML = `
      <div class="game-cover-container">
        ${coverHtml}
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
          <div class="game-helper-label">
            <i class="fa-brands fa-steam"></i> Steam check before launch
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
    
    // Attach play event
    card.querySelector('.play-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      await launchGameWithSteamCheck(gId);
    });

    card.querySelector('.folder-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      const res = await window.api.openGameFolder(gId);
      if (!res.success) {
        alert(`Could not open folder: ${res.error}`);
      }
    });

    card.querySelector('.shortcut-btn').addEventListener('click', async (e) => {
      const gId = e.currentTarget.dataset.id;
      const res = await window.api.createGameShortcut(gId);
      if (res.success) {
        alert(`Shortcut created on your desktop:\n${res.path}`);
      } else {
        alert(`Could not create shortcut: ${res.error}`);
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
