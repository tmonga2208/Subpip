// What pages are told about Auto PiP. The switch is saved in sync storage,
// shared by all of the user's browsers; the all-sites permission it needs is
// granted per browser. The background records, on each browser, whether both
// hold - and only that is passed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStoredSettings, sitePattern, AUTO_PIP_ACTIVE, AUTO_PIP_SITES_ACTIVE } from '../../src/shared/settings.js';

function useChrome({ sync = {}, local = {} } = {}) {
  const area = (data) => ({ get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])) });
  globalThis.chrome = { storage: { sync: area(sync), local: area(local) } };
}

test('a page is told Auto PiP is on when it is switched on and active on this browser', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: true } }, local: { [AUTO_PIP_ACTIVE]: true } });
  assert.equal((await readStoredSettings()).autoPip, true);
  assert.equal((await readStoredSettings('any.example')).autoPip, true);
});

test('the saved switch alone does not turn it on (another browser, or a refused permission)', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: true } } });
  assert.equal((await readStoredSettings()).autoPip, false);
  useChrome({ sync: { subpipSettings: { autoPip: true } }, local: { [AUTO_PIP_ACTIVE]: false } });
  assert.equal((await readStoredSettings()).autoPip, false);
});

test('switching it off wins at once, even before the background has caught up', async () => {
  useChrome({ sync: { subpipSettings: { autoPip: false } }, local: { [AUTO_PIP_ACTIVE]: true } });
  assert.equal((await readStoredSettings()).autoPip, false);
});

// ---- Auto PiP for single sites: access to one site instead of all of them ----

const CHOSEN = { sync: { subpipSettings: { autoPip: false, autoPipSites: ['example.com'] } }, local: { [AUTO_PIP_SITES_ACTIVE]: ['example.com'] } };

test('on a site the viewer chose, pages are told Auto PiP is on; elsewhere they are not', async () => {
  useChrome(CHOSEN);
  assert.equal((await readStoredSettings('www.example.com')).autoPip, true);
  assert.equal((await readStoredSettings('video.example.com')).autoPip, true);
  assert.equal((await readStoredSettings('other.example')).autoPip, false);
  // A name that merely ends the same is another site
  assert.equal((await readStoredSettings('notexample.com')).autoPip, false);
  assert.equal((await readStoredSettings()).autoPip, false);
});

test('a site chosen in another browser, without access to it here, stays off', async () => {
  useChrome({ sync: CHOSEN.sync });
  assert.equal((await readStoredSettings('example.com')).autoPip, false);
});

test('taking a site off the list wins at once', async () => {
  useChrome({ sync: { subpipSettings: { autoPipSites: [] } }, local: CHOSEN.local });
  assert.equal((await readStoredSettings('example.com')).autoPip, false);
});

test('a page is never handed the list of sites the viewer chose', async () => {
  useChrome(CHOSEN);
  assert.equal('autoPipSites' in await readStoredSettings('example.com'), false);
});

test('access is asked for a site and what is under it; an address is asked for as it is', () => {
  assert.equal(sitePattern('example.com'), '*://*.example.com/*');
  assert.equal(sitePattern('127.0.0.1'), '*://127.0.0.1/*');
  assert.equal(sitePattern('localhost'), '*://localhost/*');
});
