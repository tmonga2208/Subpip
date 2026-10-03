// Subtitles from the user's own file (Premium), loaded from the PiP menu
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { useBrowser, sleep, FIXTURES_DIR } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval, pipPageOf } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(settings = {}, fixture = 'generic.html', host) {
  const page = await ctx.newPage(fixture, host);
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  const item = [...shadow.querySelectorAll('.menu .menu-item')].find((i) => i.querySelector('.label').textContent === text);
  item.click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
const note = (page) => shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note')?.textContent ?? null);
const caption = (page) => pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container')?.textContent ?? null);
const captionIs = (page, text) => page.waitForFunction(
  (want) => window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent === want,
  { timeout: 4000 }, text
);
const seek = (page, time) => pipEval(page, async (pip, t) => {
  const video = pip.document.querySelector('video');
  video.pause();
  video.currentTime = t;
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
}, time);

// Menu → Subtitles → Load file…, answered with a fixture file
async function loadFile(page, file) {
  const pip = await pipPageOf(page);
  await openMenu(page);
  await clickItem(page, 'Subtitles');
  const [chooser] = await Promise.all([pip.waitForFileChooser({ timeout: 4000 }), clickItem(page, 'Load file…')]);
  await chooser.accept([path.join(FIXTURES_DIR, file)]);
}

test('free users see Premium on the Subtitles row and an upgrade note', async () => {
  const page = await open({ isPremium: false });
  await openMenu(page);
  assert.ok((await menuItems(page)).includes('Subtitles=Premium'));
  await clickItem(page, 'Subtitles');
  assert.match(await note(page), /Premium feature/);
  assert.deepEqual(await menuItems(page), ['Back=']);
  await done(page);
});

test('a subtitle file takes the place of the page captions', async () => {
  const page = await open({ isPremium: true });
  await seek(page, 5);
  await captionIs(page, 'First hidden-track cue');
  await loadFile(page, 'movie.srt');
  await captionIs(page, 'File cue one');
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('Subtitles=movie.srt'));
  await done(page);
});

test('Earlier and Later shift the timing of the file', async () => {
  const page = await open({ isPremium: true });
  await loadFile(page, 'movie.srt');
  await seek(page, 30.1);
  await captionIs(page, 'File cue two');
  await clickItem(page, 'Later');
  await captionIs(page, 'File cue one');
  assert.match(await note(page), /Delay \+0\.25 s/);
  await clickItem(page, 'Earlier');
  await clickItem(page, 'Earlier');
  await captionIs(page, 'File cue two');
  assert.match(await note(page), /Delay −0\.25 s/);
  await done(page);
});

test('Use page captions drops the file again', async () => {
  const page = await open({ isPremium: true });
  await loadFile(page, 'movie.srt');
  await seek(page, 30.1);
  await captionIs(page, 'File cue two');
  await clickItem(page, 'Use page captions');
  await captionIs(page, 'Second hidden cue');
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('Subtitles=Page'));
  await done(page);
});

test('a file without any timed lines is reported and changes nothing', async () => {
  const page = await open({ isPremium: true });
  await seek(page, 5);
  await captionIs(page, 'First hidden-track cue');
  await loadFile(page, 'empty.srt');
  await page.waitForFunction(() => /No subtitles found/.test(
    window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.menu .menu-note')?.textContent || ''
  ), { timeout: 4000 });
  assert.equal(await caption(page), 'First hidden-track cue');
  await done(page);
});

test('the file and its timing are still there when PiP is reopened on the same page', async () => {
  const page = await open({ isPremium: true });
  await loadFile(page, 'movie.srt');
  await clickItem(page, 'Later');
  await togglePip(page);
  await page.waitForFunction(() => !window.documentPictureInPicture.window);
  await openPip(page, { isPremium: true });
  await seek(page, 30.1);
  await captionIs(page, 'File cue one');
  await done(page);
});

test('on a site with its own caption element the file takes over, and the site captions can be brought back', async () => {
  const page = await open({ isPremium: true }, 'youtube.html', 'youtube.localhost');
  const mirrored = () => pipEval(page, (pip) => pip.document.querySelector('#ytp-caption-window-container')?.textContent.trim() ?? null);
  assert.equal(await mirrored(), 'line A');
  await loadFile(page, 'movie.srt');
  await captionIs(page, 'File cue one');
  assert.equal(await mirrored(), null);
  await clickItem(page, 'Use page captions');
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('#ytp-caption-window-container')?.textContent.trim() === 'line A', { timeout: 4000 });
  assert.equal(await caption(page), null);
  await done(page);
});

test('a Premium subtitle link is loaded when PiP opens', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page, { isPremium: true, externalSubtitleUrl: `http://127.0.0.1:${ctx.server.port}/movie.srt` });
  await seek(page, 5);
  await captionIs(page, 'File cue one');
  await done(page);
});

test('a subtitle link that cannot be read leaves the page captions in place', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page, { isPremium: true, externalSubtitleUrl: `http://127.0.0.1:${ctx.server.port}/missing.srt` });
  await seek(page, 5);
  await captionIs(page, 'First hidden-track cue');
  await done(page);
});

// ---- Dropping a file on the PiP window, instead of going through the menu ----

// Drag a file from the desktop over the window and, unless told not to, let go
async function dragFile(page, file, { drop = true } = {}) {
  const pip = await pipPageOf(page);
  const data = { items: [], files: [path.join(FIXTURES_DIR, file)], dragOperationsMask: 1 };
  const point = { x: 200, y: 120 };
  await pip.mouse.dragEnter(point, data);
  await pip.mouse.dragOver(point, data);
  if (drop) await pip.mouse.drop(point, data);
}
const dropHintShown = (page) => shadowEval(page, (shadow) => shadow.querySelector('.root').classList.contains('dropping'));
const noteIs = (page, pattern) => page.waitForFunction(
  (source) => new RegExp(source).test(window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.menu:not([hidden]) .menu-note')?.textContent || ''),
  { timeout: 4000 }, pattern.source
);

test('a subtitle file dropped on the window is loaded, and the menu shows it', async () => {
  const page = await open({ isPremium: true });
  await dragFile(page, 'movie.srt');
  await captionIs(page, 'File cue one');
  await noteIs(page, /movie\.srt · Delay 0 s/);
  assert.equal(await dropHintShown(page), false);
  await done(page);
});

test('while a file is held over the window, it shows where to drop it', async () => {
  const page = await open({ isPremium: true });
  assert.equal(await dropHintShown(page), false);
  await dragFile(page, 'movie.srt', { drop: false });
  assert.equal(await dropHintShown(page), true);
  await done(page);
});

test('a dropped file that has no subtitles in it is reported', async () => {
  const page = await open({ isPremium: true });
  await seek(page, 5);
  await captionIs(page, 'First hidden-track cue');
  await dragFile(page, 'empty.srt');
  await noteIs(page, /No subtitles found/);
  assert.equal(await caption(page), 'First hidden-track cue');
  await done(page);
});

test('free users who drop a file are told it is a Premium feature', async () => {
  const page = await open({ isPremium: false });
  await seek(page, 5);
  await captionIs(page, 'First hidden-track cue');
  await dragFile(page, 'movie.srt');
  await noteIs(page, /Premium feature/);
  assert.equal(await caption(page), 'First hidden-track cue');
  await done(page);
});
