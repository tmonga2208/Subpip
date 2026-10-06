// Captions on sites SubPIP has no adapter for: the common web players are
// recognised by their caption element, and for anything else the viewer points
// at the captions on the page once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { useBrowser, sleep, DIST_DIR } from '../helpers/browser.js';
import { openPip, togglePip, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function done(page) {
  if (await page.evaluate(() => !!window.documentPictureInPicture.window)) {
    await togglePip(page);
    await page.waitForFunction(() => !window.documentPictureInPicture.window);
  }
  await page.close();
}
const captionIs = (page, text) => page.waitForFunction(
  (want) => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.innerText || '') === want,
  { timeout: 4000 }, text
);
const captionShown = (page) => pipEval(page, (pip) => {
  const box = pip.document.querySelector('.subpip-caption-container');
  return !!box && pip.getComputedStyle(box).display !== 'none';
});

// ---- The common web players ----

const PLAYERS = { 'Video.js': 'vjs-text-track-display', 'JW Player': 'jw-captions', Plyr: 'plyr__captions', Bitmovin: 'bmpui-ui-subtitle-overlay', 'Shaka Player': 'shaka-text-container' };

for (const [name, cls] of Object.entries(PLAYERS)) {
  test(`a ${name} player's captions show in the window, on whatever site it is`, async () => {
    const page = await ctx.newPage(`player-captions.html?cls=${cls}`);
    await openPip(page);
    await captionIs(page, 'player line one');
    await page.evaluate(() => window.setLines('and the next line'));
    await captionIs(page, 'and the next line');
    await done(page);
  });
}

test('two caption lines stay two lines, and a hidden caption element shows nothing', async () => {
  const page = await ctx.newPage('player-captions.html?cls=jw-captions');
  await openPip(page);
  await page.evaluate(() => window.setLines('first line', 'second line'));
  await captionIs(page, 'first line\nsecond line');
  await page.evaluate(() => window.hideCaptions());
  await page.waitForFunction(() => {
    const box = window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container');
    return window.documentPictureInPicture.window.getComputedStyle(box).display === 'none';
  }, { timeout: 4000 });
  await done(page);
});

test('a video\'s own subtitle tracks are used ahead of a player element', async () => {
  const page = await ctx.newPage('generic.html');
  await page.evaluate(() => document.getElementById('wrap').append(Object.assign(document.createElement('div'), { className: 'jw-captions', textContent: 'from the player element' })));
  await openPip(page);
  await captionIs(page, 'First hidden-track cue');
  await done(page);
});

test('a player whose caption element appears later is picked up then', async () => {
  const page = await ctx.newPage('tt-generic.html');
  await openPip(page);
  await sleep(300);
  assert.equal(await captionShown(page), false);
  await page.evaluate(() => document.getElementById('wrap').append(Object.assign(document.createElement('div'), { className: 'plyr__captions', textContent: 'late captions' })));
  await captionIs(page, 'late captions');
  await done(page);
});

// ---- Pointing at the captions ----

// The page script without the "open now" flag: it only sets itself up
async function loadSubpip(page) {
  await page.evaluate(await readFile(path.join(DIST_DIR, 'script.js'), 'utf8'));
}
const centerOf = (page, selector) => page.evaluate((sel) => {
  const rect = document.querySelector(sel).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}, selector);
const pickerOpen = (page) => page.evaluate(() => !!document.querySelector('subpip-picker'));

test('a site SubPIP does not know shows no captions until they are pointed at', async () => {
  const page = await ctx.newPage('custom-player.html');
  await openPip(page);
  await sleep(1300);
  assert.equal(await captionShown(page), false);
  await done(page);
});

test('pointing at the caption text picks the whole caption layer, even though it lets clicks through', async () => {
  const page = await ctx.newPage('custom-player.html');
  await loadSubpip(page);
  await page.evaluate(() => window.__SUBPIP__.pickCaptions());
  assert.equal(await pickerOpen(page), true);
  const { x, y } = await centerOf(page, '.cc-line');
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.waitForFunction(() => window.saved.length === 1, { timeout: 4000 });
  const result = await page.evaluate(() => ({
    isLayer: document.querySelector(window.saved[0]) === document.querySelector('.cc-layer'),
    // The player under the captions did not get the click
    clicks: window.clicks
  }));
  assert.deepEqual(result, { isLayer: true, clicks: 0 });
  await page.close();
});

test('a click that is not on text picks nothing and the picker stays', async () => {
  const page = await ctx.newPage('custom-player.html');
  await loadSubpip(page);
  await page.evaluate(() => window.__SUBPIP__.pickCaptions());
  await page.mouse.click(320, 100);
  await sleep(300);
  assert.deepEqual(await page.evaluate(() => window.saved), []);
  assert.equal(await pickerOpen(page), true);
  await page.close();
});

test('Escape leaves the picker without choosing', async () => {
  const page = await ctx.newPage('custom-player.html');
  await loadSubpip(page);
  await page.evaluate(() => window.__SUBPIP__.pickCaptions());
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await pickerOpen(page), false);
  assert.deepEqual(await page.evaluate(() => window.saved), []);
  // The page has its clicks back
  await page.mouse.click(320, 100);
  assert.equal(await page.evaluate(() => window.clicks), 1);
  await page.close();
});

test('captions that were pointed at are followed, also when the site builds them anew', async () => {
  const page = await ctx.newPage('custom-player.html');
  await openPip(page, { captionSelector: 'div.cc-layer' });
  await captionIs(page, 'custom line one');
  await page.evaluate(() => window.setLine('custom line two'));
  await captionIs(page, 'custom line two');
  await page.evaluate(() => window.recreate('after a rebuild'));
  await captionIs(page, 'after a rebuild');
  await done(page);
});

test('pointing at the captions while the window is open shows them straight away', async () => {
  const page = await ctx.newPage('custom-player.html');
  await openPip(page);
  await page.evaluate(() => window.__SUBPIP__.pickCaptions());
  const { x, y } = await centerOf(page, '.cc-line');
  await page.mouse.click(x, y);
  await captionIs(page, 'custom line one');
  await done(page);
});

test('what the viewer pointed at is used ahead of a site\'s own adapter', async () => {
  const page = await ctx.newPage('youtube.html', 'youtube.localhost');
  await page.evaluate(() => document.getElementById('player').append(Object.assign(document.createElement('div'), { className: 'my-captions', textContent: 'the viewer\'s choice' })));
  await openPip(page, { captionSelector: 'div.my-captions' });
  await captionIs(page, 'the viewer\'s choice');
  await done(page);
});

// JW Player stops drawing captions once its video has left the page (it sends
// no more time updates), so its caption element freezes. Its lines are read
// from the player itself instead, by their times.
const windowCaption = (page) => page.evaluate(() => window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '');
const windowCaptionIs = (page, text) => page.waitForFunction((want) => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '') === want, { timeout: 4000 }, text);
const seekTo = (page, time) => page.evaluate((t) => { window.documentPictureInPicture.window.document.querySelector('video').currentTime = t; }, time);

test('JW Player captions follow the video, not the line the player froze on', async () => {
  const page = await ctx.newPage('jwplayer.html');
  await openPip(page);
  await windowCaptionIs(page, 'first line & more');
  await seekTo(page, 6);
  await windowCaptionIs(page, 'second line');
  await seekTo(page, 62);
  await windowCaptionIs(page, 'a line after seeking');
  await seekTo(page, 30);
  await windowCaptionIs(page, '');
  await page.close();
});

test('JW Player captions switched off on the page are off in the window, and come back', async () => {
  const page = await ctx.newPage('jwplayer.html');
  await openPip(page);
  await windowCaptionIs(page, 'first line & more');
  await page.evaluate(() => { window.jw.current = 0; });
  await windowCaptionIs(page, '');
  await page.evaluate(() => { window.jw.current = 1; });
  await windowCaptionIs(page, 'first line & more');
  assert.equal(await windowCaption(page), 'first line & more');
  await page.close();
});
