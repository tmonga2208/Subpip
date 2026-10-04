import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import path from 'node:path';
import { useWebsite, CHROME_STORE_URL } from '../helpers/web.js';
import { WEB_DIR, sleep } from '../helpers/browser.js';

const ctx = useWebsite();

test('sections appear in the spec order', async () => {
  const page = await ctx.open('index.html');
  const ids = await page.$$eval('main > section', (sections) => sections.map((s) => s.id));
  assert.deepEqual(ids, ['hero', 'demo', 'sites', 'features', 'screens', 'how', 'pricing', 'faq']);
  assert.equal(await page.$eval('#hero h1', (h) => h.textContent.trim()), 'Picture-in-Picture, with subtitles.');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('calls to action point to the Web Store and the checkout', async () => {
  const page = await ctx.open('index.html');
  const links = await page.evaluate(() => ({
    nav: document.querySelector('.nav .btn-primary').href,
    hero: document.querySelector('#hero .btn-primary').href,
    heroSecondary: document.querySelector('#hero .btn-ghost').getAttribute('href'),
    premium: document.querySelector('#pricing .price-card.featured .btn-primary').getAttribute('href')
  }));
  assert.deepEqual(links, { nav: CHROME_STORE_URL, hero: CHROME_STORE_URL, heroSecondary: '#pricing', premium: 'premium.html' });
  await page.close();
});

test('nav links jump to real sections', async () => {
  const page = await ctx.open('index.html');
  const missing = await page.$$eval('.nav-links a[href^="#"]', (links) => links
    .map((a) => a.getAttribute('href')).filter((href) => !document.querySelector(href)));
  assert.deepEqual(missing, []);
  await page.close();
});

test('six features, two plans, supported sites listed', async () => {
  const page = await ctx.open('index.html');
  const counts = await page.evaluate(() => ({
    features: document.querySelectorAll('#features .card').length,
    plans: document.querySelectorAll('#pricing .price-card').length,
    sites: [...document.querySelectorAll('#sites .site-chip')].map((c) => c.textContent.trim())
  }));
  assert.equal(counts.features, 6);
  assert.equal(counts.plans, 2);
  assert.deepEqual(counts.sites, ['YouTube', 'Netflix', 'JioHotstar', 'Crunchyroll', 'Any site with built-in captions']);
  await page.close();
});

test('removed: theme toggle, ZIP download, coffee widget, old images', async () => {
  const page = await ctx.open('index.html');
  const html = await page.content();
  for (const gone of ['darkModeToggle', 'subpip.zip', 'buymeacoffee', 'image.png', 'img.png', 'logo.png']) {
    assert.equal(html.includes(gone), false, `${gone} still present`);
  }
  await page.close();
});

test('FAQ questions toggle with mouse and keyboard', async () => {
  const page = await ctx.open('index.html');
  const trigger = '.accordion-item:first-child .accordion-trigger';
  const state = () => page.$eval(trigger, (b) => ({ expanded: b.getAttribute('aria-expanded'), item: b.closest('.accordion-item').dataset.state }));
  assert.deepEqual(await state(), { expanded: 'false', item: 'closed' });
  await page.click(trigger);
  assert.deepEqual(await state(), { expanded: 'true', item: 'open' });
  await page.focus(trigger);
  await page.keyboard.press('Enter');
  assert.deepEqual(await state(), { expanded: 'false', item: 'closed' });
  await page.keyboard.press('Space');
  assert.deepEqual(await state(), { expanded: 'true', item: 'open' });
  await page.close();
});

// ---- Recordings and screenshots of the real window ----

const fileSize = (file) => statSync(path.join(WEB_DIR, file)).size;

test('the hero shows a real recording of the window, with a still to hold its place', async () => {
  const page = await ctx.open('index.html');
  const hero = await page.$eval('#hero video.clip', (video) => ({
    poster: video.getAttribute('poster'), source: video.querySelector('source').getAttribute('src'), type: video.querySelector('source').type,
    muted: video.muted, loop: video.loop, inline: video.playsInline
  }));
  assert.deepEqual(hero, { poster: 'media/demo-captions.webp', source: 'media/demo-captions.mp4', type: 'video/mp4', muted: true, loop: true, inline: true });
  await page.waitForFunction(() => !document.querySelector('#hero video.clip').paused, { timeout: 5000 });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('every recording and screenshot is there, sized, described and light', async () => {
  const page = await ctx.open('index.html');
  const media = await page.evaluate(() => ({
    clips: [...document.querySelectorAll('video.clip')].map((video) => ({
      files: [video.getAttribute('poster'), video.querySelector('source').getAttribute('src')],
      sized: !!(video.getAttribute('width') && video.getAttribute('height')), label: video.getAttribute('aria-label') || ''
    })),
    shots: [...document.querySelectorAll('img[src^="media/"]')].map((img) => ({
      file: img.getAttribute('src'), sized: !!(img.getAttribute('width') && img.getAttribute('height')), alt: img.alt, lazy: img.loading === 'lazy'
    }))
  }));
  assert.equal(media.clips.length, 3);
  assert.equal(media.shots.length, 5);
  for (const clip of media.clips) {
    assert.ok(clip.sized && clip.label.length > 20, JSON.stringify(clip));
    for (const file of clip.files) assert.ok(fileSize(file) > 1000 && fileSize(file) < 1200000, `${file}: ${fileSize(file)} bytes`);
  }
  for (const shot of media.shots) {
    assert.ok(shot.sized && shot.lazy && shot.alt.length > 20, JSON.stringify(shot));
    assert.ok(fileSize(shot.file) > 1000 && fileSize(shot.file) < 150000, `${shot.file}: ${fileSize(shot.file)} bytes`);
  }
  await page.close();
});

test('recordings further down the page play only while they are on screen', async () => {
  const page = await ctx.open('index.html', { width: 1280, height: 600 });
  const playing = () => page.$$eval('#demo video.clip', (videos) => videos.map((video) => !video.paused));
  await sleep(600);
  assert.deepEqual(await playing(), [false, false]);
  await page.$eval('#demo .clips', (clips) => clips.scrollIntoView());
  await page.waitForFunction(() => [...document.querySelectorAll('#demo video.clip')].every((video) => !video.paused), { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => [...document.querySelectorAll('#demo video.clip')].every((video) => video.paused), { timeout: 8000 });
  await page.close();
});

test('with "reduce motion" nothing plays by itself: each recording gets play controls', async () => {
  const page = await ctx.browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(ctx.url('index.html'), { waitUntil: 'load' });
  await sleep(600);
  const state = await page.$$eval('video.clip', (videos) => videos.map((video) => ({ paused: video.paused, controls: video.controls })));
  assert.deepEqual(state, [{ paused: true, controls: true }, { paused: true, controls: true }, { paused: true, controls: true }]);
  await page.close();
});

test('the film used in the demos is credited, with its licence', async () => {
  const page = await ctx.open('index.html');
  const credit = await page.$eval('.credit', (el) => ({ text: el.textContent, links: [...el.querySelectorAll('a')].map((a) => a.href) }));
  assert.match(credit.text, /Sintel/);
  assert.match(credit.text, /Blender Foundation/);
  assert.ok(credit.links.some((href) => href.includes('creativecommons.org/licenses/by/3.0')));
  await page.close();
});

test('on a phone the page still fits its width', async () => {
  const page = await ctx.open('index.html', { width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page is ${overflow}px wider than the screen`);
  await page.close();
});
