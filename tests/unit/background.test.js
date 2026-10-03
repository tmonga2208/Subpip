// What the background service worker sets up, with a stand-in for the
// chrome.* APIs it touches
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
let listeners = {};
const event = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
const fire = (name, ...args) => Promise.all(listeners[name].map((listener) => listener(...args)));
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// The browser the background runs in: what is saved, granted, registered and open
const browser = { settings: {}, local: {}, session: {}, allSites: false, registered: [], tabs: [], injected: [], uninstallUrls: [] };
const area = (name) => ({
  get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in browser[name]).map((k) => [k, browser[name][k]])),
  set: async (items) => { Object.assign(browser[name], items); }
});

// Starts the service worker. A new run of the extension (browser start,
// install, update, reload, re-enable) begins with empty session storage;
// waking up again within the same run keeps it.
let starts = 0;
async function startWorker({ newRun = true } = {}) {
  listeners = {};
  if (newRun) browser.session = {};
  await import(`../../src/background.js?start=${++starts}`);
  await settle();
}

globalThis.chrome = {
  runtime: {
    onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'),
    getManifest: () => manifest,
    setUninstallURL: async (url) => { browser.uninstallUrls.push(url); }
  },
  commands: { onCommand: event('command') },
  permissions: { onAdded: event('permissionAdded'), onRemoved: event('permissionRemoved'), contains: async () => browser.allSites },
  storage: {
    onChanged: event('storageChanged'),
    sync: { get: async () => ({ subpipSettings: browser.settings }) },
    local: area('local'),
    session: area('session')
  },
  scripting: {
    getRegisteredContentScripts: async () => browser.registered.map((id) => ({ id })),
    unregisterContentScripts: async ({ ids }) => { browser.registered = browser.registered.filter((id) => !ids.includes(id)); },
    registerContentScripts: async (scripts) => { browser.registered.push(...scripts.map((script) => script.id)); },
    executeScript: async ({ target, files }) => { browser.injected.push(`${target.tabId}:${files.join(',')}`); return [{}]; }
  },
  tabs: { query: async () => browser.tabs }
};
await startWorker();

test('after an install or update, uninstalling opens the feedback page with the version', async () => {
  assert.deepEqual(browser.uninstallUrls, [], 'nothing is registered just by starting up');
  await fire('installed', { reason: 'install' });
  await settle();
  assert.deepEqual(browser.uninstallUrls, [`https://subpip.vercel.app/uninstalled.html?v=${manifest.version}`]);
});

test('Auto PiP is active only with the saved switch AND all-sites access on this browser', async () => {
  browser.settings = { autoPip: true };
  browser.allSites = false; // e.g. the switch arrived through Chrome sync, or the prompt was refused
  await startWorker();
  assert.equal(browser.local.subpipAutoPipActive, false);
  assert.deepEqual(browser.registered, []);

  browser.allSites = true;
  await fire('permissionAdded', { origins: ['<all_urls>'] });
  await settle();
  assert.equal(browser.local.subpipAutoPipActive, true);
  assert.deepEqual(browser.registered, ['subpip-relay', 'subpip-main']);

  browser.allSites = false; // revoked, in the popup or in Chrome's extension settings
  await fire('permissionRemoved', { origins: ['<all_urls>'] });
  await settle();
  assert.equal(browser.local.subpipAutoPipActive, false);
  assert.deepEqual(browser.registered, []);
});

test('when Auto PiP becomes active, the tabs that are already open get SubPIP at once', async () => {
  Object.assign(browser, { settings: { autoPip: false }, allSites: true, injected: [], tabs: [{ id: 7 }, { id: 9 }] });
  await fire('storageChanged', { subpipSettings: { oldValue: { autoPip: true }, newValue: { autoPip: false } } }, 'sync');
  await settle();
  assert.deepEqual(browser.injected, [], 'nothing to add while it is off');

  browser.settings = { autoPip: true };
  await fire('storageChanged', { subpipSettings: { oldValue: { autoPip: false }, newValue: { autoPip: true } } }, 'sync');
  await settle();
  assert.deepEqual(browser.injected.sort(), ['7:script.js', '7:translate-relay.js', '9:script.js', '9:translate-relay.js']);

  // It is already active: an unrelated permission event must not inject everything again
  browser.injected = [];
  await fire('permissionAdded', { permissions: ['storage'] });
  await settle();
  assert.deepEqual(browser.injected, []);
});

test('a new run of the extension reconnects open tabs: they lost the previous copy of it', async () => {
  // update, reload, re-enable or browser start, with Auto PiP in force
  Object.assign(browser, { settings: { autoPip: true }, allSites: true, injected: [], tabs: [{ id: 7 }] });
  await startWorker();
  assert.deepEqual(browser.injected.sort(), ['7:script.js', '7:translate-relay.js']);
});

test('the service worker waking up again within the same run injects nothing', async () => {
  Object.assign(browser, { settings: { autoPip: true }, allSites: true, injected: [], tabs: [{ id: 7 }] });
  await startWorker({ newRun: false });
  assert.deepEqual(browser.injected, []);
  assert.deepEqual(browser.registered, ['subpip-relay', 'subpip-main'], 'the registration is left as it is');
});

test('events that arrive together do not register the scripts twice', async () => {
  Object.assign(browser, { settings: { autoPip: true }, allSites: true, registered: [] });
  await Promise.all([fire('permissionAdded', {}), fire('permissionAdded', {}), fire('storageChanged', { subpipSettings: { oldValue: {}, newValue: { autoPip: true } } }, 'sync')]);
  await settle();
  assert.deepEqual(browser.registered, ['subpip-relay', 'subpip-main']);
});
