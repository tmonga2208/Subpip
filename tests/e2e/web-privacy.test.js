import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useWebsite } from '../helpers/web.js';
import { WEB_DIR } from '../helpers/browser.js';

const ctx = useWebsite();

test('privacy policy uses the shared layout', async () => {
  const page = await ctx.open('privacy.html');
  const info = await page.evaluate(() => ({
    header: !!document.querySelector('.site-header .brand'),
    footer: !!document.querySelector('.site-footer'),
    prose: !!document.querySelector('article.prose'),
    inlineStyles: document.querySelectorAll('main [style]').length
  }));
  assert.deepEqual(info, { header: true, footer: true, prose: true, inlineStyles: 0 });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the policy has a fixed revision date, not today\'s date', async () => {
  const html = await readFile(`${WEB_DIR}/privacy.html`, 'utf8');
  assert.match(html, /Last updated: October 4, 2026/);
  assert.doesNotMatch(html, /toLocaleDateString/);
});

test('the policy describes what the extension does today', async () => {
  const page = await ctx.open('privacy.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  // Permissions actually requested
  for (const permission of ['activeTab', 'scripting', 'storage']) assert.match(text, new RegExp(permission), permission);
  assert.match(text, /Auto PiP/);
  assert.match(text, /optional/i);
  assert.doesNotMatch(text, /\btabs\b –|\bwindows\b –/, 'tabs/windows permissions are no longer used');
  // Services that receive data
  for (const service of ['Firebase', 'Vercel', 'MyMemory', 'Razorpay']) assert.match(text, new RegExp(service), service);
  assert.doesNotMatch(text, /Google Cloud Translation/);
  assert.match(text, /DeepL/);
  // Email goes through Resend now, not Gmail
  assert.match(text, /Resend/);
  assert.doesNotMatch(text, /Google \(Gmail\)/);
  // What the newer features keep, and where
  assert.match(text, /Captions from speech[^.]*on your device/);
  assert.match(text, /Saved lines[^.]*on your computer/i);
  assert.match(text, /Captions you picked on a site/);
  assert.match(text, /which sites Auto PiP is on for/);
  assert.doesNotMatch(text, /device identifier/i);
  assert.match(text, /cache/i);
  // Regional pricing reads the time zone locally
  assert.match(text, /time zone/i);
  await page.close();
});

test('privacy questions go to a direct contact', async () => {
  const page = await ctx.open('privacy.html');
  const contact = await page.$eval('article.prose section:last-of-type a', (a) => a.getAttribute('href'));
  assert.equal(contact, 'mailto:tarunmonga2208@gmail.com');
  await page.close();
});
