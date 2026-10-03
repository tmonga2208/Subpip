// Captions from the video's own sound (Premium): Chrome's on-device speech
// recognition listens to it and SubPIP shows what is heard. The browser under
// test cannot download speech packs, so a stand-in recogniser answers here;
// the real one is exercised by hand (see the README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();
const PREMIUM = { isPremium: true };

let hostCount = 0;
// packs: what the recogniser says about a language before and after "install"
async function open(settings = PREMIUM, { packs = 'available', fixture = 'tt-generic.html', installMs = 0 } = {}) {
  const page = await ctx.newPage(fixture, `sp${++hostCount}.localhost`);
  await page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.type !== 'SUBPIP_TRANSLATE_REQUEST') return;
      const { id, text, targetLang } = event.data;
      window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id, translation: `[${targetLang}] ${text}` }, '*');
    });
  });
  await openPip(page, settings);
  if (packs !== 'none') {
    await page.evaluate((state, wait) => {
      const pip = window.documentPictureInPicture.window;
      window.recognitions = [];
      window.speech = { state, installs: 0 };
      pip.SpeechRecognition = class extends EventTarget {
        static async available() { return window.speech.state; }
        static async install() {
          window.speech.installs++;
          await new Promise((resolve) => setTimeout(resolve, wait));
          window.speech.state = 'available';
          return true;
        }
        start(track) { this.track = track; this.running = true; window.recognitions.push(this); }
        abort() { this.running = false; }
        stop() { this.running = false; }
      };
    }, packs, installMs);
  }
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
// What the recogniser reports: finished phrases, then the one still being said
const hear = (page, finals, interim = '') => page.evaluate((done, running) => {
  const recognition = window.recognitions[window.recognitions.length - 1];
  const results = [...done.map((text) => Object.assign([{ transcript: text }], { isFinal: true })), ...(running ? [Object.assign([{ transcript: running }], { isFinal: false })] : [])];
  recognition.dispatchEvent(Object.assign(new Event('result'), { resultIndex: 0, results }));
}, finals, interim);
const captionIs = (page, text) => page.waitForFunction(
  (want) => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '') === want,
  { timeout: 4000 }, text
);
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const checked = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item[aria-checked="true"] .label')].map((label) => label.textContent));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  [...shadow.querySelectorAll('.menu .menu-item')].find((item) => item.querySelector('.label').textContent === text).click();
}, label);
const note = (page) => shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note')?.textContent ?? null);
const noteMatches = (page, pattern) => page.waitForFunction((source) => {
  const text = window.documentPictureInPicture.window.document.querySelector('subpip-controls').shadowRoot.querySelector('.menu .menu-note')?.textContent || '';
  return new RegExp(source).test(text);
}, { timeout: 4000 }, pattern.source);
async function chooseSpeech(page, language) {
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
  await clickItem(page, 'Subtitles');
  await clickItem(page, 'From speech');
  await clickItem(page, language);
}
const listening = (page) => page.waitForFunction(() => window.recognitions.length > 0, { timeout: 4000 });

test('choosing the spoken language starts listening to the video\'s own sound, on the device', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  assert.deepEqual(await page.evaluate(() => {
    const [recognition] = window.recognitions;
    return { lang: recognition.lang, continuous: recognition.continuous, interim: recognition.interimResults, local: recognition.processLocally, track: recognition.track.kind, live: recognition.track.readyState };
  }), { lang: 'en-US', continuous: true, interim: true, local: true, track: 'audio', live: 'live' });
  assert.deepEqual(await checked(page), ['English']);
  await clickItem(page, 'Back');
  assert.ok((await menuItems(page)).includes('From speech=English'));
  await done(page);
});

test('what is heard shows as captions, phrase by phrase and while it is still being said', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, [], 'hello from');
  await captionIs(page, 'hello from');
  await hear(page, ['hello from the video'], 'and more');
  await captionIs(page, 'hello from the video and more');
  await done(page);
});

test('running speech stays two short lines of the latest words', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, ['picture in picture keeps the subtitles on the screen', 'the quick brown fox jumps over the lazy dog'], 'and then it carries on talking');
  await page.waitForFunction(() => (window.documentPictureInPicture.window.document.querySelector('.subpip-caption-container')?.textContent || '').replace(/\n/g, ' ').endsWith('carries on talking'), { timeout: 4000 });
  const lines = await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent.split('\n'));
  assert.equal(lines.length, 2);
  await done(page);
});

test('the captions are translated like any others', async () => {
  const page = await open({ ...PREMIUM, translationEnabled: true, targetLanguage: 'es' });
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, ['hello from the video']);
  await captionIs(page, '[es] hello from the video');
  await done(page);
});

test('a speech pack that is not on the device yet is fetched first, with a note meanwhile', async () => {
  const page = await open(PREMIUM, { packs: 'downloadable', installMs: 700 });
  await chooseSpeech(page, 'Hindi');
  await noteMatches(page, /Getting the speech pack for Hindi/);
  assert.equal(await page.evaluate(() => window.recognitions.length), 0);
  await listening(page);
  assert.equal(await page.evaluate(() => window.speech.installs), 1);
  assert.equal(await page.evaluate(() => window.recognitions[0].lang), 'hi-IN');
  await done(page);
});

test('a language Chrome cannot recognise on this device says so and listens to nothing', async () => {
  const page = await open(PREMIUM, { packs: 'unavailable' });
  await chooseSpeech(page, 'Arabic');
  await noteMatches(page, /cannot recognise Arabic on this device/);
  assert.equal(await page.evaluate(() => window.recognitions.length), 0);
  assert.deepEqual(await checked(page), ['Off']);
  await done(page);
});

test('a browser without the feature says what is needed', async () => {
  const page = await open(PREMIUM, { packs: 'none' });
  await page.evaluate(() => {
    const pip = window.documentPictureInPicture.window;
    pip.SpeechRecognition = undefined;
    pip.webkitSpeechRecognition = undefined;
  });
  await chooseSpeech(page, 'English');
  await noteMatches(page, /Chrome 139 or newer/);
  await done(page);
});

test('Off goes back to the page\'s own captions and stops listening', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await captionIs(page, 'First hidden-track cue');
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, ['heard instead']);
  await captionIs(page, 'heard instead');
  await clickItem(page, 'Off');
  await captionIs(page, 'First hidden-track cue');
  assert.equal(await page.evaluate(() => window.recognitions[0].running), false);
  await done(page);
});

test('recognition that stops by itself is started again', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await page.evaluate(() => window.recognitions[0].dispatchEvent(new Event('end')));
  await page.waitForFunction(() => window.recognitions.length === 2, { timeout: 4000 });
  await hear(page, ['still listening']);
  await captionIs(page, 'still listening');
  await done(page);
});

test('a caption that nobody adds to is taken away after a few seconds', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, ['the last thing said']);
  await captionIs(page, 'the last thing said');
  await sleep(4600);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent), '');
  await done(page);
});

test('without Premium, From speech is marked Premium and explains', async () => {
  const page = await open({ isPremium: false });
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
  await clickItem(page, 'Subtitles');
  assert.ok((await menuItems(page)).includes('From speech=Premium'));
  await clickItem(page, 'From speech');
  assert.match(await note(page), /Premium feature/);
  await done(page);
});
