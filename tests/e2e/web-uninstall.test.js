// The page Chrome opens after SubPIP is uninstalled: one question, anonymous
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, feedbackStub, CHROME_STORE_URL } from '../helpers/web.js';

const ctx = useWebsite();

const state = (page) => page.evaluate(() => ({
  asking: !document.getElementById('feedbackCard').hidden,
  thanked: !document.getElementById('thanksCard').hidden,
  error: document.getElementById('feedbackError').classList.contains('show') ? document.getElementById('feedbackError').textContent : null,
  sendDisabled: document.querySelector('#feedbackForm button[type="submit"]').disabled
}));

test('it asks why, offering six reasons and an optional comment', async () => {
  const page = await ctx.open('uninstalled.html');
  const form = await page.evaluate(() => ({
    reasons: [...document.querySelectorAll('#feedbackForm input[name="reason"]')].map((input) => input.value),
    comment: document.getElementById('comment').tagName,
    chosen: document.querySelectorAll('#feedbackForm input[name="reason"]:checked').length
  }));
  assert.deepEqual(form, { reasons: ['site', 'captions', 'premium', 'done', 'other-tool', 'other'], comment: 'TEXTAREA', chosen: 0 });
  assert.deepEqual(await state(page), { asking: true, thanked: false, error: null, sendDisabled: false });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('sending without a reason asks for one and sends nothing', async () => {
  const seen = [];
  const page = await ctx.open('uninstalled.html', { intercept: feedbackStub(seen) });
  await page.click('#feedbackForm button[type="submit"]');
  assert.equal((await state(page)).error, 'Please pick a reason first.');
  assert.deepEqual(seen, []);
  await page.close();
});

test('the reason, the comment and the version are sent, then it says thanks', async () => {
  const seen = [];
  const page = await ctx.open('uninstalled.html?v=4.2', { intercept: feedbackStub(seen) });
  await page.click('input[name="reason"][value="site"]');
  await page.type('#comment', 'No captions on Prime Video');
  await page.click('#feedbackForm button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('thanksCard').hidden);
  assert.deepEqual(seen, [{ reason: 'site', comment: 'No captions on Prime Video', version: '4.2' }]);
  assert.equal((await state(page)).asking, false);
  assert.equal(await page.$eval('#thanksCard a.btn', (a) => a.getAttribute('href')), CHROME_STORE_URL);
  await page.close();
});

test('if it cannot be sent, the form stays with a message and can be sent again', async () => {
  const page = await ctx.open('uninstalled.html', { intercept: feedbackStub([], { ok: false }) });
  await page.click('input[name="reason"][value="other"]');
  await page.click('#feedbackForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('feedbackError').classList.contains('show'));
  assert.deepEqual(await state(page), { asking: true, thanked: false, error: 'That did not go through. Please try again.', sendDisabled: false });
  await page.close();
});

test('the reasons are easy to tap on a phone', async () => {
  const page = await ctx.open('uninstalled.html', { width: 390, height: 844 });
  const heights = await page.$$eval('#feedbackForm .reason', (labels) => labels.map((label) => Math.round(label.getBoundingClientRect().height)));
  assert.equal(heights.length, 6);
  assert.ok(heights.every((height) => height >= 40), `row heights: ${heights}`);
  await page.close();
});
