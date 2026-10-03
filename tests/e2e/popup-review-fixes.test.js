// Popup final-review fixes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

test('turning on Auto PiP is saved even if the popup re-renders during the prompt', async () => {
  const popup = await ctx.openPopup();
  await popup.evaluate(() => {
    chrome.permissions.request = () => new Promise((resolve) => setTimeout(() => resolve(true), 400));
  });
  await popup.click('.row[data-go="autopip"]');
  await popup.click('#autopip-on');
  // Something else re-renders while the permission prompt is open
  await popup.evaluate(() => document.getElementById('translate-on').click());
  await sleep(700);
  assert.equal((await ctx.storage()).subpipSettings.autoPip, true);
  await popup.close();
});

test('a paying user is Premium right away, before the network check finishes', async () => {
  await ctx.signInAs();
  await ctx.setAuthCache({ uid: 'u1', email: 'tester@example.com', isPremium: true });
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true, status: 'slow' }), ready: false });
  await sleep(500); // well before the 2s status answer
  assert.equal(await popup.$eval('#plan-badge', (b) => b.textContent), 'Premium');
  await popup.close();
});

test('opening the popup offline keeps a paying user Premium', async () => {
  await ctx.signInAs();
  await ctx.setAuthCache({ uid: 'u1', email: 'tester@example.com', isPremium: true });
  const popup = await ctx.openPopup({ stub: firebaseStub({ status: 'fail' }) });
  await sleep(500);
  assert.equal(await popup.$eval('#plan-badge', (b) => b.textContent), 'Premium');
  assert.equal((await ctx.authCache()).isPremium, true);
  await popup.close();
});

test('a successful activation stays visible after the account turns Premium', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premiumAfterActivate: true }) });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  await popup.type('#license-key', 'SUBPIP-ABCDEFGH-1234');
  await popup.click('#license-submit');
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  const shown = await popup.evaluate(() => {
    const el = document.getElementById('license-success');
    return { text: el.textContent, visible: !!el.offsetParent };
  });
  assert.deepEqual(shown, { text: 'Premium activated.', visible: true });
  await popup.close();
});
