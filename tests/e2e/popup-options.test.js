import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const rows = (popup) => popup.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.row')].map((row) => [row.dataset.go, row.querySelector('.row-value').textContent])
));
const view = (popup) => popup.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.hidden).dataset.view);

async function premiumPopup() {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  return popup;
}

test('free users see Premium tags and reach the upgrade page', async () => {
  const popup = await ctx.openPopup();
  assert.deepEqual(await rows(popup), { translate: 'Premium', speed: 'Premium', autopip: 'Off', account: 'Sign in' });
  await popup.click('.row[data-go="translate"]');
  assert.equal(await view(popup), 'upgrade');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'SubPIP Premium');
  await popup.close();
});

test('upgrade page: "Already paid?" while signed out goes to the account page', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="speed"]');
  await popup.click('#upgrade-check-payment');
  assert.equal(await view(popup), 'account');
  await popup.close();
});

test('premium: turning on translation and picking a language', async () => {
  const popup = await premiumPopup();
  assert.equal((await rows(popup)).translate, 'Off');
  await popup.click('.row[data-go="translate"]');
  assert.equal(await view(popup), 'translate');
  await popup.click('#language-list .radio[data-value="es"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.deepEqual({ on: saved.translationEnabled, lang: saved.targetLanguage }, { on: true, lang: 'es' });
  assert.equal(await popup.$eval('#translate-on', (el) => el.checked), true);
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).translate, 'Spanish');
  await popup.close();
});

test('premium: default playback speed', async () => {
  const popup = await premiumPopup();
  await popup.click('.row[data-go="speed"]');
  await popup.click('#speed-list .radio[data-value="1.5"]');
  await sleep(100);
  assert.equal((await ctx.storage()).subpipSettings.playbackSpeed, 1.5);
  assert.equal(await popup.$eval('#speed-list .radio[aria-checked="true"]', (el) => el.dataset.value), '1.5');
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).speed, '1.5×');
  await popup.close();
});

test('auto PiP explains itself and turns on', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="autopip"]');
  assert.match(await popup.$eval('[data-view="autopip"] .paragraph', (el) => el.textContent), /access to all sites/);
  await popup.click('#autopip-on');
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.autoPip, true);
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).autopip, 'On');
  await popup.close();
});

test('the account row shows the signed-in email', async () => {
  await ctx.signInAs({ email: 'me@example.com' });
  const popup = await ctx.openPopup({ stub: firebaseStub({ email: 'me@example.com' }) });
  await popup.waitForFunction(() => document.getElementById('account-value').textContent === 'me@example.com');
  await popup.close();
});
