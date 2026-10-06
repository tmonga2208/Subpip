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
// What a streaming site does before it plays a protected film: media keys on
// the video. From then on Chrome hands out neither its picture nor its sound.
const addMediaKeys = (page) => page.evaluate(async () => {
  const video = document.querySelector('video') || window.documentPictureInPicture.window.document.querySelector('video');
  const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [
    { initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] },
    { initDataTypes: ['webm'], videoCapabilities: [{ contentType: 'video/webm; codecs="vp8"' }] }
  ]);
  await video.setMediaKeys(await access.createMediaKeys());
});
// packs: what the recogniser says about a language before and after "install"
async function open(settings = PREMIUM, { packs = 'available', fixture = 'tt-generic.html', installMs = 0, mediaKeys = false } = {}) {
  const page = await ctx.newPage(fixture, `sp${++hostCount}.localhost`);
  await page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.data?.type !== 'SUBPIP_TRANSLATE_REQUEST') return;
      const { id, text, targetLang } = event.data;
      window.postMessage({ type: 'SUBPIP_TRANSLATE_RESPONSE', id, translation: `[${targetLang}] ${text}` }, '*');
    });
  });
  if (mediaKeys) await addMediaKeys(page);
  await openPip(page, settings);
  if (packs !== 'none') {
    await page.evaluate((state, wait) => {
      const pip = window.documentPictureInPicture.window;
      window.recognitions = [];
      window.speech = { state, installs: 0, refuses: false };
      pip.SpeechRecognition = class extends EventTarget {
        static async available() { return window.speech.state; }
        static async install() {
          window.speech.installs++;
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (window.speech.offline) throw new DOMException('offline', 'NetworkError');
          window.speech.state = 'available';
          return true;
        }
        start(track) {
          if (window.speech.refuses) throw new DOMException('refused', 'NotAllowedError');
          this.track = track;
          this.running = true;
          window.recognitions.push(this);
        }
        // As Chrome's does: an "aborted" error, then the end
        abort() {
          if (!this.running) return;
          this.running = false;
          setTimeout(() => {
            this.dispatchEvent(Object.assign(new Event('error'), { error: 'aborted' }));
            this.dispatchEvent(new Event('end'));
          });
        }
        stop() { this.running = false; }
      };
      // Every capture of the video's sound, as it is asked for
      const video = pip.document.querySelector('video');
      const capture = video.captureStream;
      window.captures = [];
      video.captureStream = function (...args) {
        const stream = capture.apply(this, args);
        window.captures.push(stream);
        return stream;
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
// The recogniser in use stops by itself, as Chrome's may
const stopsByItself = (page) => page.evaluate(() => {
  const recognition = window.recognitions[window.recognitions.length - 1];
  recognition.running = false;
  recognition.dispatchEvent(new Event('end'));
});
// How many recognisers have been started, once that many have been
const started = (page, count) => page.waitForFunction((n) => window.recognitions.length === n, { timeout: 4000 }, count);
const captionText = (page) => pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container')?.textContent || '');
// Another video in the same element, as a site loads the next episode or an ad
const nextVideo = (page) => pipEval(page, (pip) => {
  const video = pip.document.querySelector('video');
  window.videos = (window.videos || 0) + 1;
  video.src = new URL(`test.mp4?video=${window.videos}`, location.href).href;
  return new Promise((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
});

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
  await stopsByItself(page);
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

// Where captions from speech cannot run, the window keeps the captions it had

test('a protected video is not offered captions from speech', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html', mediaKeys: true });
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
  await clickItem(page, 'Subtitles');
  const offered = (await menuItems(page)).map((row) => row.split('=')[0]);
  assert.ok(!offered.includes('From speech'), offered.join(', '));
  assert.ok(offered.includes('Load file…'));
  await done(page);
});

// Media keys can arrive at any moment, also while the list of languages is open
test('a video protected after the list was opened keeps its captions, and the menu says its sound cannot be read', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await captionIs(page, 'First hidden-track cue');
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
  await clickItem(page, 'Subtitles');
  await clickItem(page, 'From speech');
  await addMediaKeys(page);
  await clickItem(page, 'English');
  await noteMatches(page, /sound cannot be read/);
  assert.equal(await page.evaluate(() => window.recognitions.length), 0);
  assert.deepEqual(await checked(page), ['Off']);
  assert.equal(await captionText(page), 'First hidden-track cue');
  await done(page);
});

test('no speech pack is fetched for a video whose sound cannot be read', async () => {
  const page = await open(PREMIUM, { packs: 'downloadable', installMs: 300 });
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());
  await clickItem(page, 'Subtitles');
  await clickItem(page, 'From speech');
  await addMediaKeys(page);
  await clickItem(page, 'Hindi');
  await noteMatches(page, /sound cannot be read/);
  await sleep(500);
  assert.equal(await page.evaluate(() => window.speech.installs), 0);
  await done(page);
});

test('recognition that Chrome will not start gives the captions back and says so', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await captionIs(page, 'First hidden-track cue');
  await page.evaluate(() => { window.speech.refuses = true; });
  await chooseSpeech(page, 'English');
  await noteMatches(page, /could not start/);
  await captionIs(page, 'First hidden-track cue');
  assert.deepEqual(await checked(page), ['Off']);
  await done(page);
});

test('recognition that Chrome ends for good gives the captions back', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await chooseSpeech(page, 'English');
  await listening(page);
  await hear(page, ['heard instead']);
  await captionIs(page, 'heard instead');
  await page.evaluate(() => window.recognitions[0].dispatchEvent(Object.assign(new Event('error'), { error: 'not-allowed' })));
  await noteMatches(page, /could not start/);
  await captionIs(page, 'First hidden-track cue');
  await done(page);
});

test('a video that becomes protected while it is listened to gets its captions back', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await chooseSpeech(page, 'English');
  await listening(page);
  await addMediaKeys(page);
  await nextVideo(page);
  await noteMatches(page, /sound cannot be read/);
  await captionIs(page, 'First hidden-track cue');
  assert.equal(await page.evaluate(() => window.recognitions.some((recognition) => recognition.running)), false);
  await done(page);
});

test('a language Chrome cannot recognise, chosen while another is listened to, ends the listening', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await chooseSpeech(page, 'English');
  await listening(page);
  await page.evaluate(() => { window.speech.state = 'unavailable'; });
  await clickItem(page, 'Arabic');
  await noteMatches(page, /cannot recognise Arabic/);
  assert.deepEqual(await checked(page), ['Off']);
  await captionIs(page, 'First hidden-track cue');
  assert.equal(await page.evaluate(() => window.recognitions[0].running), false);
  await done(page);
});

test('a speech pack that cannot be fetched, while another language is listened to, ends the listening', async () => {
  const page = await open(PREMIUM, { fixture: 'generic.html' });
  await chooseSpeech(page, 'English');
  await listening(page);
  await page.evaluate(() => Object.assign(window.speech, { state: 'downloadable', offline: true }));
  await clickItem(page, 'Hindi');
  await noteMatches(page, /could not start/);
  assert.deepEqual(await checked(page), ['Off']);
  await captionIs(page, 'First hidden-track cue');
  assert.equal(await page.evaluate(() => window.recognitions[0].running), false);
  await done(page);
});

// Chrome gives a video's sound to the latest capture of it alone, and tells the
// recogniser nothing when the sound it listens to is over: it goes on waiting

test('another video in the same element is listened to in its turn', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await nextVideo(page);
  await started(page, 2);
  assert.deepEqual(await page.evaluate(() => {
    const [before, now] = window.recognitions;
    return { before: before.running, now: now.running, lang: now.lang, sound: now.track.readyState, another: now.track !== before.track };
  }), { before: false, now: true, lang: 'en-US', sound: 'live', another: true });
  await hear(page, ['said in the next video']);
  await captionIs(page, 'said in the next video');
  await done(page);
});

test('a video played again after its end is listened to again', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await pipEval(page, (pip) => {
    const video = pip.document.querySelector('video');
    const ended = new Promise((resolve) => video.addEventListener('ended', () => resolve(), { once: true }));
    video.loop = false;
    video.currentTime = video.duration - 0.2;
    video.play();
    return ended;
  });
  // The sound that was listened to ended with the video
  await page.waitForFunction(() => window.recognitions[0].track.readyState === 'ended', { timeout: 4000 });
  await pipEval(page, (pip) => { pip.document.querySelector('video').play(); });
  await started(page, 2);
  assert.deepEqual(await page.evaluate(() => {
    const [before, now] = window.recognitions;
    return { before: before.running, now: now.running, sound: now.track.readyState };
  }), { before: false, now: true, sound: 'live' });
  await done(page);
});

test('the video\'s sound is captured once, however often the listening starts again', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await stopsByItself(page);
  await started(page, 2);
  await clickItem(page, 'Spanish');
  await started(page, 3);
  assert.equal(await page.evaluate(() => window.captures.length), 1);
  await nextVideo(page);
  await started(page, 4);
  assert.equal(await page.evaluate(() => window.captures.length), 1);
  // Listening is to the latest sound the capture has
  assert.equal(await page.evaluate(() => window.recognitions[3].track === window.captures[0].getAudioTracks().filter((track) => track.readyState === 'live').pop()), true);
  await done(page);
});

test('only the sound is captured, not the picture', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  const picture = () => page.evaluate(() => window.captures.flatMap((stream) => stream.getVideoTracks()).filter((track) => track.readyState === 'live').length);
  assert.equal(await picture(), 0);
  await nextVideo(page);
  await started(page, 2);
  assert.equal(await picture(), 0);
  await done(page);
});

test('a video with nothing loaded is waited for, not taken for a protected one', async () => {
  const page = await open();
  await chooseSpeech(page, 'English');
  await listening(page);
  await pipEval(page, (pip) => {
    const video = pip.document.querySelector('video');
    video.removeAttribute('src');
    video.load();
  });
  await stopsByItself(page);
  await sleep(700);
  assert.match(await note(page), /Choose the language being spoken/);
  assert.deepEqual(await checked(page), ['English']);
  await nextVideo(page);
  await page.waitForFunction(() => {
    const now = window.recognitions[window.recognitions.length - 1];
    return window.recognitions.length > 1 && now.running && now.track.readyState === 'live' && window.recognitions.filter((recognition) => recognition.running).length === 1;
  }, { timeout: 4000 });
  await done(page);
});

test('while another language\'s pack is fetched, the one in use goes on in its own language', async () => {
  const page = await open(PREMIUM, { installMs: 1500 });
  await chooseSpeech(page, 'English');
  await listening(page);
  await page.evaluate(() => { window.speech.state = 'downloadable'; });
  await clickItem(page, 'Hindi');
  await noteMatches(page, /Getting the speech pack for Hindi/);
  // It stops by itself meanwhile, and is started again
  await stopsByItself(page);
  await started(page, 2);
  assert.equal(await page.evaluate(() => window.recognitions[1].lang), 'en-US');
  await started(page, 3);
  assert.equal(await page.evaluate(() => window.recognitions[2].lang), 'hi-IN');
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
