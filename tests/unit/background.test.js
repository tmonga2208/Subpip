// What the background service worker sets up when it starts, with a stand-in
// for the chrome.* APIs it touches while loading
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
const listeners = {};
const event = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });
const uninstallUrls = [];

globalThis.chrome = {
  runtime: {
    onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup'),
    getManifest: () => manifest,
    setUninstallURL: async (url) => { uninstallUrls.push(url); }
  },
  commands: { onCommand: event('command') },
  permissions: { onAdded: event('permissionAdded'), onRemoved: event('permissionRemoved'), contains: async () => false },
  storage: { onChanged: event('storageChanged'), sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
  scripting: { getRegisteredContentScripts: async () => [], unregisterContentScripts: async () => {}, registerContentScripts: async () => {} }
};
await import('../../src/background.js');

test('after an install or update, uninstalling opens the feedback page with the version', async () => {
  assert.deepEqual(uninstallUrls, [], 'nothing is registered just by starting up');
  await Promise.all(listeners.installed.map((listener) => listener({ reason: 'install' })));
  assert.deepEqual(uninstallUrls, [`https://subpip.vercel.app/uninstalled.html?v=${manifest.version}`]);
});
