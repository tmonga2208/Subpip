// "Get Premium" in the popup: a signed-in buyer's checkout is tied to their
// account, so the purchase activates by itself. What the link carries goes
// after "#", the part of an address a browser sends to no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();
const CHECKOUT = 'https://subpip.online/premium.html';

// Record the tab the popup opens instead of opening it
async function getPremium(popup, button) {
  await popup.evaluate(() => {
    window.openedTabs = [];
    chrome.tabs.create = async ({ url }) => { window.openedTabs.push(url); };
  });
  await popup.click(button);
  await popup.waitForFunction(() => window.openedTabs.length > 0, { timeout: 8000 });
  return popup.evaluate(() => window.openedTabs);
}

test('signed in: the checkout opens with a code for this account and the email filled in', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ checkout: 'CODE0123456789abcdefgh' }) });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.deepEqual(await getPremium(popup, '#free-actions [data-action="get-premium"]'),
    [`${CHECKOUT}#c=CODE0123456789abcdefgh&email=tester%40example.com`]);
  await popup.close();
});

test('signed out: the plain checkout page opens', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="speed"]'); // free users land on the upgrade page
  assert.deepEqual(await getPremium(popup, '[data-view="upgrade"] [data-action="get-premium"]'), [CHECKOUT]);
  await popup.close();
});

test('if the server cannot start a checkout, the page still opens, with the email filled in', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.deepEqual(await getPremium(popup, '#free-actions [data-action="get-premium"]'), [`${CHECKOUT}#email=tester%40example.com`]);
  assert.equal(await popup.$eval('#free-actions [data-action="get-premium"]', (button) => button.disabled), false);
  await popup.close();
});
