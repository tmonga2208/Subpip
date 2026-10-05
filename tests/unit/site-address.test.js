// SubPIP's own address. The site and API moved from subpip.vercel.app to
// subpip.online; the old address keeps answering (same Vercel project), which
// installed copies of older versions rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { SITE_URL, API_BASE_URL, UNINSTALL_URL, PREMIUM_URL, REPORT_URL, WELCOME_URL, STORE_URL, STORE_REVIEWS_URL } from '../../src/shared/firebase.js';

test('the extension talks to subpip.online', () => {
  assert.equal(SITE_URL, 'https://subpip.online');
  assert.equal(API_BASE_URL, 'https://subpip.online/api');
  assert.equal(UNINSTALL_URL, 'https://subpip.online/uninstalled.html');
  assert.equal(PREMIUM_URL, 'https://subpip.online/premium.html');
  assert.equal(REPORT_URL, 'https://subpip.online/report.html');
  assert.equal(WELCOME_URL, 'https://subpip.online/welcome.html');
});

test('the store links are SubPIP\'s own listing', () => {
  assert.equal(STORE_URL, 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg');
  assert.equal(STORE_REVIEWS_URL, `${STORE_URL}/reviews`);
});

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
}

test('nothing the extension or the site ships still names the old address', () => {
  const stale = [...filesUnder('src'), ...filesUnder('web')]
    .filter((file) => /\.(js|html|css|json)$/.test(file) && !file.endsWith('package-lock.json'))
    .filter((file) => readFileSync(file, 'utf8').includes('subpip.vercel.app'));
  assert.deepEqual(stale, []);
});

test('every page of the site names subpip.online as its address', () => {
  for (const name of readdirSync('web').filter((file) => file.endsWith('.html'))) {
    const html = readFileSync(path.join('web', name), 'utf8');
    const wanted = `<link rel="canonical" href="https://subpip.online/${name === 'index.html' ? '' : name}">`;
    assert.ok(html.includes(wanted), `${name} should have ${wanted}`);
  }
});
