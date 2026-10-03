// Caption translation in the PiP window, including "original + translation"
// (dual subtitles). The page script asks its relay for translations; here a
// stand-in relay answers "[lang] text" after an adjustable delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();
const PREMIUM_ES = { isPremium: true, translationEnabled: true, targetLanguage: 'es' };

// Every test gets its own origin, so one test's cached translations (IndexedDB)
// cannot answer for another
let hostCount = 0;
async function open(settings, { fixture = 'generic.html', host, delay = 0 } = {}) {
  const page = await ctx.newPage(fixture, host || `t${++hostCount}.localhost`);
  await page.evaluate((ms) => {
    window.translateRequests = [];
    window.translateDelay = ms;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.type !== 'SUBPIP_TRANSLATE_REQUEST') return;
      const { id, text, targetLang } = event.data;
      window.translateRequests.push(text);
      setTimeout(() => window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id, translation: `[${targetLang}] ${text}` }, '*'), window.translateDelay);
    });
  }, delay);
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const seek = (page, time) => pipEval(page, async (pip, t) => {
  const video = pip.document.querySelector('video');
  video.pause();
  video.currentTime = t;
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
}, time);
// The caption as the viewer reads it: one entry per line
const lines = (page, selector = '.subpip-caption-container') => pipEval(page, (pip, sel) => {
  const box = pip.document.querySelector(sel);
  if (!box) return null;
  const parts = [...box.querySelectorAll('.subpip-original, .subpip-translation')];
  return parts.length ? parts.map((part) => part.textContent) : [box.textContent.trim()];
}, selector);
const linesAre = async (page, want, selector) => {
  for (let i = 0; i < 40; i++) {
    if (JSON.stringify(await lines(page, selector)) === JSON.stringify(want)) return;
    await sleep(100);
  }
  assert.deepEqual(await lines(page, selector), want);
};
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  const item = [...shadow.querySelectorAll('.menu .menu-item')].find((i) => i.querySelector('.label').textContent === text);
  item.click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());

test('Premium translation shows the translated line in place of the original', async () => {
  const page = await open(PREMIUM_ES);
  await seek(page, 5);
  await linesAre(page, ['[es] First hidden-track cue']);
  await done(page);
});

test('free users are never translated, whatever the saved settings say', async () => {
  const page = await open({ ...PREMIUM_ES, isPremium: false });
  await seek(page, 5);
  await linesAre(page, ['First hidden-track cue']);
  await sleep(300);
  assert.deepEqual(await page.evaluate(() => window.translateRequests), []);
  await done(page);
});

test('dual subtitles show the original line above its translation', async () => {
  const page = await open({ ...PREMIUM_ES, dualSubtitles: true });
  await seek(page, 5);
  await linesAre(page, ['First hidden-track cue', '[es] First hidden-track cue']);
  const sizes = await pipEval(page, (pip) => ['.subpip-original', '.subpip-translation']
    .map((sel) => parseFloat(pip.getComputedStyle(pip.document.querySelector(sel)).fontSize)));
  assert.ok(sizes[0] < sizes[1], `original ${sizes[0]}px should be smaller than translation ${sizes[1]}px`);
  await done(page);
});

test('dual subtitles never pair a line with the previous line\'s translation', async () => {
  const page = await open({ ...PREMIUM_ES, dualSubtitles: true }, { delay: 700 });
  await seek(page, 5);
  await linesAre(page, ['First hidden-track cue', '[es] First hidden-track cue']);
  await seek(page, 30);
  await sleep(250); // the new line is on screen, its translation is still on the way
  const [original, translation] = await lines(page);
  assert.equal(original, 'Second hidden cue');
  assert.equal(translation.trim(), '');
  await linesAre(page, ['Second hidden cue', '[es] Second hidden cue']);
  await done(page);
});

test('the PiP menu turns the original line on and off for this window', async () => {
  const page = await open(PREMIUM_ES);
  await seek(page, 5);
  await linesAre(page, ['[es] First hidden-track cue']);
  await openMenu(page);
  await clickItem(page, 'Translate');
  await clickItem(page, 'Show original too');
  await linesAre(page, ['First hidden-track cue', '[es] First hidden-track cue']);
  await clickItem(page, 'Show original too');
  await linesAre(page, ['[es] First hidden-track cue']);
  assert.equal(await page.evaluate(() => window.__SUBPIP_SETTINGS__.dualSubtitles), undefined);
  await done(page);
});

test('dual subtitles on a site with its own caption element keep both lines in one caption box', async () => {
  const page = await open({ ...PREMIUM_ES, dualSubtitles: true }, { fixture: 'youtube.html', host: `youtube.t${++hostCount}.localhost` });
  await linesAre(page, ['line A', '[es] line A'], '#ytp-caption-window-container');
  const boxes = await pipEval(page, (pip) => pip.document.querySelectorAll('#ytp-caption-window-container > *').length);
  assert.equal(boxes, 1);
  await done(page);
});

test('a line that cannot be translated is shown once, not twice', async () => {
  const page = await open({ ...PREMIUM_ES, dualSubtitles: true });
  // the service answering with the same text means "nothing to translate"
  await page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'SUBPIP_TRANSLATE_REQUEST') return;
      event.stopImmediatePropagation();
      window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id: event.data.id, translation: event.data.text }, '*');
    }, true);
  });
  await seek(page, 5);
  await sleep(600);
  await linesAre(page, ['First hidden-track cue']);
  await done(page);
});
