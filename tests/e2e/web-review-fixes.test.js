// Website final-review fixes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, confirmStub, both } from '../helpers/web.js';
import { sleep } from '../helpers/browser.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html'];

test('nav links on every page lead somewhere', async () => {
  const broken = [];
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const dead = await page.$$eval('.nav-links a', (links) => links
      .map((a) => a.getAttribute('href'))
      .filter((href) => href.startsWith('#') && !document.querySelector(href)));
    broken.push(...dead.map((href) => `${pagePath} → ${href}`));
    await page.close();
  }
  assert.deepEqual(broken, []);
});

test('a long buyer email never pushes the success card off a phone screen', async () => {
  const page = await ctx.open('premium.html', { width: 320, height: 800, intercept: both(razorpayStub(), confirmStub()) });
  try {
    await page.type('#emailInput', 'priyanka.venkataraman@infosystechnologies.com');
    await page.click('#payBtn');
    await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0);
  } finally {
    await page.evaluate(() => localStorage.clear());
    await page.close();
  }
});

test('the payment-ID error stays on screen until something replaces it', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub({ ok: false })) });
  await page.type('#emailInput', 'buyer@example.com');
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('errorMsg').textContent.includes('pay_TEST123'));
  await sleep(6000);
  const visible = await page.$eval('#errorMsg', (el) => getComputedStyle(el).display !== 'none' && el.textContent.includes('pay_TEST123'));
  assert.equal(visible, true);
  await page.close();
});

test('subtitle support is described as a link, not a file upload', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const text = await page.evaluate(() => document.body.innerText);
    assert.equal(/Load subtitle files/i.test(text), false, `${pagePath} still says "Load subtitle files"`);
    await page.close();
  }
});
