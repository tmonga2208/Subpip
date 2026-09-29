// Regional pricing on the website: ₹1000 in India, $15 elsewhere
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, confirmStub, both } from '../helpers/web.js';

const ctx = useWebsite();
const NY = 'America/New_York';

const landingPrices = (page) => page.evaluate(() => ({
  card: document.querySelector('#pricing .featured .price').textContent.replace(/\s+/g, ' ').trim(),
  faq: [...document.querySelectorAll('.accordion-content')].map((el) => el.textContent).find((t) => t.includes('one payment of')).match(/one payment of (\S+)/)[1]
}));
const checkout = (page) => page.evaluate(() => ({
  price: document.querySelector('.checkout .price').textContent.replace(/\s+/g, ' ').trim(),
  pay: document.getElementById('payBtn').textContent.trim()
}));
async function payAndCapture(page) {
  await page.type('#emailInput', 'buyer@example.com');
  await page.click('#payBtn');
  await page.waitForFunction(() => window.__rzpOptions);
  return page.evaluate(() => window.__rzpOptions);
}

test('landing page: rupees in India, dollars elsewhere', async () => {
  let page = await ctx.open('index.html');
  assert.deepEqual(await landingPrices(page), { card: '₹1000 lifetime', faq: '₹1000,' });
  await page.close();
  page = await ctx.open('index.html', { timezone: NY });
  assert.deepEqual(await landingPrices(page), { card: '$15 lifetime', faq: '$15,' });
  await page.close();
});

test('checkout in India charges ₹1000 in INR', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  assert.deepEqual(await checkout(page), { price: '₹1000 · lifetime', pay: 'Pay ₹1000' });
  assert.deepEqual(await payAndCapture(page), { amount: 100000, currency: 'INR' });
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('checkout outside India charges $15 in USD', async () => {
  const page = await ctx.open('premium.html', { timezone: NY, intercept: both(razorpayStub(), confirmStub()) });
  assert.deepEqual(await checkout(page), { price: '$15 · lifetime', pay: 'Pay $15' });
  assert.deepEqual(await payAndCapture(page), { amount: 1500, currency: 'USD' });
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('the price follows the time zone only (no currency switch)', async () => {
  for (const timezone of ['Asia/Kolkata', NY]) {
    const page = await ctx.open('premium.html', { timezone, intercept: razorpayStub() });
    assert.equal(await page.$('#currencySwitch'), null, timezone);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('instead')), false, timezone);
    await page.close();
  }
});
