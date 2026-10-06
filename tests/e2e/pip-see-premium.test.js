// "See Premium" in a video's window, through the installed extension from end
// to end: the window asks, the relay passes it on, the extension opens its
// page about Premium in a tab
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension({ shortcutViaAction: true });

test('See Premium at a Premium feature opens the extension\'s Premium page in a tab', async () => {
  const page = await ctx.newPage('generic.html');
  await ctx.pressShortcut(page);
  await page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('subpip-controls'), { timeout: 5000 });
  const inMenu = (fn, ...args) => page.evaluate((source, a) => {
    const shadow = window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot;
    return new Function(`return (${source})`)()(shadow, ...a);
  }, fn.toString(), args);
  const click = (label) => inMenu((shadow, text) => [...shadow.querySelectorAll('.menu .menu-item')].find((item) => item.querySelector('.label').textContent === text).click(), label);
  await inMenu((shadow) => shadow.querySelector('.btn.gear').click());
  await click('Speed');
  assert.match(await inMenu((shadow) => shadow.querySelector('.menu .menu-note').textContent), /^Premium feature\. (₹999|\$15) once/);
  const known = new Set(ctx.browser.targets());
  await click('See Premium');
  const target = await ctx.browser.waitForTarget((t) => t.type() === 'page' && !known.has(t), { timeout: 5000 });
  assert.equal(target.url(), `chrome-extension://${ctx.extensionId}/popup.html#upgrade`);
  const tab = await target.page();
  await tab.waitForFunction(() => document.getElementById('page-title')?.textContent === 'SubPIP Premium', { timeout: 5000 });
  await tab.close();
  await page.close();
});
