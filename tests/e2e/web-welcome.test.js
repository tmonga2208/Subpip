// The page SubPIP opens once after it is installed: first steps
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { useWebsite } from '../helpers/web.js';
import { WEB_DIR } from '../helpers/browser.js';

const ctx = useWebsite();
const text = (page, selector) => page.$eval(selector, (el) => el.innerText.replace(/\s+/g, ' ').trim());

test('it says SubPIP is installed and gives three steps, the shortcut among them', async () => {
  const page = await ctx.open('welcome.html');
  assert.equal(await text(page, 'h1'), 'SubPIP is installed');
  const steps = await page.$$eval('.steps li', (items) => items.map((item) => item.querySelector('h3').innerText.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(steps, ['Pin the icon', 'Play a video', 'Press Alt + P']);
  const third = await text(page, '.steps li:nth-child(3)');
  assert.match(third, /Open Picture-in-Picture/);
  assert.match(third, /Option/, 'the key has another name on a Mac');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('it shows a recording of the real window', async () => {
  const page = await ctx.open('welcome.html');
  const clip = await page.$eval('video.clip', (video) => ({
    source: video.querySelector('source').getAttribute('src'),
    poster: video.getAttribute('poster'),
    muted: video.muted,
    label: video.getAttribute('aria-label')
  }));
  assert.equal(clip.source, 'media/demo-captions.mp4');
  assert.equal(clip.poster, 'media/demo-captions.webp');
  assert.equal(clip.muted, true);
  assert.ok(clip.label.length > 20);
  for (const file of [clip.source, clip.poster]) assert.ok(existsSync(path.join(WEB_DIR, file)), file);
  await page.close();
});

test('it names the two ways out when something does not work, in the popup\'s own words', async () => {
  const page = await ctx.open('welcome.html');
  const tips = await text(page, '.welcome-tips');
  const popup = readFileSync('src/popup.html', 'utf8');
  for (const words of ['Captions not showing? Pick them on the page', 'Not working on this site? Tell me']) {
    assert.ok(popup.includes(words), `the popup says "${words}"`);
    assert.ok(tips.includes(words), `the page says "${words}"`);
  }
  await page.close();
});

test('it is kept out of search results and links back to the site', async () => {
  const page = await ctx.open('welcome.html');
  assert.equal(await page.$eval('meta[name="robots"]', (meta) => meta.content), 'noindex');
  assert.equal(await page.$eval('.welcome-tips a[href="index.html#pricing"]', (a) => a.textContent.trim()), 'See Premium');
  await page.close();
});

test('on a phone the steps stack and nothing is cut off', async () => {
  const page = await ctx.open('welcome.html', { width: 390, height: 844 });
  const lefts = await page.$$eval('.steps li', (items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
  assert.equal(new Set(lefts).size, 1, `step positions: ${lefts}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  await page.close();
});
