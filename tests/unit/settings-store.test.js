import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, SAVE_DELAY_MS } from '../../src/popup/settings-store.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  const writes = [];
  return {
    data, writes,
    async get(keys) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { writes.push(structuredClone(items)); Object.assign(data, items); }
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('load applies defaults and labels old settings as custom', async () => {
  const storage = fakeStorage({ subpipSettings: { fontSize: 22, isPremium: true } });
  const store = createSettingsStore(storage);
  const settings = await store.load();
  assert.equal(settings.fontSize, 22);
  assert.equal(settings.captionPreset, 'custom');
});

test('saving drops isPremium and uid', async () => {
  const storage = fakeStorage({ subpipSettings: { fontSize: 22, isPremium: true, uid: 'x' } });
  const store = createSettingsStore(storage);
  await store.load();
  await store.update({ fontSize: 24 });
  const saved = storage.data.subpipSettings;
  assert.equal(saved.fontSize, 24);
  assert.equal('isPremium' in saved, false);
  assert.equal('uid' in saved, false);
});

test('debounced updates write once with the final value', async () => {
  const storage = fakeStorage();
  const store = createSettingsStore(storage);
  await store.load();
  for (let size = 20; size <= 29; size++) store.update({ fontSize: size }, { debounce: true });
  assert.equal(storage.writes.length, 0);
  await wait(SAVE_DELAY_MS + 50);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].subpipSettings.fontSize, 29);
});

test('flush writes a pending debounced change immediately', async () => {
  const storage = fakeStorage();
  const store = createSettingsStore(storage);
  await store.load();
  store.update({ fontSize: 31 }, { debounce: true });
  await store.flush();
  assert.equal(storage.data.subpipSettings.fontSize, 31);
  await wait(SAVE_DELAY_MS + 50);
  assert.equal(storage.writes.length, 1);
});

test('subscribers see every change, including before the save', async () => {
  const store = createSettingsStore(fakeStorage());
  await store.load();
  const seen = [];
  store.subscribe((s) => seen.push(s.fontSize));
  store.update({ fontSize: 25 }, { debounce: true });
  assert.deepEqual(seen, [25]);
});
