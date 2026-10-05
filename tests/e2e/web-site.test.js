import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { useWebsite, razorpayStub } from '../helpers/web.js';
import { WEB_DIR } from '../helpers/browser.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'delivery.html', 'contact.html', 'uninstalled.html'];

test('no page scrolls sideways on a phone', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { width: 390, height: 844, intercept: razorpayStub() });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `${pagePath} overflows by ${overflow}px`);
    await page.close();
  }
});

test('on a phone the nav shows only the logo and the main button', async () => {
  const page = await ctx.open('index.html', { width: 390, height: 844 });
  const nav = await page.evaluate(() => ({
    links: getComputedStyle(document.querySelector('.nav-links')).display,
    button: getComputedStyle(document.querySelector('.nav .btn')).display !== 'none',
    brand: getComputedStyle(document.querySelector('.nav .brand')).display !== 'none'
  }));
  assert.deepEqual(nav, { links: 'none', button: true, brand: true });
  await page.close();
});

test('every local link and asset exists', async () => {
  const missing = [];
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const refs = await page.evaluate(() => [...document.querySelectorAll('[href], [src]')]
      .map((el) => el.getAttribute('href') || el.getAttribute('src')));
    for (const ref of refs) {
      if (/^(https?:|mailto:|data:|#)/.test(ref)) continue;
      const file = ref.split('#')[0];
      if (file && !existsSync(path.join(WEB_DIR, file))) missing.push(`${pagePath} → ${ref}`);
    }
    await page.close();
  }
  assert.deepEqual(missing, []);
});

// logo.png is not one of them any more: it is the logo emails show (mail apps
// do not display SVG). No page of the site uses it.
test('old images are gone', () => {
  for (const file of ['image.png', 'img.png']) {
    assert.equal(existsSync(path.join(WEB_DIR, file)), false, `${file} still in web/`);
  }
});

test('pages load without console errors', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    assert.deepEqual(page.errors, [], pagePath);
    await page.close();
  }
});
