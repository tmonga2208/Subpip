// The one-time ask for a rating on the Chrome Web Store, on the popup's first
// page. Everyone gets the same words; either answer ends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension();
const DAY = 24 * 60 * 60 * 1000;
const REVIEWS = 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg/reviews';

const seed = (state) => ctx.worker.evaluate((value) => chrome.storage.local.set({ subpipRating: value }), state);
const saved = () => ctx.worker.evaluate(async () => (await chrome.storage.local.get('subpipRating')).subpipRating);
const longTimeUser = () => seed({ opens: 10, since: Date.now() - 4 * DAY });
const ask = (popup) => popup.$eval('#rate-ask', (el) => ({
  shown: !el.hidden,
  text: el.querySelector('p').textContent.trim(),
  buttons: [...el.querySelectorAll('button')].map((button) => button.textContent.trim())
}));

test('after ten opens and three days the popup asks once for a rating', async () => {
  await longTimeUser();
  const popup = await ctx.openPopup();
  assert.deepEqual(await ask(popup), {
    shown: true,
    text: 'Finding SubPIP useful? A rating on the Chrome Web Store helps others find it.',
    buttons: ['Rate SubPIP', 'No thanks']
  });
  assert.equal((await saved()).shown, 1);
  assert.deepEqual(popup.errors, []);
  await popup.close();
});

test('before that it stays out of the way', async () => {
  for (const state of [undefined, { opens: 9, since: Date.now() - 30 * DAY }, { opens: 40, since: Date.now() - DAY }]) {
    if (state) await seed(state);
    const popup = await ctx.openPopup();
    assert.equal((await ask(popup)).shown, false, JSON.stringify(state));
    await popup.close();
  }
});

test('No thanks ends it for good', async () => {
  await longTimeUser();
  let popup = await ctx.openPopup();
  await popup.click('#rate-no');
  await popup.waitForFunction(() => document.getElementById('rate-ask').hidden);
  assert.equal((await saved()).done, true);
  await popup.close();
  popup = await ctx.openPopup();
  assert.equal((await ask(popup)).shown, false);
  await popup.close();
});

test('Rate SubPIP opens the store\'s reviews page, and ends it too', async () => {
  await longTimeUser();
  const popup = await ctx.openPopup();
  await popup.evaluate(() => {
    window.openedTabs = [];
    chrome.tabs.create = async ({ url }) => { window.openedTabs.push(url); };
  });
  await popup.click('#rate-yes');
  await popup.waitForFunction(() => window.openedTabs.length > 0, { timeout: 8000 });
  assert.deepEqual(await popup.evaluate(() => window.openedTabs), [REVIEWS]);
  assert.equal((await saved()).done, true);
  assert.equal((await ask(popup)).shown, false);
  await popup.close();
});

test('left unanswered it shows on three popup opens, then stops', async () => {
  await longTimeUser();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const popup = await ctx.openPopup();
    seen.push((await ask(popup)).shown);
    await popup.close();
  }
  assert.deepEqual(seen, [true, true, true, false]);
});

test('it is in view without scrolling, so being shown means being seen', async () => {
  await longTimeUser();
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  await popup.setViewport({ width: 360, height: 600 });
  const box = await popup.$eval('#rate-ask', (el) => {
    const rect = el.getBoundingClientRect();
    const views = document.querySelector('.views').getBoundingClientRect();
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewBottom: Math.round(views.bottom) };
  });
  assert.ok(box.top > 0 && box.bottom <= Math.min(600, box.viewBottom), JSON.stringify(box));
  await popup.close();
  await page.close();
});
