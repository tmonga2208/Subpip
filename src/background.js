// SubPIP background service worker: translation requests, the Alt+P
// shortcut, auto-PiP content script registration and the uninstall page.

import { ALL_SITES, AUTO_PIP_ACTIVE, readStoredSettings } from './shared/settings.js';
import { TOKEN_URL, API_BASE_URL, TOKEN_MAX_AGE_MS, UNINSTALL_URL } from './shared/firebase.js';
import { togglePipInTab, injectRelay } from './shared/inject.js';
import { probeTab } from './popup/status.js';
import { createDeviceTranslation } from './shared/device-translation.js';

const deviceTranslation = createDeviceTranslation();

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
async function translateInBackground(text, targetLang, uid, tabId) {
  if (!text || !targetLang) return null;

  // On this device first, where Chrome can (138+): a few milliseconds per
  // line, no quota, and the caption never leaves the browser. A line that is
  // already in the target language comes back unchanged.
  const onDevice = await deviceTranslation.translate(text, targetLang, tabId);
  if (onDevice) return onDevice;

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
    translateInBackground(message.text, message.targetLang, message.uid, sender.tab?.id)
      .then((translation) => sendResponse({ translation }))
      .catch(() => sendResponse({ translation: null }));
    return true; // keep channel open for async sendResponse
  }
  // The popup, when translation is switched on or its language changes
  if (message.type === 'PREPARE_TRANSLATION') deviceTranslation.prepare(message.targetLang);
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

// Auto PiP is in force on this browser only when the user has switched it on
// and this browser holds the all-sites permission. That is recorded for the
// pages (see AUTO_PIP_ACTIVE) and decides whether the scripts are registered.
async function applyAutoPip(reconnect) {
  const [{ subpipSettings }, { [AUTO_PIP_ACTIVE]: wasActive }] = await Promise.all([
    chrome.storage.sync.get(['subpipSettings']),
    chrome.storage.local.get([AUTO_PIP_ACTIVE])
  ]);
  const active = subpipSettings?.autoPip === true && await chrome.permissions.contains(ALL_SITES);
  const ids = AUTO_PIP_SCRIPTS.map((script) => script.id);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids });

  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
  }
  if (active) {
    await chrome.scripting.registerContentScripts(AUTO_PIP_SCRIPTS);
  }
  await chrome.storage.local.set({ [AUTO_PIP_ACTIVE]: active });

  // Registered scripts only reach pages loaded from now on. Tabs that are
  // already open get SubPIP directly: when Auto PiP has just come into force,
  // and at the start of a new run of the extension, which cut open tabs off
  // from the previous one (see the relay).
  if (active && (reconnect || !wasActive)) await addToOpenTabs();
}

async function addToOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], discarded: false });
  await Promise.allSettled(tabs.map(async (tab) => {
    await injectRelay(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['script.js'] });
  }));
}

// One at a time: these events often arrive together (a permission change and
// the setting change behind it)
let lastSync = Promise.resolve();
function syncAutoPip({ reconnect = false } = {}) {
  lastSync = lastSync.then(() => applyAutoPip(reconnect)).catch((error) => console.warn('[SubPIP] Auto PiP sync failed:', error));
  return lastSync;
}

// Ask why, once, when SubPIP is uninstalled. The version goes along so an
// answer can be tied to a release; nothing identifies the user.
chrome.runtime.onInstalled.addListener(() => chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?v=${chrome.runtime.getManifest().version}`));

// Once per run of the extension - browser start, install, update, reload,
// re-enable - and not each time the service worker wakes up: session storage
// lasts exactly as long as a run.
chrome.storage.session.get(['autoPipSynced']).then(({ autoPipSynced }) => {
  if (autoPipSynced) return;
  chrome.storage.session.set({ autoPipSynced: true });
  syncAutoPip({ reconnect: true });
});

chrome.permissions.onAdded.addListener(() => syncAutoPip());
chrome.permissions.onRemoved.addListener(() => syncAutoPip());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.subpipSettings) {
    const before = changes.subpipSettings.oldValue?.autoPip;
    const after = changes.subpipSettings.newValue?.autoPip;
    if (before !== after) syncAutoPip();
  }
});
