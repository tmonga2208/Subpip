// What search engines and link previews are given: one line about every
// public page, preview tags, a share image, a sitemap and robots.txt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://subpip.online';
const pages = readdirSync('web').filter((file) => file.endsWith('.html')).map((file) => ({ file, html: readFileSync(path.join('web', file), 'utf8') }));
const hidden = ({ html }) => html.includes('<meta name="robots" content="noindex">');
const publicPages = pages.filter((page) => !hidden(page));
const address = (file) => `${SITE}/${file === 'index.html' ? '' : file}`;
const meta = (html, attribute, name) => (html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)">`)) || [])[1];

test('seven pages are public; the three that only make sense coming from the extension stay out of search', () => {
  assert.deepEqual(publicPages.map(({ file }) => file).sort(), ['contact.html', 'delivery.html', 'index.html', 'premium.html', 'privacy.html', 'refund.html', 'terms.html']);
  assert.deepEqual(pages.filter(hidden).map(({ file }) => file).sort(), ['report.html', 'uninstalled.html', 'welcome.html']);
});

test('every public page says what it is in one line, and no two say the same', () => {
  for (const { file, html } of publicPages) {
    const description = meta(html, 'name', 'description') || '';
    assert.ok(description.length >= 40 && description.length <= 160, `${file}: ${description.length} characters`);
  }
  assert.equal(new Set(publicPages.map(({ html }) => meta(html, 'name', 'description'))).size, publicPages.length);
});

test('a link to any public page previews with its title, its line and the share image', () => {
  for (const { file, html } of publicPages) {
    assert.equal(meta(html, 'property', 'og:title'), html.match(/<title>([^<]*)<\/title>/)[1], file);
    assert.equal(meta(html, 'property', 'og:description'), meta(html, 'name', 'description'), file);
    assert.equal(meta(html, 'property', 'og:url'), address(file), file);
    assert.equal(meta(html, 'property', 'og:type'), 'website', file);
    assert.equal(meta(html, 'property', 'og:site_name'), 'SubPIP', file);
    assert.equal(meta(html, 'property', 'og:image'), `${SITE}/media/share.jpg`, file);
    assert.equal(meta(html, 'property', 'og:image:width'), '1200', file);
    assert.equal(meta(html, 'property', 'og:image:height'), '630', file);
    assert.ok((meta(html, 'property', 'og:image:alt') || '').length > 20, file);
    assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image', file);
  }
});

test('the share image is a 1200 by 630 JPEG, light enough to load at once', () => {
  const image = readFileSync('web/media/share.jpg');
  assert.deepEqual([image[0], image[1]], [0xff, 0xd8], 'a JPEG');
  // The frame header (a marker FFC0 to FFCF, but not C4, C8 or CC) carries the size
  let at = 2;
  let size = null;
  while (at < image.length && !size) {
    const marker = image[at + 1];
    const length = image.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) size = { width: image.readUInt16BE(at + 7), height: image.readUInt16BE(at + 5) };
    at += 2 + length;
  }
  assert.deepEqual(size, { width: 1200, height: 630 });
  assert.ok(image.length < 300 * 1024, `${image.length} bytes`);
});

test('the sitemap lists the public pages and nothing else', () => {
  const xml = readFileSync('web/sitemap.xml', 'utf8');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual([...listed].sort(), publicPages.map(({ file }) => address(file)).sort());
  assert.equal(listed[0], `${SITE}/`, 'the home page comes first');
});

test('robots.txt lets search engines read the site, keeps them out of the API and names the sitemap', () => {
  const robots = readFileSync('web/robots.txt', 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/subpip\.online\/sitemap\.xml$/m);
  // A page marked noindex has to stay readable, or the mark is never seen
  for (const { file } of pages.filter(hidden)) assert.ok(!robots.includes(file), file);
});
