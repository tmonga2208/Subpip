import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { openPip, pipEval } from '../helpers/pip.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const pressed = (popup) => popup.$$eval('.chip[aria-pressed="true"]', (chips) => chips.map((c) => c.dataset.preset));
const previewFont = (popup, id = 'home-preview') => popup.$eval(`#${id} .preview-caption`, (el) => el.style.fontSize);
const setRange = (popup, id, values) => popup.evaluate((rangeId, list) => {
  const input = document.getElementById(rangeId);
  for (const value of list) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, id, values);

test('preview and chips reflect stored settings', async () => {
  await ctx.setSettings({ fontSize: 30, captionPreset: 'custom' });
  const popup = await ctx.openPopup();
  assert.equal(await previewFont(popup), '30px');
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.close();
});

test('choosing a preset applies and saves it at once', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="large"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.equal(saved.captionPreset, 'large');
  assert.equal(saved.fontSize, 26);
  assert.deepEqual(await pressed(popup), ['large']);
  assert.equal(await previewFont(popup), '26px');
  await popup.close();
});

test('Custom opens its page; a fast slider drag saves only the final value', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'Custom style');
  await setRange(popup, 'size', [20, 22, 25, 28, 31, 33]);
  assert.equal(await previewFont(popup, 'custom-preview'), '33px');
  assert.equal((await ctx.storage()).subpipSettings, undefined);
  await sleep(500);
  const saved = (await ctx.storage()).subpipSettings;
  assert.equal(saved.fontSize, 33);
  assert.equal(saved.captionPreset, 'custom');
  await popup.keyboard.press('Escape');
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.close();
});

test('closing the popup mid-drag still saves the last value', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  await setRange(popup, 'opacity', [40, 45, 50]);
  await popup.close();
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.bgOpacity, 50);
});

test('swatches, font, outline and position save instantly', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  await popup.click('#text-swatches .swatch[data-color="#ffe14d"]');
  await popup.select('#font', 'serif');
  await popup.click('#outline');
  await popup.click('[data-position="top"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.deepEqual(
    { textColor: saved.textColor, fontFamily: saved.fontFamily, captionOutline: saved.captionOutline, captionPosition: saved.captionPosition, captionPreset: saved.captionPreset },
    { textColor: '#ffe14d', fontFamily: 'serif', captionOutline: true, captionPosition: 'top', captionPreset: 'custom' }
  );
  assert.equal(await popup.$eval('#custom-preview', (el) => el.dataset.position), 'top');
  await popup.close();
});

test('subtitle URL is a Premium field for free users', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  const field = await popup.evaluate(() => ({ disabled: document.getElementById('subs-url').disabled, tag: !document.getElementById('subs-tag').hidden }));
  assert.deepEqual(field, { disabled: true, tag: true });
  await popup.close();
});

test('subtitle URL is editable for premium users', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => !document.getElementById('subs-url').disabled);
  await popup.click('.chip[data-preset="custom"]');
  await popup.type('#subs-url', 'https://example.com/a.vtt');
  await sleep(500);
  assert.equal((await ctx.storage()).subpipSettings.externalSubtitleUrl, 'https://example.com/a.vtt');
  await popup.close();
});

test('changes reach an open PiP window live', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const tabId = await ctx.tabIdFor(page.url());
  await ctx.worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['translate-relay.js'] }), tabId);
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="large"]');
  await page.waitForFunction(() => window.__SUBPIP_SETTINGS__?.fontSize === 26, { timeout: 3000 });
  assert.match(await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent), /font-size: 26px/);
  await popup.close();
  await page.close();
});

test('old settings show as Custom and lose their stale isPremium on save', async () => {
  await ctx.setSettings({ fontSize: 22, isPremium: true });
  const popup = await ctx.openPopup();
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.click('.chip[data-preset="classic"]');
  await sleep(100);
  assert.equal('isPremium' in (await ctx.storage()).subpipSettings, false);
  await popup.close();
});

test('the preview wraps big captions instead of cutting them off', async () => {
  await ctx.setSettings({ fontSize: 40, captionPreset: 'custom' });
  const popup = await ctx.openPopup();
  const fit = await popup.evaluate(() => {
    const preview = document.getElementById('home-preview');
    const caption = preview.querySelector('.preview-caption');
    const box = preview.getBoundingClientRect();
    const cap = caption.getBoundingClientRect();
    return {
      truncated: caption.scrollWidth > caption.clientWidth,
      inside: cap.top >= box.top && cap.bottom <= box.bottom && cap.left >= box.left && cap.right <= box.right
    };
  });
  assert.deepEqual(fit, { truncated: false, inside: true });
  await popup.close();
});
