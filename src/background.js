// SubPIP background service worker: translation requests, the Alt+P
// shortcut, auto-PiP content script registration and the uninstall page.

import { ALL_SITES, AUTO_PIP_ACTIVE, AUTO_PIP_SITES_ACTIVE, isSiteName, sitePattern, readStoredSettings, readAuthCache } from './shared/settings.js';
import { TOKEN_URL, API_BASE_URL, TOKEN_MAX_AGE_MS, UNINSTALL_URL, WELCOME_URL } from './shared/firebase.js';
import { sendCount, USAGE_NOTICE } from './shared/usage.js';
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

  // Otherwise our server, which translates with DeepL. It checks Premium
  // from the ID token, not from anything the client claims
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
      console.error('The server could not translate, falling back to MyMemory', e);
    }
  }

  // Last resort, when the server gave nothing: MyMemory, straight from here.
  // The window asks for translation only for Premium users.
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
  // "See Premium" in a video's window: the popup's own page about it, in a tab
  if (message.type === 'OPEN_PREMIUM') chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#upgrade') });
  // An anonymous usage count, from a video's window (through the relay) or the popup
  if (message.type === 'COUNT') readAuthCache().then((account) => sendCount(message.fact || {}, sender.tab, account?.isPremium ? 'premium' : 'free'));
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
    await togglePipInTab(tab.id, await readStoredSettings(probe.host));
    await injectRelay(tab.id);
  })().catch(() => {
    // No video, or a page SubPIP cannot run on: the popup says which
    chrome.action.openPopup().catch(() => {});
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-pip') togglePipFromShortcut(tab);
});

// Auto-PiP needs SubPIP running in a page before the user switches tabs, so
// Chrome's "enterpictureinpicture" handler exists (see content/index.js).
// These scripts are only registered while auto-PiP is on and the access it
// needs is granted: to all sites, or to the single sites the user chose.
const autoPipScripts = (matches) => [
  { id: 'subpip-relay', matches, js: ['translate-relay.js'], runAt: 'document_start', allFrames: false },
  { id: 'subpip-main', matches, js: ['script.js'], world: 'MAIN', runAt: 'document_idle', allFrames: false }
];
const AUTO_PIP_SCRIPT_IDS = autoPipScripts([]).map((script) => script.id);
const EVERY_SITE = ['http://*/*', 'https://*/*'];

// Auto PiP is in force on this browser only where the user has switched it on
// and this browser holds the permission for it. That is recorded for the
// pages (see AUTO_PIP_ACTIVE) and decides where the scripts are registered.
async function applyAutoPip(reconnect) {
  const [{ subpipSettings }, { [AUTO_PIP_ACTIVE]: wasEverywhere, [AUTO_PIP_SITES_ACTIVE]: wasOn = [] }] = await Promise.all([
    chrome.storage.sync.get(['subpipSettings']),
    chrome.storage.local.get([AUTO_PIP_ACTIVE, AUTO_PIP_SITES_ACTIVE])
  ]);
  const everywhere = subpipSettings?.autoPip === true && await chrome.permissions.contains(ALL_SITES);
  const sites = [];
  for (const site of (subpipSettings?.autoPipSites || []).filter(isSiteName)) {
    if (await chrome.permissions.contains({ origins: [sitePattern(site)] })) sites.push(site);
  }
  const matches = everywhere ? ['<all_urls>'] : sites.map(sitePattern);
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: AUTO_PIP_SCRIPT_IDS });

  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
  }
  if (matches.length) {
    await chrome.scripting.registerContentScripts(autoPipScripts(matches));
  }
  await chrome.storage.local.set({ [AUTO_PIP_ACTIVE]: everywhere, [AUTO_PIP_SITES_ACTIVE]: sites });

  // Registered scripts only reach pages loaded from now on. Tabs that are
  // already open get SubPIP directly: where Auto PiP has just come into
  // force, and at the start of a new run of the extension, which cut open
  // tabs off from the previous one (see the relay).
  if (everywhere) {
    if (reconnect || !wasEverywhere) await addToOpenTabs(EVERY_SITE);
  } else {
    const reach = reconnect ? sites : sites.filter((site) => !wasOn.includes(site));
    if (reach.length) await addToOpenTabs(reach.map(sitePattern));
  }
}

async function addToOpenTabs(url) {
  const tabs = await chrome.tabs.query({ url, discarded: false });
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
// First steps, once, for someone who has just added SubPIP from the store.
// Not after an update, and not for a copy loaded by hand or put on the
// computer by an administrator.
async function welcomeAfterInstall({ reason } = {}) {
  if (reason !== 'install') return;
  try {
    const { installType } = await chrome.management.getSelf();
    if (installType === 'normal') await chrome.tabs.create({ url: WELCOME_URL });
  } catch (e) {
    // No first-steps page is better than an error on install
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.runtime.setUninstallURL(`${UNINSTALL_URL}?v=${chrome.runtime.getManifest().version}`);
  welcomeAfterInstall(details);
  // Whoever had SubPIP before it counted anything is told first, in the popup
  if (details.reason === 'update' && parseFloat(details.previousVersion) < 4.8) chrome.storage.local.set({ [USAGE_NOTICE]: 'pending' });
});

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
    const chosen = (settings) => JSON.stringify([settings?.autoPip === true, settings?.autoPipSites || []]);
    if (chosen(changes.subpipSettings.oldValue) !== chosen(changes.subpipSettings.newValue)) syncAutoPip();
  }
});
