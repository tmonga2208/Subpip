// The page the popup's "Not working on this site?" opens: what went wrong,
// and on which site. Anonymous, and nothing is sent before Send is pressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, feedbackStub } from '../helpers/web.js';

const ctx = useWebsite();
const FROM_POPUP = 'report.html#site=netflix.com&v=4.5';

const state = (page) => page.evaluate(() => ({
  asking: !document.getElementById('reportCard').hidden,
  thanked: !document.getElementById('thanksCard').hidden,
  error: document.getElementById('reportError').classList.contains('show') ? document.getElementById('reportError').textContent : null,
  sendDisabled: document.querySelector('#reportForm button[type="submit"]').disabled
}));
const send = (page) => page.click('#reportForm button[type="submit"]');
const thanked = (page) => page.waitForFunction(() => !document.getElementById('thanksCard').hidden);

test('it opens with the site the popup named, asks what went wrong, and has sent nothing', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  const form = await page.evaluate(() => ({
    site: document.getElementById('site').value,
    problems: [...document.querySelectorAll('#reportForm input[name="problem"]')].map((input) => input.value),
    chosen: document.querySelectorAll('#reportForm input[name="problem"]:checked').length,
    comment: document.getElementById('comment').tagName
  }));
  assert.deepEqual(form, { site: 'netflix.com', problems: ['captions', 'window', 'controls', 'other'], chosen: 0, comment: 'TEXTAREA' });
  assert.deepEqual(await state(page), { asking: true, thanked: false, error: null, sendDisabled: false });
  assert.deepEqual(seen, []);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('it says what will be sent, and that nothing goes before Send', async () => {
  const page = await ctx.open(FROM_POPUP);
  const note = await page.$eval('#reportCard .agree', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  assert.match(note, /the site's name, your choice, your comment and the SubPIP version/);
  assert.match(note, /Nothing is sent until you press Send/);
  await page.close();
});

test('the choice, the site, the comment and the version are sent, then it says thanks', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  await page.click('input[name="problem"][value="captions"]');
  await page.type('#comment', 'No subtitles in the window');
  await send(page);
  await thanked(page);
  assert.deepEqual(seen, [{ kind: 'problem', problem: 'captions', site: 'netflix.com', comment: 'No subtitles in the window', version: '4.5' }]);
  assert.equal((await state(page)).asking, false);
  await page.close();
});

test('the site can be changed or cleared before sending', async () => {
  const seen = [];
  let page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  await page.$eval('#site', (input) => { input.value = ''; });
  await page.type('#site', 'primevideo.com');
  await page.click('input[name="problem"][value="window"]');
  await send(page);
  await thanked(page);
  await page.close();

  page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  await page.$eval('#site', (input) => { input.value = ''; });
  await page.click('input[name="problem"][value="other"]');
  await send(page);
  await thanked(page);
  await page.close();
  assert.deepEqual(seen.map((sent) => sent.site), ['primevideo.com', '']);
});

test('opened without a site, the box is empty and the report still goes', async () => {
  const seen = [];
  const page = await ctx.open('report.html', { intercept: feedbackStub(seen) });
  assert.equal(await page.$eval('#site', (input) => input.value), '');
  await page.click('input[name="problem"][value="controls"]');
  await send(page);
  await thanked(page);
  assert.deepEqual(seen, [{ kind: 'problem', problem: 'controls', site: '', comment: '', version: '' }]);
  await page.close();
});

test('sending without saying what went wrong asks for it and sends nothing', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  await send(page);
  assert.equal((await state(page)).error, 'Please choose what went wrong first.');
  assert.deepEqual(seen, []);
  await page.close();
});

test('if it cannot be sent, the form stays with a message and can be sent again', async () => {
  const page = await ctx.open(FROM_POPUP, { intercept: feedbackStub([], { ok: false }) });
  await page.click('input[name="problem"][value="other"]');
  await send(page);
  await page.waitForFunction(() => document.getElementById('reportError').classList.contains('show'));
  assert.deepEqual(await state(page), { asking: true, thanked: false, error: 'That did not go through. Please try again.', sendDisabled: false });
  await page.close();
});

test('the choices are easy to tap on a phone', async () => {
  const page = await ctx.open(FROM_POPUP, { width: 390, height: 844 });
  const heights = await page.$$eval('#reportForm .reason', (labels) => labels.map((label) => Math.round(label.getBoundingClientRect().height)));
  assert.equal(heights.length, 4);
  assert.ok(heights.every((height) => height >= 40), `row heights: ${heights}`);
  await page.close();
});

test('an email is asked for as optional, and is sent only when one is given', async () => {
  const seen = [];
  const page = await ctx.open(FROM_POPUP, { intercept: feedbackStub(seen) });
  assert.match(await page.$eval('label[for="email"]', (el) => el.textContent.replace(/\s+/g, ' ').trim()), /^Your email \(optional/);
  assert.equal(await page.$eval('#email', (el) => el.required), false);
  await page.click('input[name="problem"][value="captions"]');
  await page.type('#email', 'viewer@example.com');
  await send(page);
  await thanked(page);
  assert.deepEqual(seen, [{ kind: 'problem', problem: 'captions', site: 'netflix.com', comment: '', version: '4.5', email: 'viewer@example.com' }]);
  await page.close();
});

test('the note says the email is only for an answer about this report', async () => {
  const page = await ctx.open(FROM_POPUP);
  const note = await page.$eval('#reportCard .agree', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  assert.match(note, /If you leave your email, it is used only to answer you about this report/);
  await page.close();
});
