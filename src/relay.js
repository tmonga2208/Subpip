// SubPIP relay (ISOLATED world). The page script cannot use chrome.* APIs or
// fetch past the page's CSP, so this relays settings from storage and
// translate requests to the background.

import { readStoredSettings, AUTO_PIP_ACTIVE } from './shared/settings.js';

// Tells the page script which relay is speaking: after an update a tab can
// have the previous relay and its replacement at the same time
const relayId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

// False once the extension was disabled, removed, reloaded or updated under
// this page: chrome.* is dead from then on
function extensionIsThere() {
  try {
    return !!chrome.runtime?.id;
  } catch (e) {
    return false;
  }
}

async function postSettings() {
  try {
    const settings = await readStoredSettings();
    window.postMessage({ type: 'SUBPIP_SETTINGS_UPDATED', settings, relay: relayId }, '*');
  } catch (e) {
    // Extension was reloaded; this relay is orphaned
  }
}

function start() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.subpipSettings) || (area === 'local' && (changes.subpipAuth || changes[AUTO_PIP_ACTIVE]))) postSettings();
  });

  const onMessage = (event) => {
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
  };
  window.addEventListener('message', onMessage);

  // A page can outlive its extension. This relay can then no longer pass on
  // setting changes - "Auto PiP off" among them - so it says goodbye, and the
  // page script stops opening Picture-in-Picture by itself. (After an update
  // the background gives open tabs a new relay.)
  const checkExtension = () => {
    if (extensionIsThere()) return;
    clearInterval(watch);
    document.removeEventListener('visibilitychange', checkExtension);
    window.removeEventListener('message', onMessage);
    window.__SUBPIP_RELAY__ = false;
    window.postMessage({ type: 'SUBPIP_RELAY_GONE', relay: relayId }, '*');
  };
  const watch = setInterval(checkExtension, 2000);
  document.addEventListener('visibilitychange', checkExtension);

  // The page script may have loaded first and missed its own request
  postSettings();
}

// Injected on every Activate click - only start once per page
if (!window.__SUBPIP_RELAY__) {
  window.__SUBPIP_RELAY__ = true;
  start();
}
