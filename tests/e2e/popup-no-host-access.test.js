// The extension as users install it: no host permissions. Sign-in, the plan
// check and license activation must work as plain cross-origin requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension({ allSites: false });

test('the installed extension holds no host access', async () => {
  const granted = await ctx.worker.evaluate(async () => (await chrome.permissions.getAll()).origins);
  assert.deepEqual(granted, []);
});

test('signing in, reading the plan and activating a license work without host access', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub({ premiumAfterActivate: true }) });
  await popup.click('#account-btn');
  await popup.type('#auth-email', 'tester@example.com');
  await popup.type('#auth-password', 'secret123');
  await popup.click('#auth-submit');
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.equal(await popup.$eval('#account-plan', (el) => el.textContent), 'Free');

  await popup.type('#license-key', 'SUBPIP-ABCDEFGH-1234');
  await popup.click('#license-submit');
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium', { timeout: 5000 });
  assert.equal(await popup.$eval('#license-error', (el) => el.hidden), true);
  assert.deepEqual(popup.errors, []);
  await popup.close();
});
