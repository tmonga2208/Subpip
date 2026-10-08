// Regional prices and the one-year pass on the website: three price levels by
// time zone, and a choice between lifetime and one year at the checkout
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, confirmStub, both } from '../helpers/web.js';

const ctx = useWebsite();
const JAKARTA = 'Asia/Jakarta';
const NY = 'America/New_York';

const card = (page) => page.evaluate(() => ({
  price: document.querySelector('#pricing .featured .price').textContent.replace(/\s+/g, ' ').trim(),
  year: document.querySelector('#pricing .featured .price-year').textContent.replace(/\s+/g, ' ').trim()
}));
const plans = (page) => page.$$eval('input[name="plan"]', (inputs) => inputs.map((input) => ({ value: input.value, checked: input.checked, label: input.closest('label').textContent.replace(/\s+/g, ' ').trim() })));
const payLabel = (page) => page.$eval('#payBtn', (button) => button.textContent.trim());
async function pay(page) {
  await page.type('#emailInput', 'buyer@example.com');
  await page.click('#payBtn');
  await page.waitForFunction(() => window.__rzpOptions);
  return page.evaluate(() => window.__rzpOptions);
}

test('the pricing card shows lifetime and one year, at the level of where the visitor is', async () => {
  for (const [timezone, price, year] of [['Asia/Kolkata', '₹999 lifetime', 'or ₹399 for one year'], [JAKARTA, '$7 lifetime', 'or $3 for one year'], [NY, '$15 lifetime', 'or $6 for one year']]) {
    const page = await ctx.open('index.html', { timezone });
    assert.deepEqual(await card(page), { price, year }, timezone);
    await page.close();
  }
});

test('the lower level covers Indonesia, the Philippines, Vietnam, Thailand, Brazil and Turkey', async () => {
  for (const timezone of ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Bangkok', 'America/Sao_Paulo', 'America/Manaus', 'Europe/Istanbul']) {
    const page = await ctx.open('index.html', { timezone });
    assert.equal((await card(page)).price, '$7 lifetime', timezone);
    await page.close();
  }
  for (const timezone of ['Europe/London', 'Asia/Tokyo', 'Asia/Singapore', 'America/Mexico_City']) {
    const page = await ctx.open('index.html', { timezone });
    assert.equal((await card(page)).price, '$15 lifetime', timezone);
    await page.close();
  }
});

test('the checkout offers lifetime, chosen to begin with, and one year that says it ends', async () => {
  const page = await ctx.open('premium.html', { timezone: NY, intercept: razorpayStub() });
  assert.deepEqual(await plans(page), [
    { value: 'lifetime', checked: true, label: 'Lifetime $15 One payment, yours for good' },
    { value: 'year', checked: false, label: 'One year $6 Ends after a year. Not renewed, nothing charged again' }
  ]);
  assert.equal(await payLabel(page), 'Pay $15');
  await page.click('input[name="plan"][value="year"]');
  assert.equal(await payLabel(page), 'Pay $6');
  await page.close();
});

test('one year in a lower-priced country is ordered as that plan and level, and charged $3', async () => {
  const seen = [];
  const page = await ctx.open('premium.html', { timezone: JAKARTA, intercept: both(razorpayStub(), confirmStub({ seen })) });
  await page.click('input[name="plan"][value="year"]');
  const options = await pay(page);
  assert.deepEqual(seen[0], { endpoint: 'createOrder', data: { currency: 'USD', plan: 'year', tier: 'low', email: 'buyer@example.com' } });
  assert.equal(options.amount, 300);
  assert.equal(options.currency, 'USD');
  assert.equal(await page.evaluate(() => window.__rzpDescription), 'One year of Premium');
  await page.close();
});

test('lifetime in India is ordered as before, with nothing new for the server to misread', async () => {
  const seen = [];
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub({ seen })) });
  const options = await pay(page);
  assert.deepEqual(seen[0], { endpoint: 'createOrder', data: { currency: 'INR', plan: 'lifetime', tier: 'standard', email: 'buyer@example.com' } });
  assert.equal(options.amount, 99900);
  await page.close();
});
