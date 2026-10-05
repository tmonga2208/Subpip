import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub } from '../helpers/web.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'delivery.html', 'contact.html', 'uninstalled.html', 'report.html', 'welcome.html'];

test('every page links all five policy pages in its footer', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const links = await page.$$eval('.site-footer a', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of ['privacy.html', 'terms.html', 'refund.html', 'delivery.html', 'contact.html']) assert.ok(links.includes(href), `${pagePath} footer lacks ${href}`);
    await page.close();
  }
});

// Razorpay asks a shop for this page, also when what it sells is not shipped
test('delivery policy says what is delivered, how soon, and what to do if it is not', async () => {
  const page = await ctx.open('delivery.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  assert.match(text, /Shipping and Delivery Policy/);
  assert.match(text, /nothing is shipped/i);
  assert.match(text, /no shipping charges/i);
  assert.match(text, /by email/i);
  assert.match(text, /within a few minutes/i);
  // The way back to a key that never arrived is the one the checkout page offers
  assert.match(text, /Lost your license key\?/);
  assert.equal(await page.$eval('article.prose a[href="premium.html"]', (a) => a.textContent), 'Premium page');
  assert.equal(await page.$eval('article.prose a[href^="mailto:"]', (a) => a.getAttribute('href')), 'mailto:tarunmonga2208@gmail.com');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('refund policy states the 7-day no-questions refund and revocation', async () => {
  const page = await ctx.open('refund.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  assert.match(text, /7 days/);
  assert.match(text, /no questions asked/i);
  assert.match(text, /license.*(deactivated|revoked)/i);
  await page.close();
});

test('terms and contact pages have the essentials', async () => {
  let page = await ctx.open('terms.html');
  let text = await page.$eval('article.prose', (el) => el.innerText);
  for (const part of ['Premium', 'lifetime', 'Refund', 'Contact']) assert.match(text, new RegExp(part), part);
  await page.close();
  page = await ctx.open('contact.html');
  assert.equal(await page.$eval('article.prose a[href^="mailto:"]', (a) => a.getAttribute('href')), 'mailto:tarunmonga2208@gmail.com');
  await page.close();
});

test('checkout says paying means agreeing to the Terms and Refund Policy', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  const agree = await page.$eval('.agree', (el) => ({ text: el.textContent, links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')) }));
  assert.match(agree.text, /agree/i);
  assert.deepEqual(agree.links, ['terms.html', 'refund.html']);
  await page.close();
});
