// Study tools (Premium): step through caption lines, stop after each one,
// click a word for its meaning, save a line
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval, pipPageOf } from '../helpers/pip.js';

const ctx = useBrowser();
// Meanings and line translations go into Spanish; the captions themselves are left as they are
const PREMIUM = { isPremium: true, targetLanguage: 'es' };

// Every test gets its own origin (translations are cached per origin), and a
// stand-in relay that answers "[lang] text" and collects saved lines
let hostCount = 0;
async function open(settings = PREMIUM, fixture = 'generic.html', hostPrefix = 's') {
  const page = await ctx.newPage(fixture, `${hostPrefix}${++hostCount}.localhost`);
  await page.evaluate(() => {
    window.savedLines = [];
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === 'SUBPIP_TRANSLATE_REQUEST') {
        const { id, text, targetLang } = event.data;
        window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id, translation: `[${targetLang}] ${text}` }, '*');
      }
      if (event.data.type === 'SUBPIP_SAVE_LINE') window.savedLines.push(event.data.line);
    });
  });
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const key = (page, code, extra = {}) => pipEval(page, (pip, init) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })), { code, key: code.replace('Key', '').toLowerCase(), ...extra });
const seek = (page, time) => pipEval(page, async (pip, t) => {
  const video = pip.document.querySelector('video');
  video.pause();
  video.currentTime = t;
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
}, time);
const video = (page) => pipEval(page, (pip) => {
  const v = pip.document.querySelector('video');
  return { time: v.currentTime, paused: v.paused };
});
const timeIs = async (page, want) => {
  for (let i = 0; i < 30; i++) {
    if (Math.abs((await video(page)).time - want) < 0.6) return;
    await sleep(100);
  }
  assert.fail(`video is at ${(await video(page)).time}, expected about ${want}`);
};
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  [...shadow.querySelectorAll('.menu .menu-item')].find((item) => item.querySelector('.label').textContent === text).click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
const lookup = (page) => shadowEval(page, (shadow) => {
  const box = shadow.querySelector('.lookup');
  if (!box) return null;
  const text = (selector) => box.querySelector(selector)?.textContent ?? null;
  return { word: text('.lookup-word'), meaning: text('.lookup-meaning'), line: text('.lookup-line'), translation: text('.lookup-translation') };
});
// A real click on a word of the caption, in the PiP window
async function clickWord(page, word, selector = '.subpip-caption-container') {
  const locate = () => pipEval(page, (pip, wanted, sel) => {
    const walker = pip.document.createTreeWalker(pip.document.querySelector(sel), 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.data.indexOf(wanted);
      if (index === -1) continue;
      const range = pip.document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + wanted.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
  }, word, selector);
  // Captions slide up when the control bar appears: wait until they rest
  let point = await locate();
  for (let i = 0; i < 20; i++) {
    await sleep(120);
    const again = await locate();
    if (point && again && Math.abs(again.y - point.y) < 0.5 && Math.abs(again.x - point.x) < 0.5) break;
    point = again;
  }
  assert.ok(point, `"${word}" is not in the caption`);
  await (await pipPageOf(page)).mouse.click(point.x, point.y);
}

// ---- Stepping through lines ----

test('S replays the line, D and A go to the next and the previous one', async () => {
  const page = await open();
  await seek(page, 30);
  await key(page, 'KeyS');
  await timeIs(page, 10);
  await key(page, 'KeyD');
  await timeIs(page, 60);
  await key(page, 'KeyA');
  await timeIs(page, 10);
  await key(page, 'KeyA');
  await timeIs(page, 0);
  await done(page);
});

test('on a site that shows captions as plain text, lines already seen can be gone back to', async () => {
  const page = await open(PREMIUM, 'youtube.html', 'youtube.s');
  await seek(page, 5);
  await page.evaluate(() => window.setCaption(['line B']));
  await sleep(200);
  await seek(page, 20);
  await page.evaluate(() => window.setCaption(['line C']));
  await sleep(200);
  await key(page, 'KeyA');
  await timeIs(page, 5);
  await key(page, 'KeyD');
  await timeIs(page, 20);
  await done(page);
});

// ---- Stopping after each line ----

test('Q makes the video stop at the end of each line, once', async () => {
  const page = await open();
  await seek(page, 8.4);
  await key(page, 'KeyQ');
  await pipEval(page, (pip) => pip.document.querySelector('video').play());
  for (let i = 0; i < 40 && !(await video(page)).paused; i++) await sleep(100);
  const stopped = await video(page);
  assert.equal(stopped.paused, true);
  assert.ok(stopped.time > 9.4 && stopped.time < 10.05, `stopped at ${stopped.time}`);
  // Carrying on plays the next line; it does not stop on the same line again
  await pipEval(page, (pip) => pip.document.querySelector('video').play());
  await sleep(700);
  assert.equal((await video(page)).paused, false);
  await done(page);
});

test('where captions are plain text, the video stops when a line gives way to the next', async () => {
  const page = await open(PREMIUM, 'youtube.html', 'youtube.s');
  await key(page, 'KeyQ');
  await pipEval(page, (pip) => pip.document.querySelector('video').play());
  await sleep(300);
  await page.evaluate(() => window.setCaption(['a new line']));
  for (let i = 0; i < 30 && !(await video(page)).paused; i++) await sleep(100);
  assert.equal((await video(page)).paused, true);
  await done(page);
});

test('the menu has the study tools and switches the stopping', async () => {
  const page = await open();
  await openMenu(page);
  assert.ok((await menuItems(page)).includes('Study tools=Off'));
  await clickItem(page, 'Study tools');
  assert.ok((await menuItems(page)).includes('Stop after each line=Off'));
  await clickItem(page, 'Stop after each line');
  assert.ok((await menuItems(page)).includes('Stop after each line=On'));
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('Study tools=Stops after lines'));
  // Q switches the same thing
  await key(page, 'KeyQ');
  assert.ok((await menuItems(page)).includes('Study tools=Off'));
  await done(page);
});

test('without Premium the keys do nothing, captions let clicks through, and the menu row says Premium', async () => {
  const page = await open({ isPremium: false, targetLanguage: 'es' });
  await seek(page, 30);
  await key(page, 'KeyS');
  await key(page, 'KeyQ');
  await sleep(400);
  assert.ok(Math.abs((await video(page)).time - 30) < 0.5);
  await clickWord(page, 'Second');
  await sleep(300);
  assert.equal(await lookup(page), null);
  // The click reached the picture: it plays
  assert.equal((await video(page)).paused, false);
  await openMenu(page);
  assert.ok((await menuItems(page)).includes('Study tools=Premium'));
  await clickItem(page, 'Study tools');
  assert.match(await shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note').textContent), /Premium feature/);
  await done(page);
});

// ---- A word's meaning ----

test('clicking a word shows its meaning and the line\'s, and holds the video until it is closed', async () => {
  const page = await open();
  await pipEval(page, (pip) => pip.document.querySelector('video').play());
  await sleep(300);
  await clickWord(page, 'hidden');
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.lookup-meaning')?.textContent === '[es] hidden', { timeout: 4000 });
  assert.deepEqual(await lookup(page), { word: 'hidden', meaning: '[es] hidden', line: 'First hidden-track cue', translation: '[es] First hidden-track cue' });
  assert.equal((await video(page)).paused, true);
  await key(page, 'Escape', { key: 'Escape' });
  await sleep(300);
  assert.equal(await lookup(page), null);
  assert.equal((await video(page)).paused, false);
  await done(page);
});

test('a video that was paused stays paused after looking a word up', async () => {
  const page = await open();
  await clickWord(page, 'First');
  await page.waitForFunction(() => !!window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.lookup'), { timeout: 4000 });
  await key(page, 'Escape', { key: 'Escape' });
  await sleep(300);
  assert.equal((await video(page)).paused, true);
  await done(page);
});

test('Save line hands the line, the word and their meanings over for keeping', async () => {
  const page = await open();
  await clickWord(page, 'cue');
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.lookup-meaning')?.textContent === '[es] cue', { timeout: 4000 });
  await shadowEval(page, (shadow) => shadow.querySelector('.lookup-save').click());
  await page.waitForFunction(() => window.savedLines.length === 1, { timeout: 4000 });
  assert.deepEqual(await page.evaluate(() => window.savedLines[0]), { text: 'First hidden-track cue', translation: '[es] First hidden-track cue', word: 'cue', meaning: '[es] cue' });
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.lookup-save').textContent), 'Saved');
  await done(page);
});

test('where the caption shows the translation, a click gives the line both ways and no single word', async () => {
  const page = await open({ ...PREMIUM, translationEnabled: true });
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent === '[es] First hidden-track cue', { timeout: 4000 });
  await clickWord(page, 'hidden');
  await page.waitForFunction(() => !!window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.lookup'), { timeout: 4000 });
  assert.deepEqual(await lookup(page), { word: null, meaning: null, line: 'First hidden-track cue', translation: '[es] First hidden-track cue' });
  await done(page);
});

test('captions mirrored from a site can be clicked too', async () => {
  const page = await open(PREMIUM, 'youtube.html', 'youtube.s');
  await clickWord(page, 'line', '#ytp-caption-window-container');
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.lookup-meaning')?.textContent === '[es] line', { timeout: 4000 });
  assert.equal((await lookup(page)).line, 'line A');
  await done(page);
});
