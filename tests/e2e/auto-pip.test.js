// Auto PiP on tab switch: Chrome calls the page's "enterpictureinpicture"
// handler, so a page is set up for it exactly while that handler is
// registered. These tests watch the handler come and go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

// The test copy of the extension has access to all sites, like a browser
// where the user has granted it for Auto PiP
const ctx = useExtension();

// A fixture tab that records every time the page script arms ('on') or
// disarms ('off') automatic PiP
async function videoTab() {
  const page = await ctx.browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__autoPip = [];
    const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (action, handler) => {
      if (action === 'enterpictureinpicture') window.__autoPip.push(handler ? 'on' : 'off');
      return original(action, handler);
    };
  });
  await page.goto(`http://127.0.0.1:${ctx.server.port}/generic.html`);
  return page;
}
const history = (page) => page.evaluate(() => window.__autoPip.join(' → '));
async function becomes(page, expected) {
  for (let i = 0; i < 60; i++) {
    if (await history(page) === expected) return;
    await sleep(100);
  }
  assert.equal(await history(page), expected);
}
const setAutoPip = (on) => ctx.setSettings({ autoPip: on });

test('with Auto PiP on, a video page is set up for it; switching it off undoes that in the open tab', async () => {
  await setAutoPip(true);
  await sleep(500);
  const page = await videoTab();
  await becomes(page, 'on');
  await setAutoPip(false);
  await becomes(page, 'on → off');
  await page.close();
});

test('switching Auto PiP on reaches the tabs that are already open', async () => {
  const page = await videoTab();
  await sleep(500);
  assert.equal(await history(page), '');
  await setAutoPip(true);
  await becomes(page, 'on');
  await page.close();
});

test('the saved switch alone is not enough: this browser must have granted all-sites access', async () => {
  // The switch is saved in sync storage, shared with the user's other
  // browsers; the permission belongs to one browser. Here it is not granted.
  await ctx.worker.evaluate(() => {
    self.realContains = chrome.permissions.contains;
    chrome.permissions.contains = async () => false;
  });
  try {
    await setAutoPip(true);
    await sleep(500);
    const page = await videoTab();
    const popup = await ctx.openPopup();
    await popup.click('#pip-btn');
    await page.waitForFunction(() => !!window.documentPictureInPicture.window, { timeout: 5000 });
    await sleep(800);
    assert.equal(await history(page), '', 'using SubPIP on the page must not arm automatic PiP');
    assert.equal(await page.evaluate(() => window.__SUBPIP_SETTINGS__.autoPip), false);
    await page.close();
  } finally {
    await ctx.worker.evaluate(() => { chrome.permissions.contains = self.realContains; });
  }
});

test('a tab stops opening PiP by itself once its extension is gone, and is reconnected when it comes back', async () => {
  await setAutoPip(true);
  await sleep(500);
  const page = await videoTab();
  await becomes(page, 'on');

  // Disabled, reloaded or updated: nothing can tell this tab about setting
  // changes any more, so it must not keep doing what the user may since have
  // switched off
  await ctx.setExtensionEnabled(false);
  await becomes(page, 'on → off');

  // Back again, with Auto PiP still on: the open tab works again without a refresh
  await ctx.setExtensionEnabled(true);
  await becomes(page, 'on → off → on');

  // ...and it listens to the new copy of the extension: off means off
  await setAutoPip(false);
  await becomes(page, 'on → off → on → off');
  await page.close();
});
