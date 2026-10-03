import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const rows = (popup) => popup.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.row[data-go]')].map((row) => [row.dataset.go, row.querySelector('.row-value').textContent])
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
  assert.deepEqual(await rows(popup), { translate: 'Premium', speed: 'Premium', autopip: 'Off', saved: 'Premium', account: 'Sign in' });
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

test('premium: "Show the original line too" is saved and still on next time', async () => {
  const popup = await premiumPopup();
  await popup.click('.row[data-go="translate"]');
  assert.equal(await popup.$eval('#dual-on', (el) => el.checked), false);
  await popup.click('#dual-on');
  await sleep(100);
  assert.equal((await ctx.storage()).subpipSettings.dualSubtitles, true);
  await popup.close();
  const again = await premiumPopup();
  await again.click('.row[data-go="translate"]');
  assert.equal(await again.$eval('#dual-on', (el) => el.checked), true);
  await again.close();
});

test('premium: choosing a language asks the background to get on-device translation ready', async () => {
  const popup = await premiumPopup();
  await popup.evaluate(() => {
    window.sent = [];
    chrome.runtime.sendMessage = async (message) => { window.sent.push(message); };
  });
  await popup.click('.row[data-go="translate"]');
  await popup.click('#language-list .radio[data-value="hi"]');
  await sleep(100);
  assert.deepEqual(await popup.evaluate(() => window.sent), [{ type: 'PREPARE_TRANSLATION', targetLang: 'hi' }]);
  // turning translation off prepares nothing
  await popup.click('#translate-on');
  await sleep(100);
  assert.equal(await popup.evaluate(() => window.sent.length), 1);
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
  assert.match(await popup.$eval('[data-view="autopip"] .paragraph', (el) => el.textContent), /asks once for access: to one site, or to all sites/);
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

// ---- Auto PiP for the site in the current tab ----

test('Auto PiP can be switched on for the current site alone, and taken off again', async () => {
  const page = await ctx.newPage('generic.html', 'films.localhost');
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="autopip"]');
  await popup.waitForFunction(() => !document.getElementById('autopip-site-field').hidden);
  assert.equal(await popup.$eval('#autopip-site', (el) => el.textContent), 'films.localhost');
  await popup.click('#autopip-site-on');
  await popup.waitForFunction(() => document.querySelectorAll('#autopip-site-list .row').length === 1);
  const saved = (await ctx.storage()).subpipSettings;
  assert.deepEqual(saved.autoPipSites, ['films.localhost']);
  assert.notEqual(saved.autoPip, true);
  assert.equal(await popup.$eval('#autopip-site-list .row-label', (el) => el.textContent), 'films.localhost');
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).autopip, 'films.localhost');

  // Off again, from the list
  await popup.click('.row[data-go="autopip"]');
  await popup.click('#autopip-site-list .row .remove');
  await popup.waitForFunction(() => document.querySelectorAll('#autopip-site-list .row').length === 0);
  assert.deepEqual((await ctx.storage()).subpipSettings.autoPipSites, []);
  assert.equal(await popup.$eval('#autopip-site-on', (el) => el.checked), false);
  await popup.close();
  await page.close();
});

test('a refused request for a site leaves it off and says why', async () => {
  const page = await ctx.newPage('generic.html', 'films.localhost');
  const popup = await ctx.openPopup();
  await popup.evaluate(() => { chrome.permissions.request = async () => false; });
  await popup.click('.row[data-go="autopip"]');
  await popup.waitForFunction(() => !document.getElementById('autopip-site-field').hidden);
  await popup.click('#autopip-site-on');
  await popup.waitForFunction(() => !document.getElementById('autopip-error').hidden);
  assert.match(await popup.$eval('#autopip-error', (el) => el.textContent), /needs access to films\.localhost/);
  assert.deepEqual((await ctx.storage()).subpipSettings.autoPipSites, []);
  assert.equal(await popup.$eval('#autopip-site-on', (el) => el.checked), false);
  await popup.close();
  await page.close();
});

test('on a page that is not a site, only "every site" is offered', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="autopip"]');
  await sleep(300);
  assert.equal(await popup.$eval('#autopip-site-field', (el) => el.hidden), true);
  await popup.close();
});
