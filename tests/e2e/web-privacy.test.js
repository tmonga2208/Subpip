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
  assert.match(html, /Last updated: October 8, 2026/);
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
  // The count behind the one-time ask for a rating never leaves the browser
  assert.match(text, /How often you use it[^.]*kept on your computer/);
  // A problem report carries the site's name, and only when it is sent
  assert.match(text, /Problem report[^.]*name of the site/);
  // ...and an email address only if the reporter leaves one
  assert.match(text, /your email address if you choose to leave one, used only to answer you about that report/);
  assert.match(text, /nothing is sent until you press Send/i);
  await page.close();
});

test('the policy says visits to the website are counted, and how', async () => {
  const page = await ctx.open('privacy.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  assert.match(text, /Vercel Web Analytics/);
  assert.match(text, /The counter sets no cookies/);
  // The checkout page does get one, from Razorpay's script
  assert.match(text, /Razorpay's payment script, which sets a cookie/);
  // The address is reported without what a link carried
  assert.match(text, /never the part after "\?"/);
  assert.match(text, /discards it after 24 hours/);
  // The extension is not part of it
  assert.match(text, /The extension itself has no analytics/);
  await page.close();
});

test('privacy questions go to a direct contact', async () => {
  const page = await ctx.open('privacy.html');
  const contact = await page.$eval('article.prose section:last-of-type a', (a) => a.getAttribute('href'));
  assert.equal(contact, 'mailto:tarunmonga2208@gmail.com');
  await page.close();
});

// Translation is part of Premium, so there is no free route for caption text.
// The policy once described one, from the time free users could translate.
test('the policy says who can translate and where the caption text goes, as the extension does it', async () => {
  const page = await ctx.open('privacy.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  assert.doesNotMatch(text, /free users' captions/i);
  assert.match(text, /To translate captions, which is part of Premium/);
  // In this order: on the device, else our server with DeepL, and MyMemory only when that fails
  assert.match(text, /translated on your device and are not sent to anyone/);
  assert.match(text, /captions go to our server[^.]*DeepL/);
  assert.match(text, /If the server can't translate a line, your browser sends that line to MyMemory/);
  assert.match(text, /MyMemory \(Translated\) – translates a caption line when our server could not/);
  await page.close();
});

test('the short answer on the home page agrees with the policy', async () => {
  const page = await ctx.open('index.html');
  const answer = await page.evaluate(() => [...document.querySelectorAll('.accordion-content')].map((el) => el.textContent).find((text) => text.includes('Privacy Policy')));
  assert.match(answer, /translated on your device where Chrome can do it/);
  assert.match(answer, /otherwise their text is sent to a translation service/);
  await page.close();
});
