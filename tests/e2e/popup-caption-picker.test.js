// The popup's side of "point at the captions": starting the picker on the
// page, saying when a site uses picked captions, and forgetting them
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const sub = (popup) => popup.evaluate(() => document.getElementById('status-sub').textContent);
const pickLink = (popup) => popup.evaluate(() => {
  const link = document.getElementById('pick-captions');
  return link.hidden ? null : link.textContent;
});
const savedSelectors = () => ctx.worker.evaluate(async () => (await chrome.storage.sync.get('subpipCaptionSelectors')).subpipCaptionSelectors || {});
const centerOf = (page, selector) => page.evaluate((sel) => {
  const rect = document.querySelector(sel).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}, selector);

test('a recognised web player is named as the caption source', async () => {
  const page = await ctx.newPage('player-captions.html?cls=jw-captions');
  const popup = await ctx.openPopup();
  assert.equal(await sub(popup), 'Captions: JW Player');
  await popup.close();
  await page.close();
});

test('the popup offers to pick captions wherever there is a video, and not where there is none', async () => {
  const page = await ctx.newPage('custom-player.html');
  const popup = await ctx.openPopup();
  assert.equal(await sub(popup), 'No captions detected');
  assert.match(await pickLink(popup), /Pick them on the page/);
  await popup.close();
  await page.close();
  const empty = await ctx.newPage('novideo.html');
  const second = await ctx.openPopup();
  assert.equal(await pickLink(second), null);
  await second.close();
  await empty.close();
});

test('picking from the popup starts on the page, is saved for the site, and can be forgotten', async () => {
  const page = await ctx.newPage('custom-player.html');
  const popup = await ctx.openPopup();
  // The popup closes itself once the page takes over
  await popup.evaluate(() => { window.close = () => { document.body.dataset.closed = 'true'; }; });
  await popup.click('#pick-captions');
  await popup.waitForSelector('body[data-closed="true"]', { timeout: 5000 });
  await popup.close();
  await page.bringToFront();
  await page.waitForSelector('subpip-picker', { timeout: 5000 });
  const { x, y } = await centerOf(page, '.cc-line');
  await page.mouse.click(x, y);
  for (let i = 0; i < 40 && !Object.keys(await savedSelectors()).length; i++) await sleep(100);
  assert.deepEqual(await savedSelectors(), { '127.0.0.1': 'div.cc-layer' });

  const again = await ctx.openPopup();
  assert.equal(await sub(again), 'Captions: picked on this page');
  assert.match(await pickLink(again), /Forget/);
  await again.click('#pick-captions');
  await again.waitForFunction(() => document.getElementById('status-sub').textContent === 'No captions detected', { timeout: 5000 });
  assert.deepEqual(await savedSelectors(), {});
  assert.match(await pickLink(again), /Pick them on the page/);
  await again.close();
  await page.close();
});

test('Picture-in-Picture opened from the popup uses the captions picked for the site', async () => {
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ subpipCaptionSelectors: { '127.0.0.1': 'div.cc-layer' } }));
  const page = await ctx.newPage('custom-player.html');
  const popup = await ctx.openPopup();
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.click('#pip-btn');
  await page.waitForFunction(
    () => (window.documentPictureInPicture.window?.document.querySelector('.subpip-caption-container')?.textContent || '') === 'custom line one',
    { timeout: 6000 }
  );
  await popup.close();
  await page.close();
});

test('captions picked while a page is open reach it without a reload', async () => {
  const page = await ctx.newPage('custom-player.html');
  const popup = await ctx.openPopup();
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.click('#pip-btn');
  await page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('video'), { timeout: 6000 });
  await popup.close();
  // Saved from elsewhere (another tab of the same site, or another browser on the profile)
  await ctx.worker.evaluate(() => chrome.storage.sync.set({ subpipCaptionSelectors: { '127.0.0.1': 'div.cc-layer' } }));
  await page.waitForFunction(
    () => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '') === 'custom line one',
    { timeout: 6000 }
  );
  await page.close();
});
