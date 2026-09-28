import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useWebsite } from '../helpers/web.js';

const ctx = useWebsite();

test('privacy policy uses the shared layout and keeps all nine sections', async () => {
  const page = await ctx.open('privacy.html');
  const info = await page.evaluate(() => ({
    header: !!document.querySelector('.site-header .brand'),
    footer: !!document.querySelector('.site-footer'),
    prose: !!document.querySelector('article.prose'),
    headings: [...document.querySelectorAll('.prose h2')].map((h) => h.textContent.trim().split('.')[0]),
    date: document.getElementById('privacyDate').textContent.length > 0,
    inlineStyles: document.querySelectorAll('main [style]').length
  }));
  assert.deepEqual(info, { header: true, footer: true, prose: true, headings: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], date: true, inlineStyles: 0 });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('policy wording is unchanged', async () => {
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const page = await ctx.open('privacy.html');
  const body = text(await page.$eval('article.prose', (el) => el.innerHTML));
  const original = await readFile(new URL('./privacy-wording.txt', import.meta.url), 'utf8');
  for (const sentence of original.trim().split('\n')) assert.ok(body.includes(sentence), `missing: ${sentence}`);
  await page.close();
});
