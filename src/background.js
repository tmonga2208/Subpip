// SubPIP background service worker: translation requests, the Alt+P
// shortcut and auto-PiP content script registration.

import { ALL_SITES, readStoredSettings } from './shared/settings.js';
import { TOKEN_URL, API_BASE_URL, TOKEN_MAX_AGE_MS } from './shared/firebase.js';
import { togglePipInTab, injectRelay } from './shared/inject.js';
import { probeTab } from './popup/status.js';

// Get a fresh Firebase ID token for the signed-in user (stored by the popup)
async function getIdToken() {
  const { firebaseAuth } = await chrome.storage.local.get(['firebaseAuth']);
  if (!firebaseAuth || !firebaseAuth.idToken) return null;

  const tokenAge = Date.now() - (firebaseAuth.timestamp || 0);
  if (tokenAge < TOKEN_MAX_AGE_MS) return firebaseAuth.idToken;

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: firebaseAuth.refreshToken })
    });
    const data = await response.json();
    if (data.error) return null;
    await chrome.storage.local.set({
      firebaseAuth: {
        ...firebaseAuth,
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        timestamp: Date.now()
      }
    });
    return data.id_token;
  } catch (e) {
    return null;
  }
}

// Translate via extension context (avoids page CSP blocking fetch)
async function translateInBackground(text, targetLang, uid) {
  if (!text || !targetLang) return null;

  // Premium Translation (Google Cloud via Firebase) - the server checks
  // premium status from the ID token, not from anything the client claims
  const idToken = uid ? await getIdToken() : null;
  if (idToken) {
    try {
      const response = await fetch(`${API_BASE_URL}/translateText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ data: { text, targetLang } })
      });
      const data = await response.json();
      if (data.result && data.result.translation) {
        return data.result.translation;
      }
    } catch (e) {
      console.error('Premium translation failed, falling back to free tier', e);
    }
  }

  // Free Tier Translation (MyMemory)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${targetLang}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
      return data.responseData.translatedText;
    }
  } catch (e) {
    // Silent
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE') {
    translateInBackground(message.text, message.targetLang, message.uid)
      .then((translation) => sendResponse({ translation }))
      .catch(() => sendResponse({ translation: null }));
    return true; // keep channel open for async sendResponse
  }
});

// Alt+P: open or close Picture-in-Picture without going through the popup
function togglePipFromShortcut(tab) {
  if (!tab?.id) return;
  // This first injection has to be sent before anything is awaited. Only then
  // does the shortcut's user gesture reach the page, where it stays valid for
  // a few seconds - long enough for the steps below. requestWindow needs it.
  const activated = chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => {} });
  (async () => {
    await activated;
    const probe = await probeTab(tab.id);
    if (!probe || !(probe.hasVideo || probe.pipOpen)) throw new Error('Nothing to open on this page');
    await togglePipInTab(tab.id, await readStoredSettings());
    await injectRelay(tab.id);
  })().catch(() => {
    // No video, or a page SubPIP cannot run on: the popup says which
    chrome.action.openPopup().catch(() => {});
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-pip') togglePipFromShortcut(tab);
});

// Auto-PiP needs SubPIP running in every page before the user switches tabs,
// so Chrome's "enterpictureinpicture" handler exists (see content/index.js).
// These scripts are only registered while auto-PiP is on and the optional
// all-sites permission is granted.
const AUTO_PIP_SCRIPTS = [
  { id: 'subpip-relay', matches: ['<all_urls>'], js: ['translate-relay.js'], runAt: 'document_start', allFrames: false },
  { id: 'subpip-main', matches: ['<all_urls>'], js: ['script.js'], world: 'MAIN', runAt: 'document_idle', allFrames: false }
];

async function syncAutoPipScripts() {
  const { subpipSettings } = await chrome.storage.sync.get(['subpipSettings']);
  const wanted = subpipSettings?.autoPip === true && await chrome.permissions.contains(ALL_SITES);
  const ids = AUTO_PIP_SCRIPTS.map((script) => script.id);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids });

  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
  }
  if (wanted) {
    await chrome.scripting.registerContentScripts(AUTO_PIP_SCRIPTS);
  }
}

chrome.runtime.onInstalled.addListener(syncAutoPipScripts);
chrome.runtime.onStartup.addListener(syncAutoPipScripts);
chrome.permissions.onAdded.addListener(syncAutoPipScripts);
chrome.permissions.onRemoved.addListener(syncAutoPipScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.subpipSettings) {
    const before = changes.subpipSettings.oldValue?.autoPip;
    const after = changes.subpipSettings.newValue?.autoPip;
    if (before !== after) syncAutoPipScripts();
  }
});
