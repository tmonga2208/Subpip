// The page's own captions: SubPIP switches them on by itself, and the window's
// menu chooses between the languages the page offers
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(fixture, settings = {}, host) {
  const page = await ctx.newPage(fixture, host);
  await openPip(page, settings);
  return page;
}
async function close(page) {
  await togglePip(page);
  await page.waitForFunction(() => !window.documentPictureInPicture.window);
}
async function done(page) {
  if (await page.evaluate(() => !!window.documentPictureInPicture.window)) await close(page);
  await page.close();
}
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const checked = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item[aria-checked="true"] .label')].map((label) => label.textContent));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  [...shadow.querySelectorAll('.menu .menu-item')].find((item) => item.querySelector('.label').textContent === text).click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
const note = (page) => shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note')?.textContent ?? null);
const captionIs = (page, text) => page.waitForFunction(
  (want) => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '') === want,
  { timeout: 4000 }, text
);
const siteCaptionIs = (page, text) => page.waitForFunction(
  (want) => (window.documentPictureInPicture.window.document.querySelector('#ytp-caption-window-container')?.textContent || '') === want,
  { timeout: 4000 }, text
);

// ---- A video's own subtitle tracks ----

test('a video whose subtitle tracks are all off still gets captions, in the viewer\'s language', async () => {
  const page = await open('tracks.html');
  // The browser under test reads English; Spanish is listed first
  await captionIs(page, 'First hidden-track cue');
  await done(page);
});

test('the menu lists the page\'s subtitle tracks and switches between them', async () => {
  const page = await open('tracks.html');
  await captionIs(page, 'First hidden-track cue');
  await openMenu(page);
  assert.ok((await menuItems(page)).includes('Subtitles=English'));
  await clickItem(page, 'Subtitles');
  assert.deepEqual((await menuItems(page)).slice(0, 4), ['Back=', 'Español=', 'English=', 'Off=']);
  assert.deepEqual(await checked(page), ['English']);
  await clickItem(page, 'Español');
  await captionIs(page, 'Primera línea');
  assert.deepEqual(await checked(page), ['Español']);
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('Subtitles=Español'));
  await done(page);
});

test('Off takes the page captions away until a track is chosen again', async () => {
  const page = await open('tracks.html');
  await captionIs(page, 'First hidden-track cue');
  await openMenu(page);
  await clickItem(page, 'Subtitles');
  await clickItem(page, 'Off');
  await captionIs(page, '');
  assert.deepEqual(await checked(page), ['Off']);
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('Subtitles=Off'));
  await clickItem(page, 'Subtitles');
  await clickItem(page, 'English');
  await captionIs(page, 'First hidden-track cue');
  await done(page);
});

test('closing the window gives the page its tracks back as they were', async () => {
  const page = await open('tracks.html');
  await captionIs(page, 'First hidden-track cue');
  await close(page);
  assert.deepEqual(await page.evaluate(() => window.trackModes()), ['disabled', 'disabled']);
  await page.close();
});

test('a track the page shows itself is drawn by SubPIP while the window is open', async () => {
  const page = await open('tracks.html?showing=es');
  // In SubPIP's own caption box (so it takes the caption style and translation)...
  await captionIs(page, 'Primera línea');
  // ...and not a second time by the video element
  assert.deepEqual(await page.evaluate(() => window.trackModes()), ['hidden', 'disabled']);
  await close(page);
  assert.deepEqual(await page.evaluate(() => window.trackModes()), ['showing', 'disabled']);
  await page.close();
});

test('choosing a page track is free; loading a file is the Premium part', async () => {
  const page = await open('tracks.html', { isPremium: false });
  await openMenu(page);
  await clickItem(page, 'Subtitles');
  assert.deepEqual(await menuItems(page), ['Back=', 'Español=', 'English=', 'Off=', 'From speech=Premium', 'Load file…=Premium']);
  await clickItem(page, 'Español');
  await captionIs(page, 'Primera línea');
  await clickItem(page, 'Load file…');
  assert.match(await note(page), /Premium feature/);
  await done(page);
});

// ---- YouTube: captions are a module of its player ----

test('YouTube captions that are off are switched on for the window, and off again when it closes', async () => {
  const page = await open('youtube-player.html', {}, 'youtube.localhost');
  await siteCaptionIs(page, 'captions in en');
  await close(page);
  assert.equal(await page.evaluate(() => window.playerState.on), false);
  await page.close();
});

test('YouTube captions that were already on are left on', async () => {
  const page = await open('youtube-player.html?on', {}, 'youtube.localhost');
  await siteCaptionIs(page, 'captions in en');
  await close(page);
  assert.equal(await page.evaluate(() => window.playerState.on), true);
  await page.close();
});

test('the menu lists YouTube\'s caption languages once each and switches the player', async () => {
  const page = await open('youtube-player.html', {}, 'youtube.localhost');
  await siteCaptionIs(page, 'captions in en');
  await openMenu(page);
  await clickItem(page, 'Subtitles');
  // English is offered once, as the written track rather than the auto-generated one
  assert.deepEqual((await menuItems(page)).slice(0, 4), ['Back=', 'English=', 'French=', 'Off=']);
  assert.deepEqual(await checked(page), ['English']);
  await clickItem(page, 'French');
  await siteCaptionIs(page, 'captions in fr');
  assert.deepEqual(await checked(page), ['French']);
  await clickItem(page, 'Off');
  await siteCaptionIs(page, '');
  assert.equal(await page.evaluate(() => window.playerState.on), false);
  await done(page);
});
