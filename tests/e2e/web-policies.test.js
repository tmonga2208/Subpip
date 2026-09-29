import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub } from '../helpers/web.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html'];

test('every page links all four policy pages in its footer', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const links = await page.$$eval('.site-footer a', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of ['privacy.html', 'terms.html', 'refund.html', 'contact.html']) assert.ok(links.includes(href), `${pagePath} footer lacks ${href}`);
    await page.close();
  }
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
