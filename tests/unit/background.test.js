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
// granted: access to single sites; matches: where the scripts are registered; queried: which tabs were looked for
const browser = { settings: {}, local: {}, session: {}, allSites: false, granted: [], registered: [], matches: null, tabs: [], queried: null, injected: [], uninstallUrls: [] };
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
  permissions: {
    onAdded: event('permissionAdded'), onRemoved: event('permissionRemoved'),
    contains: async ({ origins }) => browser.allSites || origins.every((origin) => browser.granted.includes(origin))
  },
  storage: {
    onChanged: event('storageChanged'),
    sync: { get: async () => ({ subpipSettings: browser.settings }) },
    local: area('local'),
    session: area('session')
  },
  scripting: {
    getRegisteredContentScripts: async () => browser.registered.map((id) => ({ id })),
    unregisterContentScripts: async ({ ids }) => { browser.registered = browser.registered.filter((id) => !ids.includes(id)); },
    registerContentScripts: async (scripts) => {
      browser.registered.push(...scripts.map((script) => script.id));
      browser.matches = scripts[0].matches;
    },
    executeScript: async ({ target, files }) => { browser.injected.push(`${target.tabId}:${files.join(',')}`); return [{}]; }
  },
  tabs: { query: async ({ url }) => { browser.queried = url; return browser.tabs; } }
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

// ---- Auto PiP for single sites ----

const SITE = '*://*.example.com/*';
const clean = (extra) => Object.assign(browser, { settings: {}, local: {}, allSites: false, granted: [], registered: [], matches: null, tabs: [], queried: null, injected: [] }, extra);

test('a site chosen for Auto PiP, with access to it, is set up for that site alone', async () => {
  clean({ settings: { autoPip: false, autoPipSites: ['example.com'] }, granted: [SITE], tabs: [{ id: 3 }] });
  await startWorker();
  assert.deepEqual(browser.registered, ['subpip-relay', 'subpip-main']);
  assert.deepEqual(browser.matches, [SITE]);
  assert.equal(browser.local.subpipAutoPipActive, false);
  assert.deepEqual(browser.local.subpipAutoPipSitesActive, ['example.com']);
  // Its open tabs get SubPIP; no other tab is touched
  assert.deepEqual(browser.queried, [SITE]);
  assert.deepEqual(browser.injected.sort(), ['3:script.js', '3:translate-relay.js']);
});

test('a chosen site this browser has no access to is left out', async () => {
  clean({ settings: { autoPipSites: ['example.com', 'other.example'] }, granted: [SITE] });
  await startWorker();
  assert.deepEqual(browser.matches, [SITE]);
  assert.deepEqual(browser.local.subpipAutoPipSitesActive, ['example.com']);
  clean({ settings: { autoPipSites: ['example.com'] } });
  await startWorker();
  assert.deepEqual(browser.registered, []);
  assert.deepEqual(browser.local.subpipAutoPipSitesActive, []);
});

test('a site added later reaches the open tabs of that site only', async () => {
  clean({ settings: { autoPipSites: ['example.com'] }, granted: [SITE, '*://*.second.example/*'], tabs: [{ id: 5 }] });
  await startWorker();
  browser.injected = [];
  browser.settings = { autoPipSites: ['example.com', 'second.example'] };
  await fire('storageChanged', { subpipSettings: { oldValue: { autoPipSites: ['example.com'] }, newValue: browser.settings } }, 'sync');
  await settle();
  assert.deepEqual(browser.matches, [SITE, '*://*.second.example/*']);
  assert.deepEqual(browser.queried, ['*://*.second.example/*']);
  assert.deepEqual(browser.injected.sort(), ['5:script.js', '5:translate-relay.js']);
});

test('with every site switched on, single sites need nothing of their own', async () => {
  clean({ settings: { autoPip: true, autoPipSites: ['example.com'] }, allSites: true });
  await startWorker();
  assert.deepEqual(browser.matches, ['<all_urls>']);
  assert.equal(browser.local.subpipAutoPipActive, true);
});

test('a saved "site" that is not a host name is ignored', async () => {
  clean({ settings: { autoPipSites: ['not a site/*', 'example.com'] }, allSites: true });
  await startWorker();
  assert.deepEqual(browser.matches, [SITE]);
});
