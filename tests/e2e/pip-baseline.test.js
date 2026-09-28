// Behavior that must survive the redesign unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

test('opens PiP, moves the video and leaves a placeholder', async () => {
  const page = await ctx.newPage('generic.html');
  await page.evaluate(() => document.getElementById('v').play());
  await openPip(page);
  const layout = await page.evaluate(() => [...document.getElementById('wrap').childNodes]
    .map((node) => (node.nodeType === Node.COMMENT_NODE ? '#comment' : node.id)).join(','));
  assert.equal(layout, 'before,#comment,after');
  await togglePip(page);
  await page.close();
});

test('renders cues from a hidden text track and follows seeks', async () => {
  const page = await ctx.newPage('generic.html');
  // Cues only become active once playback runs
  await page.evaluate(() => document.getElementById('v').play());
  await openPip(page);
  await sleep(500);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent), 'First hidden-track cue');
  await pipEval(page, (pip) => { pip.document.querySelector('video').currentTime = 70; });
  await sleep(800);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent), 'Third cue after seeking');
  await togglePip(page);
  await page.close();
});

test('ArrowLeft in the PiP window seeks back 10 seconds', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const delta = await pipEval(page, async (pip) => {
    const video = pip.document.querySelector('video');
    video.currentTime = 50;
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    return 50 - video.currentTime;
  });
  assert.ok(delta > 9.5 && delta < 10.5, `seeked back ${delta}s`);
  await togglePip(page);
  await page.close();
});

test('live settings update restyles captions', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await page.evaluate(() => window.postMessage({ type: 'SUBPIP_SETTINGS_UPDATED', settings: { fontSize: 40 } }, '*'));
  await sleep(300);
  const css = await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent);
  assert.match(css, /font-size: 40px/);
  await togglePip(page);
  await page.close();
});

test('running again closes PiP and restores the video in place', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await togglePip(page);
  await sleep(800);
  const state = await page.evaluate(() => ({
    open: !!window.documentPictureInPicture.window,
    layout: [...document.getElementById('wrap').childNodes].map((node) => node.id).join(','),
    style: document.getElementById('v').style.cssText
  }));
  assert.deepEqual(state, { open: false, layout: 'before,v,after', style: '' });
  await page.close();
});

test('YouTube adapter mirrors captions, keeps 2 lines, re-attaches', async () => {
  const page = await ctx.newPage('youtube.html', 'youtube.localhost');
  await openPip(page);
  const visibleLines = () => pipEval(page, (pip) => [...pip.document.querySelectorAll('#ytp-caption-window-container .captions-text > span')]
    .filter((span) => span.style.display !== 'none').map((span) => span.textContent).join('|'));
  assert.equal(await visibleLines(), 'line A');
  await page.evaluate(() => window.setCaption(['l1', 'l2', 'l3', 'l4']));
  await sleep(300);
  assert.equal(await visibleLines(), 'l3|l4');
  await page.evaluate(() => window.recreate('after recreate'));
  await sleep(1500);
  assert.equal(await visibleLines(), 'after recreate');
  assert.deepEqual(page.errors, []);
  await togglePip(page);
  await page.close();
});
