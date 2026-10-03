// The captions a viewer pointed at are remembered per site, and travel to
// that site's pages with the rest of the settings
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSettings, captionSelectorFor, saveCaptionSelector, siteKey } from '../../src/shared/settings.js';

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) { return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { Object.assign(data, structuredClone(items)); }
  };
}
function useChrome(sync = {}) {
  const storage = { sync: storageArea(sync), local: storageArea() };
  globalThis.chrome = { storage };
  return storage;
}

test('a site is the same with and without www', () => {
  assert.equal(siteKey('www.example.com'), 'example.com');
  assert.equal(siteKey('video.example.com'), 'video.example.com');
});

test('a picked caption element is saved for its site and read back there only', async () => {
  const storage = useChrome();
  await saveCaptionSelector('www.example.com', 'div.captions');
  assert.deepEqual(storage.sync.data.subpipCaptionSelectors, { 'example.com': 'div.captions' });
  assert.equal(await captionSelectorFor('example.com'), 'div.captions');
  assert.equal(await captionSelectorFor('other.example'), '');
});

test('forgetting a site removes only that site', async () => {
  const storage = useChrome({ subpipCaptionSelectors: { 'a.example': '.one', 'b.example': '.two' } });
  await saveCaptionSelector('a.example', '');
  assert.deepEqual(storage.sync.data.subpipCaptionSelectors, { 'b.example': '.two' });
});

test('a page is told the caption element picked for its own site', async () => {
  useChrome({ subpipSettings: { fontSize: 22 }, subpipCaptionSelectors: { 'example.com': 'div.captions' } });
  assert.equal((await readStoredSettings('www.example.com')).captionSelector, 'div.captions');
  assert.equal((await readStoredSettings('elsewhere.example')).captionSelector, '');
  // Asked without a site (nothing to look up), the settings carry none
  assert.equal('captionSelector' in await readStoredSettings(), false);
});

test('an absurdly long selector is not saved', async () => {
  const storage = useChrome();
  await saveCaptionSelector('example.com', 'div'.padEnd(600, ' > div'));
  assert.equal('subpipCaptionSelectors' in storage.sync.data, false);
});
