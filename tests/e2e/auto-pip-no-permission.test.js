// The extension as installed: no access to all sites. A saved "Auto PiP on"
// (it travels in sync storage from the user's other browsers, or stays behind
// after the permission was refused) must not arm automatic PiP here - the
// popup shows the switch as Off in this state, so the user could not even
// turn it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

// The toolbar click stands in for Alt+P (see shortcutViaAction)
const ctx = useExtension({ shortcutViaAction: true, allSites: false });

test('using SubPIP on a page does not arm automatic PiP without the all-sites permission', async () => {
  await ctx.setSettings({ autoPip: true });
  await sleep(500);
  assert.equal(await ctx.worker.evaluate(() => chrome.permissions.contains({ origins: ['<all_urls>'] })), false);

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
  await ctx.pressShortcut(page);
  await page.waitForFunction(() => !!window.documentPictureInPicture.window, { timeout: 5000 });
  await sleep(800);
  assert.deepEqual(await page.evaluate(() => window.__autoPip), []);
  await page.close();
});
