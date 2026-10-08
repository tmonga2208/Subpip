// What the extension tells the server about its use: a short fact, built so
// that nothing in it says who or where beyond a handful of well-known sites
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteCategory, browserMajor, countedFact, mayCount } from '../../src/shared/usage.js';
import { DEFAULT_SETTINGS } from '../../src/shared/settings.js';

test('a handful of sites are known by name; every other is "other"', () => {
  const sites = { 'www.youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'www.netflix.com': 'netflix', 'www.hotstar.com': 'hotstar', 'www.jiohotstar.com': 'hotstar', 'www.primevideo.com': 'primevideo', 'www.disneyplus.com': 'disneyplus', 'www.crunchyroll.com': 'crunchyroll' };
  for (const [host, name] of Object.entries(sites)) assert.equal(siteCategory(host), name, host);
  for (const host of ['goplay.su', 'notyoutube.com', 'youtube.com.evil.example', 'localhost', '', undefined]) assert.equal(siteCategory(host), 'other', String(host));
});

test('the browser is told by its main version number only', () => {
  assert.equal(browserMajor('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.8037.98 Safari/537.36'), 154);
  assert.equal(browserMajor('something else'), 0);
});

test('a fact carries the known answers and nothing that came with the request', () => {
  const tab = { url: 'https://www.netflix.com/watch/81234567?trackId=14170286', title: 'A film nobody should hear about' };
  const made = countedFact({ event: 'opened', captions: 'none', url: 'x', title: 'y', uid: 'u1' }, { tab, plan: 'premium', version: '4.8', browser: 154 });
  assert.deepEqual(made, { event: 'opened', site: 'netflix', captions: 'none', plan: 'premium', version: '4.8', browser: 154 });
  assert.deepEqual(countedFact({ event: 'premium_tap', feature: 'translate', where: 'window', anything: 'else' }, { tab, plan: 'free', version: '4.8', browser: 154 }), { event: 'premium_tap', feature: 'translate', where: 'window', version: '4.8', browser: 154 });
  assert.deepEqual(countedFact({ event: 'upgrade_click', where: 'popup' }, { plan: 'free', version: '4.8', browser: 154 }), { event: 'upgrade_click', where: 'popup', version: '4.8', browser: 154 });
  assert.equal(countedFact({ event: 'watched' }, { version: '4.8', browser: 154 }), null);
});

test('counting is on unless switched off, and waits until someone who updated has been told', () => {
  assert.equal(DEFAULT_SETTINGS.shareUsage, true);
  assert.equal(mayCount({ shareUsage: true }, undefined), true);
  assert.equal(mayCount({}, 'seen'), true);
  assert.equal(mayCount({ shareUsage: false }, 'seen'), false);
  assert.equal(mayCount({ shareUsage: true }, 'pending'), false);
});
