// Chrome decides the PiP window's size (it clamps large requests and reuses
// the size the user last dragged it to), so the video has to be fitted to
// whatever window it actually gets, not only after a resize.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

const geometry = (page) => pipEval(page, (pip) => {
  const rect = pip.document.querySelector('video').getBoundingClientRect();
  return {
    window: [pip.innerWidth, pip.innerHeight],
    video: [Math.round(rect.width), Math.round(rect.height)],
    at: [Math.round(rect.left), Math.round(rect.top)]
  };
});

function assertFills({ window, video, at }) {
  assert.deepEqual({ video, at }, { video: window, at: [0, 0] });
}

const closePip = async (page) => {
  await togglePip(page);
  await page.waitForFunction(() => !window.documentPictureInPicture.window);
};

test('the video fills the window as soon as PiP opens', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await sleep(300);
  assertFills(await geometry(page));
  await closePip(page);
  await page.close();
});

test('a player far larger than the window is scaled down to fit it', async () => {
  const page = await ctx.newPage('generic.html');
  // Like a theater-mode or full-screen player: Chrome will not open a window this big
  await page.evaluate(() => Object.assign(document.getElementById('v'), { width: 2600, height: 1462 }));
  await openPip(page);
  await sleep(300);
  assertFills(await geometry(page));
  await closePip(page);
  await page.close();
});

test('reopening after the user resized the window fills it again', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await pipEval(page, (pip) => pip.resizeTo(420, 300));
  await sleep(500);
  await closePip(page);
  await openPip(page);
  await sleep(300);
  assertFills(await geometry(page));
  await closePip(page);
  await page.close();
});

test('the page gets its video back at its own size', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await closePip(page);
  const restored = await page.evaluate(() => {
    const video = document.getElementById('v');
    return { style: video.style.cssText, size: [video.clientWidth, video.clientHeight] };
  });
  assert.deepEqual(restored, { style: '', size: [640, 360] });
  await page.close();
});
