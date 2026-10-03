// Alt+P opens Picture-in-Picture straight away, without the popup. The
// shortcut's gesture has to reach the page through the service worker, so
// these run against a real browser gesture (see shortcutViaAction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { pipEval } from '../helpers/pip.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension({ shortcutViaAction: true });

const pipOpens = (page) => page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('video'), { timeout: 5000 });
const pipCloses = (page) => page.waitForFunction(() => !window.documentPictureInPicture.window, { timeout: 5000 });
const captionCss = (page) => pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent);

test('the shortcut opens Picture-in-Picture with the saved settings', async () => {
  await ctx.setSettings({ fontSize: 24 });
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  assert.match(await captionCss(page), /font-size: 24px/);
  await page.close();
});

test('pressing it again closes Picture-in-Picture', async () => {
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await ctx.pressShortcut(page);
  await pipCloses(page);
  await page.close();
});

test('a window opened by the shortcut follows later setting changes', async () => {
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  await ctx.setSettings({ fontSize: 31 });
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.getElementById('subpip-settings-style').textContent.includes('font-size: 31px'), { timeout: 5000 });
  await page.close();
});

test('it uses the plan of the account signed in on this browser', async () => {
  await ctx.signInAs();
  await ctx.setAuthCache({ uid: 'u1', email: 'tester@example.com', isPremium: true });
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await pipOpens(page);
  assert.equal(await page.evaluate(() => window.__SUBPIP_SETTINGS__.isPremium), true);
  await page.close();
});

test('with no video on the page it opens the popup, which says why', async () => {
  await ctx.worker.evaluate(() => {
    self.popupsOpened = 0;
    chrome.action.openPopup = async () => { self.popupsOpened += 1; };
  });
  const withVideo = await ctx.newPage('generic.html');
  await ctx.pressShortcut(withVideo);
  await pipOpens(withVideo);
  assert.equal(await ctx.worker.evaluate(() => self.popupsOpened), 0);
  await withVideo.close();

  const noVideo = await ctx.newPage('novideo.html');
  await ctx.pressShortcut(noVideo);
  await sleep(1000);
  assert.equal(await ctx.worker.evaluate(() => self.popupsOpened), 1);
  assert.equal(await noVideo.evaluate(() => !!window.documentPictureInPicture.window), false);
  await noVideo.close();
});
