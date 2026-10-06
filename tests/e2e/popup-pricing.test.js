import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();

const prices = (popup) => popup.evaluate(() => ({
  upgrade: document.querySelector('[data-view="upgrade"] .price').textContent.replace(/\s+/g, ' ').trim(),
  button: document.querySelector('#free-actions [data-action="get-premium"]').textContent.trim()
}));

test('India sees rupee prices in the popup', async () => {
  const popup = await ctx.openPopup({ timezone: 'Asia/Kolkata' });
  assert.deepEqual(await prices(popup), { upgrade: '₹999 lifetime', button: 'Get Premium · ₹999 lifetime' });
  await popup.close();
});

test('outside India the popup shows $15', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ timezone: 'America/New_York', stub: firebaseStub() });
  assert.deepEqual(await prices(popup), { upgrade: '$15 lifetime', button: 'Get Premium · $15 lifetime' });
  await popup.close();
});

// Premium is offered where a free user looks, with what it costs

const premiumRow = (popup) => popup.$eval('#premium-row', (row) => ({ shown: !row.hidden, text: `${row.querySelector('.row-label').textContent} ${row.querySelector('.row-value').textContent.trim()}` }));

test('a free user sees a Premium row on the first page, with the price, leading to what it buys', async () => {
  const popup = await ctx.openPopup({ timezone: 'America/New_York' });
  assert.deepEqual(await premiumRow(popup), { shown: true, text: 'SubPIP Premium $15 once' });
  await popup.click('#premium-row');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'SubPIP Premium');
  assert.equal(await popup.$eval('[data-view="upgrade"] .price-terms', (el) => el.textContent.trim()), 'One payment, no subscription. Full refund within 7 days.');
  await popup.close();
});

test('a Premium user is not offered it again', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  assert.equal((await premiumRow(popup)).shown, false);
  await popup.close();
});

test('the popup opens straight at the Premium page when asked to', async () => {
  const popup = await ctx.openPopup({ at: '#upgrade' });
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'SubPIP Premium');
  await popup.close();
});

test('asked from a video\'s window, the extension opens that page in a tab', async () => {
  const popup = await ctx.openPopup();
  const known = new Set(ctx.browser.targets());
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'OPEN_PREMIUM' }));
  const target = await ctx.browser.waitForTarget((t) => t.type() === 'page' && !known.has(t), { timeout: 5000 });
  assert.equal(target.url(), `chrome-extension://${ctx.extensionId}/popup.html#upgrade`);
  await (await target.page()).close();
  await popup.close();
});
