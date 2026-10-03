// Buttons a site shows over its player for a moment - Skip intro, Next
// episode - offered in the PiP window, where the site's own cannot be reached
// (Premium)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();
const PREMIUM = { isPremium: true };

async function open(settings, fixture = 'streaming.html', host) {
  const page = await ctx.newPage(fixture, host);
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const pills = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.actions .pill')].map((pill) => pill.textContent));
const pillsAre = (page, expected) => page.waitForFunction((want) => {
  const shadow = window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot;
  return JSON.stringify([...shadow.querySelectorAll('.actions .pill')].map((pill) => pill.textContent)) === JSON.stringify(want);
}, { timeout: 4000 }, expected);
const pressPill = (page, text) => shadowEval(page, (shadow, pip, label) => [...shadow.querySelectorAll('.actions .pill')].find((pill) => pill.textContent.startsWith(label)).click(), text);
const pillsVisible = (page) => shadowEval(page, (shadow, pip) => Number(pip.getComputedStyle(shadow.querySelector('.actions')).opacity) === 1);

test('a Skip intro button on the site appears in the window, and pressing it there presses the site\'s', async () => {
  const page = await open(PREMIUM);
  assert.deepEqual(await pills(page), []);
  await page.evaluate(() => window.showButton('skip'));
  await pillsAre(page, ['Skip intro']);
  await pressPill(page, 'Skip intro');
  assert.deepEqual(await page.evaluate(() => window.pressed), ['skip']);
  // The site took its button away, so the window's goes too
  await pillsAre(page, []);
  await done(page);
});

test('the buttons stay on screen when the control bar hides', async () => {
  const page = await open(PREMIUM);
  await page.evaluate(() => window.showButton('skip'));
  await pillsAre(page, ['Skip intro']);
  await sleep(3000);
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.root').classList.contains('visible')), false);
  assert.equal(await pillsVisible(page), true);
  await done(page);
});

test('buttons are recognised by their label or accessible name, whatever the capitals', async () => {
  const page = await open(PREMIUM);
  await page.evaluate(() => { window.showButton('recap'); window.showButton('next'); });
  await pillsAre(page, ['Skip recap', 'Next episode']);
  await pressPill(page, 'Next episode');
  assert.deepEqual(await page.evaluate(() => window.pressed), ['next']);
  await done(page);
});

test('other buttons that merely mention skipping are left alone, ads included', async () => {
  const page = await open(PREMIUM);
  await page.evaluate(() => window.showButton('ad'));
  await sleep(1500);
  assert.deepEqual(await pills(page), []);
  await done(page);
});

test('free users see the button marked Premium, with the control bar only, and pressing it explains', async () => {
  const page = await open({ isPremium: false });
  await page.evaluate(() => window.showButton('skip'));
  await pillsAre(page, ['Skip introPremium']);
  await sleep(3000);
  assert.equal(await pillsVisible(page), false);
  await pipEval(page, (pip) => pip.document.dispatchEvent(new pip.MouseEvent('mousemove', { bubbles: true })));
  await sleep(300);
  assert.equal(await pillsVisible(page), true);
  await pressPill(page, 'Skip intro');
  assert.deepEqual(await page.evaluate(() => window.pressed), []);
  assert.match(await shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note').textContent), /Premium feature/);
  await done(page);
});

// ---- YouTube: the next video is a call on its player ----

const barButtons = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.row .btn')].map((button) => button.getAttribute('aria-label')));

test('YouTube gets a Next button in the bar, and Shift+N, for Premium', async () => {
  const page = await open(PREMIUM, 'youtube-player.html', 'youtube.localhost');
  assert.ok((await barButtons(page)).includes('Next video (Shift+N)'));
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.next').click());
  await pipEval(page, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyN', key: 'N', shiftKey: true, bubbles: true, cancelable: true })));
  assert.deepEqual(await page.evaluate(() => window.playerState.calls.filter((call) => call === 'next')), ['next', 'next']);
  await done(page);
});

test('without Premium, or on a site with no next video, the bar is as before', async () => {
  const free = await open({ isPremium: false }, 'youtube-player.html', 'youtube.localhost');
  assert.equal((await barButtons(free)).some((label) => /Next video/.test(label)), false);
  await pipEval(free, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyN', key: 'N', shiftKey: true, bubbles: true, cancelable: true })));
  assert.deepEqual(await free.evaluate(() => window.playerState.calls.filter((call) => call === 'next')), []);
  await done(free);
  const generic = await open(PREMIUM, 'generic.html');
  assert.equal((await barButtons(generic)).some((label) => /Next video/.test(label)), false);
  await done(generic);
});
