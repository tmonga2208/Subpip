import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, confirmStub, both } from '../helpers/web.js';
import { sleep } from '../helpers/browser.js';

const ctx = useWebsite();

const state = (page) => page.evaluate(() => ({
  paying: !document.getElementById('paymentSection').classList.contains('hide'),
  success: document.getElementById('successSection').classList.contains('show'),
  key: document.getElementById('licenseKey').textContent,
  email: document.getElementById('userEmailDisplay').textContent,
  error: document.getElementById('errorMsg').classList.contains('show') ? document.getElementById('errorMsg').textContent : null,
  buttonDisabled: document.getElementById('payBtn').disabled
}));

async function pay(page, email = 'buyer@example.com') {
  await page.type('#emailInput', email);
  await page.click('#payBtn');
}

test('checkout card shows price, features and the pay button', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  const card = await page.evaluate(() => ({
    title: document.querySelector('.checkout h1').textContent.trim(),
    price: document.querySelector('.checkout .price').textContent.replace(/\s+/g, ' ').trim(),
    features: document.querySelectorAll('.checkout .check-list li').length,
    pay: document.getElementById('payBtn').textContent.trim()
  }));
  assert.deepEqual(card, { title: 'SubPIP Premium', price: '₹1000 · lifetime', features: 4, pay: 'Pay ₹1000' });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a successful payment shows the license key', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  const s = await state(page);
  assert.deepEqual({ paying: s.paying, key: s.key, email: s.email }, { paying: false, key: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' });
  // The page saved the license for returning visits; don't leak it into later tests
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('an invalid email is caught before opening Razorpay', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  await pay(page, 'not-an-email');
  assert.equal((await state(page)).error, 'Please enter a valid email address');
  assert.equal(await page.evaluate(() => !!window.__rzpOpened), false);
  await page.close();
});

test('a declined card shows the reason', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  await page.evaluate(() => { window.__rzpMode = 'failed'; });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  assert.equal((await state(page)).error, 'Payment failed: Card declined');
  await page.close();
});

test('a blocked payment gateway gives a clear message and a usable button', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub({ blocked: true }) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  const s = await state(page);
  assert.match(s.error, /Failed to load payment gateway/);
  assert.equal(s.buttonDisabled, false);
  await page.close();
});

test('if confirmation fails, the payment ID is shown for support', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub({ ok: false })) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  assert.match((await state(page)).error, /pay_TEST123/);
  await page.close();
});

test('a returning buyer sees their saved license', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  await page.evaluate(() => localStorage.setItem('subpip_license', JSON.stringify({ licenseKey: 'SUBPIP-SAVED123-XYZ1', email: 'me@example.com' })));
  await page.reload({ waitUntil: 'load' });
  await sleep(200);
  const s = await state(page);
  assert.deepEqual({ success: s.success, key: s.key }, { success: true, key: 'SUBPIP-SAVED123-XYZ1' });
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('the copy button is readable (ghost buttons have no light default background)', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  const look = await page.$eval('.copy-btn', (b) => ({ background: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }));
  assert.deepEqual(look, { background: 'rgba(0, 0, 0, 0)', color: 'rgb(242, 242, 242)' });
  await page.evaluate(() => localStorage.clear());
  await page.close();
});
