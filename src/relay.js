// SubPIP relay (ISOLATED world). The page script cannot use chrome.* APIs or
// fetch past the page's CSP, so this relays settings from storage and
// translate requests to the background.

import { readStoredSettings } from './shared/settings.js';

async function postSettings() {
  try {
    const settings = await readStoredSettings();
    window.postMessage({ type: 'SUBPIP_SETTINGS_UPDATED', settings }, '*');
  } catch (e) {
    // Extension was reloaded; this relay is orphaned
  }
}

function start() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.subpipSettings || changes.subpipAuth)) postSettings();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'SUBPIP_SETTINGS_REQUEST') {
      postSettings();
      return;
    }

    if (event.data.type !== 'SUBPIP_TRANSLATE_REQUEST') return;
    const { id, text, targetLang, uid } = event.data;
    if (!id || !text || !targetLang) return;
    chrome.runtime.sendMessage({ type: 'TRANSLATE', text, targetLang, uid }, (response) => {
      const translation = (response && response.translation) || null;
      window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id, translation }, '*');
    });
  });

  // The page script may have loaded first and missed its own request
  postSettings();
}

// Injected on every Activate click - only start once per page
if (!window.__SUBPIP_RELAY__) {
  window.__SUBPIP_RELAY__ = true;
  start();
}
