import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(pagePath = 'generic.html', settings = {}) {
  const page = await ctx.newPage(pagePath);
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}

test('controls render inside a shadow root', async () => {
  const page = await open();
  const info = await shadowEval(page, (shadow) => ({
    hasShadow: !!shadow,
    buttons: [...shadow.querySelectorAll('.row .btn')].map((b) => b.getAttribute('aria-label'))
  }));
  assert.equal(info.hasShadow, true);
  assert.deepEqual(info.buttons, ['Play (Space)', 'Back 10 seconds (←)', 'Forward 10 seconds (→)', 'Unmute (M)', 'Captions (C)']);
  await done(page);
});

test('site CSS copied into the PiP window cannot restyle the controls', async () => {
  const page = await open('hostile.html');
  const styles = await shadowEval(page, (shadow, pip) => {
    const play = shadow.querySelector('.btn.play');
    const cs = pip.getComputedStyle(play);
    return { width: play.getBoundingClientRect().width, color: cs.color, iconShown: pip.getComputedStyle(play.querySelector('svg')).display !== 'none' };
  });
  assert.equal(styles.width, 30);
  assert.equal(styles.color, 'rgb(242, 242, 242)');
  assert.equal(styles.iconShown, true);
  await done(page);
});

test('controls render on a Trusted Types page without errors', async () => {
  const page = await open('tt-generic.html');
  // new Function is blocked here too, so query directly
  const count = await page.evaluate(() => window.documentPictureInPicture.window.document
    .querySelector('subpip-controls').shadowRoot.querySelectorAll('.row .btn').length);
  assert.equal(count, 5);
  assert.deepEqual(page.errors, []);
  await done(page);
});

test('play button toggles and updates its icon label', async () => {
  const page = await open();
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.play').click());
  await sleep(300);
  const state = await shadowEval(page, (shadow, pip) => ({
    paused: pip.document.querySelector('video').paused,
    label: shadow.querySelector('.btn.play').getAttribute('aria-label')
  }));
  assert.deepEqual(state, { paused: false, label: 'Pause (Space)' });
  await done(page);
});

test('Space on a focused button toggles exactly once', async () => {
  const page = await open();
  const before = await pipEval(page, (pip) => pip.document.querySelector('video').paused);
  await shadowEval(page, (shadow, pip) => {
    const btn = shadow.querySelector('.btn.cc');
    btn.focus();
    btn.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, composed: true }));
  });
  await sleep(300);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').paused), before);
  await done(page);
});

test('±10s buttons seek', async () => {
  const page = await open();
  const delta = await shadowEval(page, async (shadow, pip) => {
    const video = pip.document.querySelector('video');
    video.currentTime = 30;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    shadow.querySelector('.btn.fwd').click();
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    return video.currentTime - 30;
  });
  assert.ok(delta > 9.5 && delta < 10.5, `moved ${delta}s`);
  await done(page);
});

test('seek bar previews while dragging and seeks on release', async () => {
  const page = await open();
  const result = await shadowEval(page, async (shadow, pip) => {
    const video = pip.document.querySelector('video');
    const seek = shadow.querySelector('.seek-input');
    seek.value = 90;
    seek.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 600));
    const during = { value: Number(seek.value), label: shadow.querySelector('.cur').textContent, time: video.currentTime };
    seek.dispatchEvent(new Event('change'));
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    return { during, after: video.currentTime };
  });
  assert.equal(result.during.value, 90);
  assert.equal(result.during.label, '1:30');
  assert.ok(result.during.time < 20);
  assert.ok(result.after >= 89 && result.after <= 91);
  await done(page);
});

test('hovering the seek bar shows a time tooltip', async () => {
  const page = await open();
  const tip = await shadowEval(page, (shadow, pip) => {
    const seek = shadow.querySelector('.seek-input');
    const rect = seek.getBoundingClientRect();
    seek.dispatchEvent(new pip.PointerEvent('pointermove', { clientX: rect.left + rect.width / 2, clientY: rect.top }));
    const el = shadow.querySelector('.tip');
    return { hidden: el.hidden, text: el.textContent };
  });
  assert.deepEqual(tip, { hidden: false, text: '1:00' });
  await done(page);
});

test('a muted video shows the muted icon and an empty slider', async () => {
  const page = await open();
  const vol = await shadowEval(page, (shadow) => ({
    label: shadow.querySelector('.btn.mute').getAttribute('aria-label'),
    slider: Number(shadow.querySelector('.vol-input').value)
  }));
  assert.deepEqual(vol, { label: 'Unmute (M)', slider: 0 });
  await done(page);
});

test('M toggles mute, arrows change volume', async () => {
  const page = await open();
  const result = await pipEval(page, async (pip) => {
    const video = pip.document.querySelector('video');
    video.volume = 0.5;
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyM' }));
    const afterM = video.muted;
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'ArrowUp' }));
    return { afterM, volume: Math.round(video.volume * 10) / 10, mutedAfterUp: video.muted };
  });
  assert.deepEqual(result, { afterM: false, volume: 0.6, mutedAfterUp: false });
  await done(page);
});

test('CC button and C key hide and show captions', async () => {
  const page = await open();
  await sleep(400);
  const vis = () => pipEval(page, (pip) => pip.getComputedStyle(pip.document.querySelector('.subpip-caption-container')).visibility);
  assert.equal(await vis(), 'visible');
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.cc').click());
  assert.equal(await vis(), 'hidden');
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.btn.cc').getAttribute('aria-pressed')), 'false');
  await pipEval(page, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyC' })));
  assert.equal(await vis(), 'visible');
  await done(page);
});

test('controls auto-hide after idle and lift captions while shown', async () => {
  const page = await open();
  await pipEval(page, (pip) => pip.document.dispatchEvent(new pip.MouseEvent('mousemove', { bubbles: true })));
  await sleep(200);
  const shown = await shadowEval(page, (shadow, pip) => ({
    visible: shadow.querySelector('.root').classList.contains('visible'),
    shift: pip.document.documentElement.style.getPropertyValue('--subpip-caption-shift')
  }));
  assert.equal(shown.visible, true);
  assert.notEqual(shown.shift, '0px');
  await sleep(2800);
  const hidden = await shadowEval(page, (shadow, pip) => ({
    visible: shadow.querySelector('.root').classList.contains('visible'),
    shift: pip.document.documentElement.style.getPropertyValue('--subpip-caption-shift'),
    cursor: pip.document.body.style.cursor
  }));
  assert.deepEqual(hidden, { visible: false, shift: '0px', cursor: 'none' });
  await done(page);
});

test('time reads --:-- before the duration is known', async () => {
  const page = await ctx.newPage('generic.html');
  // Detach the source so duration becomes NaN, then open
  await page.evaluate(() => { const v = document.getElementById('v'); v.removeAttribute('src'); v.load(); });
  await openPip(page).catch(() => {});
  const dur = await shadowEval(page, (shadow) => shadow ? shadow.querySelector('.dur').textContent : null);
  assert.equal(dur, '--:--');
  await done(page);
});

test('tiny windows do not overflow the button row', async () => {
  const page = await open();
  await pipEval(page, (pip) => pip.resizeTo(260, 180));
  await sleep(500);
  const row = await shadowEval(page, (shadow, pip) => {
    const r = shadow.querySelector('.row');
    return { overflow: r.scrollWidth > r.clientWidth, width: pip.innerWidth, timeShown: pip.getComputedStyle(shadow.querySelector('.time')).display !== 'none' };
  });
  assert.equal(row.overflow, false, `row overflows at ${row.width}px`);
  assert.equal(row.timeShown, false);
  await done(page);
});
