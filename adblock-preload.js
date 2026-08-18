const { ipcRenderer } = require('electron');

// Wait for chrome object to be present and override tabs.query
function polyfillChromeTabs() {
  if (typeof window === 'undefined') return;

  window.chrome = window.chrome || {};
  window.chrome.tabs = window.chrome.tabs || {};

  // Mock chrome.tabs.query to return the active webview URL and title
  window.chrome.tabs.query = function (queryInfo, callback) {
    ipcRenderer.invoke('get-active-tab-info').then((tabInfo) => {
      if (tabInfo) {
        callback([{
          id: 1,
          index: 0,
          windowId: 1,
          active: true,
          selected: true,
          pinned: false,
          url: tabInfo.url,
          title: tabInfo.title,
          favIconUrl: ''
        }]);
      } else {
        callback([{
          id: 1,
          index: 0,
          windowId: 1,
          active: true,
          selected: true,
          pinned: false,
          url: 'about:blank',
          title: 'New Tab',
          favIconUrl: ''
        }]);
      }
    }).catch((err) => {
      console.error('Failed to get active tab info:', err);
      callback([]);
    });
  };

  // Mock chrome.tabs.sendMessage in case popup tries to talk to content scripts
  window.chrome.tabs.sendMessage = function (tabId, message, options, responseCallback) {
    if (typeof options === 'function') {
      responseCallback = options;
    }
    if (typeof responseCallback === 'function') {
      responseCallback({ success: true });
    }
  };
}

polyfillChromeTabs();
