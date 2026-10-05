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

// After paying: the "already active" note, and whether the paste-the-key steps show
const activation = (page) => page.evaluate(() => ({
  note: document.getElementById('activatedNote').hidden ? null : document.getElementById('activatedNote').textContent.replace(/\s+/g, ' ').trim(),
  steps: !!document.querySelector('.instructions').offsetParent
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
  assert.deepEqual(card, { title: 'SubPIP Premium', price: '₹999 · lifetime', features: 7, pay: 'Pay ₹999' });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a successful payment shows the license key', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  const s = await state(page);
  assert.deepEqual({ paying: s.paying, key: s.key, email: s.email }, { paying: false, key: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' });
  // Bought on the website without an account: the key has to be activated by hand
  assert.deepEqual(await activation(page), { note: null, steps: true });
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

// ---- Bought from the popup while signed in: the checkout carries a code ----
const FROM_POPUP = 'premium.html#c=CODE0123456789abcdefgh&email=me%40example.com';
// Versions of the extension up to 4.4 put them after "?"
const FROM_OLDER_POPUP = 'premium.html?c=CODE0123456789abcdefgh&email=me%40example.com';
const address = (page) => page.evaluate(() => ({ file: location.pathname.split('/').pop(), search: location.search, hash: location.hash }));

test('what the link carried is read, then taken out of the address bar', async () => {
  const page = await ctx.open(FROM_POPUP, { intercept: razorpayStub() });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), 'me@example.com');
  assert.deepEqual(await address(page), { file: 'premium.html', search: '', hash: '' });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a reload keeps the email and the account code, for this tab', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: both(razorpayStub(), confirmStub({ account: 'me@example.com', seen })) });
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), 'me@example.com');
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  assert.equal(seen.find((request) => request.endpoint === 'createOrder').data.checkout, 'CODE0123456789abcdefgh');
  await page.evaluate(() => localStorage.clear());
  await page.close();
  // Another tab opened on the plain page knows nothing of it
  const other = await ctx.open('premium.html', { intercept: razorpayStub() });
  assert.equal(await other.$eval('#emailInput', (el) => el.value), '');
  await other.close();
});

test('a link from an older version of the extension still works, and is cleaned up too', async () => {
  const seen = [];
  const page = await ctx.open(FROM_OLDER_POPUP, { intercept: both(razorpayStub(), confirmStub({ account: 'me@example.com', seen })) });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), 'me@example.com');
  assert.deepEqual(await address(page), { file: 'premium.html', search: '', hash: '' });
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  assert.equal(seen.find((request) => request.endpoint === 'createOrder').data.checkout, 'CODE0123456789abcdefgh');
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('an address with nothing of the kind is left as it is', async () => {
  const page = await ctx.open('premium.html?ref=landing#top', { intercept: razorpayStub() });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), '');
  assert.deepEqual(await address(page), { file: 'premium.html', search: '?ref=landing', hash: '#top' });
  await page.close();
});

test('a purchase started from the popup is paid for that account and shows Premium as already active', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: both(razorpayStub(), confirmStub({ account: 'me@example.com', seen })) });
  assert.equal(await page.$eval('#emailInput', (el) => el.value), 'me@example.com');
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  assert.equal(seen.find((request) => request.endpoint === 'createOrder').data.checkout, 'CODE0123456789abcdefgh');
  const shown = await activation(page);
  assert.match(shown.note, /already active on me@example\.com/);
  assert.equal(shown.steps, false);
  assert.equal((await state(page)).key, 'SUBPIP-TESTKEY1-ABCD');
  assert.deepEqual(page.errors, []);
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('the payment window names the account being upgraded', async () => {
  const page = await ctx.open(FROM_POPUP, { intercept: both(razorpayStub(), confirmStub({ account: 'me@example.com' })) });
  await page.click('#payBtn');
  await page.waitForFunction(() => window.__rzpOpened);
  assert.match(await page.evaluate(() => window.__rzpDescription), /me@example\.com/);
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('coming back after an automatic activation still says it is active', async () => {
  const page = await ctx.open(FROM_POPUP, { intercept: both(razorpayStub(), confirmStub({ account: 'me@example.com' })) });
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  await page.reload({ waitUntil: 'load' });
  await sleep(200);
  assert.match((await activation(page)).note, /already active on me@example\.com/);
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('a checkout code the server no longer accepts falls back to an ordinary purchase', async () => {
  // confirmStub without an account: createOrder answers without accountEmail
  const page = await ctx.open(FROM_POPUP, { intercept: both(razorpayStub(), confirmStub()) });
  await page.click('#payBtn');
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  assert.deepEqual(await activation(page), { note: null, steps: true });
  await page.evaluate(() => localStorage.clear());
  await page.close();
});
