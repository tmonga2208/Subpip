import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, CHROME_STORE_URL } from '../helpers/web.js';

const ctx = useWebsite();

test('sections appear in the spec order', async () => {
  const page = await ctx.open('index.html');
  const ids = await page.$$eval('main > section', (sections) => sections.map((s) => s.id));
  assert.deepEqual(ids, ['hero', 'sites', 'features', 'how', 'pricing', 'faq']);
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
  assert.deepEqual(counts.sites, ['YouTube', 'Netflix', 'Disney+ Hotstar', 'JioCinema', 'Crunchyroll', 'Any site with built-in captions']);
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
