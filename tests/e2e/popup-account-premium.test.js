// Premium belongs to the account: a device id recorded by an older version
// (or another browser) must not take Premium away
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();

test('Premium stays on when the account was activated in another browser', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true, deviceId: 'device_from_another_browser' }) });
  await popup.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await popup.$eval('#plan-badge', (b) => b.textContent), 'Premium');
  assert.equal((await ctx.authCache()).isPremium, true);
  await popup.close();
});

// ---- a one-year pass ----

test('Premium for a year shows the day it ends', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true, premiumUntil: Date.UTC(2027, 9, 8, 10) }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  await popup.click('#account-btn');
  assert.equal(await popup.$eval('#premium-until', (el) => (el.hidden ? '' : el.textContent.trim())), 'Premium until 8 October 2027. It ends then by itself: nothing is charged again.');
  await popup.close();
});

test('lifetime Premium shows no end', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  assert.equal(await popup.$eval('#premium-until', (el) => el.hidden), true);
  await popup.close();
});

test('a year that is over counts as Free at once, even if the server has not caught up', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true, premiumUntil: Date.now() - 60000 }) });
  await popup.waitForFunction(() => document.body.dataset.ready === 'true');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(await popup.$eval('#plan-badge', (el) => el.textContent), 'Free');
  assert.equal((await ctx.authCache()).isPremium, false);
  await popup.close();
});

test('the Premium page gives the one-year price beside the lifetime one', async () => {
  const popup = await ctx.openPopup({ timezone: 'Asia/Manila' });
  await popup.click('#premium-row');
  assert.equal(await popup.$eval('[data-view="upgrade"] .price', (el) => el.textContent.replace(/\s+/g, ' ').trim()), '$7 lifetime');
  assert.equal(await popup.$eval('[data-view="upgrade"] .price-year', (el) => el.textContent.replace(/\s+/g, ' ').trim()), 'or $3 for one year');
  await popup.close();
});
