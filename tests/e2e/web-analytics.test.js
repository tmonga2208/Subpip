// Visits to the site are counted with Vercel Web Analytics. The test server
// answers for Vercel's script with a stand-in (helpers/web.js) that keeps what
// the real one would report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub } from '../helpers/web.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'delivery.html', 'contact.html', 'uninstalled.html'];

const visits = (page) => page.evaluate(() => window.__visits || []);

test('every page reports one visit, under its own address', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    assert.deepEqual(await visits(page), [ctx.url(pagePath)], pagePath);
    await page.close();
  }
});

test('what follows "?" or "#" in an address is never reported', async () => {
  const links = [
    // A checkout link from the extension carries a code for the account, and can carry an email
    ['premium.html?c=CODE123&email=buyer%40example.com#pay', 'premium.html'],
    ['uninstalled.html?v=4.4', 'uninstalled.html'],
    ['index.html?from=somewhere#pricing', 'index.html']
  ];
  for (const [opened, reported] of links) {
    const page = await ctx.open(opened, { intercept: razorpayStub() });
    assert.deepEqual(await visits(page), [ctx.url(reported)], opened);
    await page.close();
  }
});

test('the checkout page still gets what its link carried', async () => {
  const page = await ctx.open('premium.html?c=CODE123&email=buyer%40example.com', { intercept: razorpayStub() });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), 'buyer@example.com');
  assert.equal(await page.evaluate(() => location.search), '?c=CODE123&email=buyer%40example.com');
  await page.close();
});
