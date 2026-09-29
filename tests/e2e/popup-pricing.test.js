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
  assert.deepEqual(await prices(popup), { upgrade: '₹1000 lifetime', button: 'Get Premium · ₹1000 lifetime' });
  await popup.close();
});

test('outside India the popup shows $15', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ timezone: 'America/New_York', stub: firebaseStub() });
  assert.deepEqual(await prices(popup), { upgrade: '$15 lifetime', button: 'Get Premium · $15 lifetime' });
  await popup.close();
});
