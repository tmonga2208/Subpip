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
  assert.equal((await ctx.storage()).subpipAuth.isPremium, true);
  await popup.close();
});
