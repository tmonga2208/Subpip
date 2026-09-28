// Popup final-review fixes that can be pinned without a browser
import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeChrome({ sync = {}, activeTabs, normalTabs = [] } = {}) {
  return {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
    storage: { sync: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in sync).map((k) => [k, sync[k]])) } },
    tabs: { query: async (q) => (q.currentWindow ? activeTabs : normalTabs) }
  };
}

test('a stale isPremium inside settings no longer unlocks Premium', async () => {
  globalThis.chrome = fakeChrome({ sync: { subpipSettings: { isPremium: true, fontSize: 20 } } });
  const { readStoredSettings } = await import('../../src/shared/settings.js');
  assert.equal((await readStoredSettings()).isPremium, false);
  globalThis.chrome = fakeChrome({ sync: { subpipSettings: {}, subpipAuth: { uid: 'u', isPremium: true } } });
  assert.equal((await readStoredSettings()).isPremium, true);
});

test('loading settings that still carry isPremium/uid writes a clean copy back', async () => {
  const { createSettingsStore } = await import('../../src/popup/settings-store.js');
  const data = { subpipSettings: { fontSize: 22, isPremium: true, uid: 'x' } };
  const storage = { async get(keys) { return Object.fromEntries(keys.map((k) => [k, data[k]])); }, async set(items) { Object.assign(data, items); } };
  await createSettingsStore(storage).load();
  assert.equal('isPremium' in data.subpipSettings, false);
  assert.equal('uid' in data.subpipSettings, false);
  assert.equal(data.subpipSettings.fontSize, 22);
});

test('the toolbar popup targets its own window\'s tab even when its URL is hidden', async () => {
  globalThis.chrome = fakeChrome({
    activeTabs: [{ id: 1 }],
    normalTabs: [{ id: 9, url: 'https://www.youtube.com/watch?v=x', lastAccessed: 99 }]
  });
  const { getTargetTab } = await import('../../src/popup/status.js');
  assert.equal((await getTargetTab()).id, 1);
});

test('the fallback is only for a popup opened in its own window', async () => {
  globalThis.chrome = fakeChrome({
    activeTabs: [{ id: 5, url: 'chrome-extension://abc/popup.html' }],
    normalTabs: [{ id: 7 }, { id: 9, url: 'https://example.com/', lastAccessed: 1 }]
  });
  const { getTargetTab } = await import('../../src/popup/status.js');
  assert.equal((await getTargetTab()).id, 9);
});
