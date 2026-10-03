// What pages are told about Auto PiP. The switch is saved in sync storage,
// shared by all of the user's browsers; the all-sites permission it needs is
// granted per browser. The background records, on each browser, whether both
// hold - and only that is passed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSettings, autoPipActive, AUTO_PIP_ACTIVE } from '../../src/shared/settings.js';

function useChrome({ sync = {}, local = {} } = {}) {
  const area = (data) => ({ get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])) });
  globalThis.chrome = { storage: { sync: area(sync), local: area(local) } };
}

test('a page is told Auto PiP is on when it is switched on and active on this browser', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: true } }, local: { [AUTO_PIP_ACTIVE]: true } });
  assert.equal((await readStoredSettings()).autoPip, true);
  assert.equal(await autoPipActive(), true);
});

test('the saved switch alone does not turn it on (another browser, or a refused permission)', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: true } } });
  assert.equal((await readStoredSettings()).autoPip, false);
  useChrome({ sync: { subpipSettings: { autoPip: true } }, local: { [AUTO_PIP_ACTIVE]: false } });
  assert.equal((await readStoredSettings()).autoPip, false);
  assert.equal(await autoPipActive(), false);
});

test('switching it off wins at once, even before the background has caught up', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: false } }, local: { [AUTO_PIP_ACTIVE]: true } });
  assert.equal((await readStoredSettings()).autoPip, false);
});
