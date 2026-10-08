// Anonymous usage counts, through the installed extension: what leaves the
// browser when a window is opened, and that nothing does once switched off or
// before someone who updated has been told
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension({ shortcutViaAction: true });

// The worker's requests to /api/count, kept instead of sent
const listen = () => ctx.worker.evaluate(() => {
  self.counted = [];
  if (self.realFetch) return;
  self.realFetch = self.fetch;
  self.fetch = (url, init) => {
    if (!String(url).endsWith('/count')) return self.realFetch(url, init);
    self.counted.push({ url: String(url), body: JSON.parse(init.body).data, headers: Object.keys(init.headers || {}) });
    return Promise.resolve(new Response('{"result":{"ok":true}}', { status: 200 }));
  };
});
const counted = () => ctx.worker.evaluate(() => self.counted);
async function countedBecomes(n, ms = 6000) {
  for (let i = 0; i < ms / 100 && (await counted()).length < n; i++) await sleep(100);
  return counted();
}
const local = (value) => ctx.worker.evaluate((v) => (v === undefined ? chrome.storage.local.remove('subpipUsageNotice') : chrome.storage.local.set({ subpipUsageNotice: v })), value);
const pipOpens = (page) => page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('subpip-controls'), { timeout: 5000 });
const closeWindow = (page) => page.evaluate(() => window.documentPictureInPicture.window.close());

test('a window that was open a while is counted once: the site as "other", captions found, no address, no name', async () => {
  await listen();
  await local(undefined);
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await page.waitForFunction(() => !!window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent, { timeout: 5000 });
  await sleep(5200);
  await closeWindow(page);
  const [one, ...rest] = await countedBecomes(1);
  assert.deepEqual(rest, []);
  assert.match(one.url, /\/api\/count$/);
  assert.deepEqual(Object.keys(one.body).sort(), ['browser', 'captions', 'event', 'plan', 'site', 'version']);
  assert.deepEqual({ event: one.body.event, site: one.body.site, captions: one.body.captions, plan: one.body.plan }, { event: 'opened', site: 'other', captions: 'found', plan: 'free' });
  assert.ok(!one.headers.some((name) => /authorization/i.test(name)), 'no sign-in travels with it');
  assert.ok(!JSON.stringify(one).includes('generic'), 'nothing of the page');
  await page.close();
});

test('a video with no captions is counted as such', async () => {
  await listen();
  const page = await ctx.newPage('tt-generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await sleep(5200);
  await closeWindow(page);
  assert.equal((await countedBecomes(1))[0].body.captions, 'none');
  await page.close();
});

test('a window closed at once says nothing about captions, so it is not counted', async () => {
  await listen();
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await closeWindow(page);
  await sleep(1500);
  assert.deepEqual(await counted(), []);
  await page.close();
});

test('switched off, nothing is sent', async () => {
  await listen();
  await ctx.setSettings({ shareUsage: false });
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await sleep(5200);
  await closeWindow(page);
  await sleep(1500);
  assert.deepEqual(await counted(), []);
  await ctx.setSettings({});
  await page.close();
});

test('someone who updated is told first: nothing is sent until the note has been seen', async () => {
  await listen();
  await local('pending');
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await sleep(5200);
  await closeWindow(page);
  await sleep(1500);
  assert.deepEqual(await counted(), []);
  await page.close();

  const popup = await ctx.openPopup();
  assert.equal(await popup.$eval('#usage-notice', (el) => !el.hidden), true);
  assert.match(await popup.$eval('#usage-notice p', (el) => el.textContent), /counts, without your name or the pages you visit/);
  await popup.click('#usage-notice-ok');
  await popup.waitForFunction(() => document.getElementById('usage-notice').hidden);
  assert.equal(await ctx.worker.evaluate(async () => (await chrome.storage.local.get('subpipUsageNotice')).subpipUsageNotice), 'seen');
  await popup.close();
});

test('the note\'s other button switches the counts off', async () => {
  await local('pending');
  const popup = await ctx.openPopup();
  await popup.click('#usage-notice-off');
  await popup.waitForFunction(() => document.getElementById('usage-notice').hidden);
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.shareUsage, false);
  await ctx.setSettings({});
  await local(undefined);
  await popup.close();
});

test('the popup has the switch, on by default, with what is sent one tap away', async () => {
  await local(undefined);
  const popup = await ctx.openPopup();
  assert.equal(await popup.$eval('#usage-value', (el) => el.textContent), 'On');
  await popup.click('.row[data-go="usage"]');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'Usage counts');
  assert.equal(await popup.$eval('#usage-on', (el) => el.checked), true);
  assert.equal(await popup.$eval('[data-view="usage"] a', (a) => a.href), 'https://subpip.online/privacy.html#usage');
  await popup.click('#usage-on');
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.shareUsage, false);
  await ctx.setSettings({});
  await popup.close();
});

test('a free user tapping a Premium row, and going on to Premium, are each counted from the popup', async () => {
  await listen();
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="translate"]');
  await popup.click('[data-view="upgrade"] [data-action="get-premium"]').catch(() => {});
  const facts = (await countedBecomes(2)).map((entry) => entry.body);
  assert.deepEqual(facts.map((fact) => [fact.event, fact.feature || '', fact.where]), [['premium_tap', 'translate', 'popup'], ['upgrade_click', '', 'popup']]);
  for (const target of ctx.browser.targets()) if (/subpip\.online/.test(target.url())) await (await target.page())?.close();
  await popup.close();
});
