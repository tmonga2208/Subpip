import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { openPip } from '../helpers/pip.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const status = (popup) => popup.evaluate(() => ({
  state: document.getElementById('status').dataset.state,
  title: document.getElementById('status-title').textContent,
  sub: document.getElementById('status-sub').textContent,
  button: document.getElementById('pip-btn').textContent,
  disabled: document.getElementById('pip-btn').disabled
}));

test('a page with a video and a text track', async () => {
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  assert.deepEqual(await status(popup), {
    state: 'video', title: 'Video found on 127.0.0.1', sub: 'Captions: page text track', button: 'Open Picture-in-Picture', disabled: false
  });
  await popup.close();
  await page.close();
});

test('a supported site names its caption source', async () => {
  const page = await ctx.newPage('youtube.html', 'youtube.localhost');
  const popup = await ctx.openPopup();
  assert.equal((await status(popup)).sub, 'Captions: YouTube');
  await popup.close();
  await page.close();
});

test('a page without a video disables the button', async () => {
  const page = await ctx.newPage('novideo.html');
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.equal(s.title, 'No video on this page');
  assert.equal(s.disabled, true);
  await popup.close();
  await page.close();
});

test('chrome:// pages are off-limits', async () => {
  const page = await ctx.newPage('novideo.html');
  await page.goto('chrome://version');
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.equal(s.title, "SubPIP can't run on this page");
  assert.equal(s.disabled, true);
  await popup.close();
  await page.close();
});

test('a browser error page is handled as off-limits', async () => {
  const page = await ctx.newPage('novideo.html');
  await page.goto('http://127.0.0.1:1/').catch(() => {});
  const popup = await ctx.openPopup();
  assert.equal((await status(popup)).state, 'restricted');
  assert.deepEqual(popup.errors, []);
  await popup.close();
  await page.close();
});

test('an open PiP window offers Close', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.deepEqual({ title: s.title, sub: s.sub, button: s.button }, {
    title: 'Playing in Picture-in-Picture', sub: 'on 127.0.0.1', button: 'Close Picture-in-Picture'
  });
  await popup.close();
  await page.close();
});

test('Open injects SubPIP into the page with the current settings', async () => {
  await ctx.setSettings({ fontSize: 24 });
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  await popup.click('#pip-btn');
  await sleep(1000);
  const injected = await page.evaluate(() => ({ instance: !!window.__SUBPIP__, fontSize: window.__SUBPIP_SETTINGS__?.fontSize }));
  assert.deepEqual(injected, { instance: true, fontSize: 24 });
  await page.close();
});
