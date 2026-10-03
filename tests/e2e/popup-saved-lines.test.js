// Lines saved from the study tools: kept by the relay, listed in the popup,
// exported and cleared there
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

async function premiumPopup() {
  await ctx.signInAs();
  return ctx.openPopup({ stub: firebaseStub({ premium: true }) });
}
const stored = () => ctx.worker.evaluate(async () => (await chrome.storage.local.get('subpipSavedLines')).subpipSavedLines || []);
const TWO_LINES = [
  { text: 'second line', translation: 'segunda línea', word: 'second', meaning: 'segunda', title: 'A film', url: 'https://example.com/a', savedAt: Date.UTC(2026, 9, 4) },
  { text: 'first line', translation: 'primera línea', word: '', meaning: '', title: 'A film', url: 'https://example.com/a', savedAt: Date.UTC(2026, 9, 3) }
];
const list = (popup) => popup.evaluate(() => [...document.querySelectorAll('#saved-list .saved-item')].map((item) => ({
  text: item.querySelector('.saved-text').textContent,
  translation: item.querySelector('.saved-translation').textContent,
  word: item.querySelector('.saved-word')?.textContent ?? null
})));

test('saved lines are counted on the home page and listed newest first', async () => {
  await ctx.worker.evaluate((lines) => chrome.storage.local.set({ subpipSavedLines: lines }), TWO_LINES);
  const page = await ctx.newPage('generic.html');
  const popup = await premiumPopup();
  assert.equal(await popup.$eval('#saved-value', (el) => el.textContent), '2');
  await popup.click('.row[data-go="saved"]');
  assert.deepEqual(await list(popup), [
    { text: 'second line', translation: 'segunda línea', word: 'second: segunda' },
    { text: 'first line', translation: 'primera línea', word: null }
  ]);
  assert.equal(await popup.$eval('#saved-empty', (el) => el.hidden), true);
  await popup.close();
  await page.close();
});

test('Clear all empties the list and the storage', async () => {
  await ctx.worker.evaluate((lines) => chrome.storage.local.set({ subpipSavedLines: lines }), TWO_LINES);
  const page = await ctx.newPage('generic.html');
  const popup = await premiumPopup();
  await popup.click('.row[data-go="saved"]');
  await popup.click('#saved-clear');
  await popup.waitForFunction(() => document.querySelectorAll('#saved-list .saved-item').length === 0);
  assert.deepEqual(await stored(), []);
  assert.equal(await popup.$eval('#saved-empty', (el) => el.hidden), false);
  assert.equal(await popup.$eval('#saved-export', (el) => el.disabled), true);
  await popup.close();
  await page.close();
});

test('Export gives a CSV file with every line', async () => {
  await ctx.worker.evaluate((lines) => chrome.storage.local.set({ subpipSavedLines: lines }), TWO_LINES);
  const page = await ctx.newPage('generic.html');
  const popup = await premiumPopup();
  await popup.click('.row[data-go="saved"]');
  await popup.evaluate(() => {
    window.downloads = [];
    URL.createObjectURL = (blob) => { window.exported = blob; return 'blob:exported'; };
    HTMLAnchorElement.prototype.click = function click() { window.downloads.push(this.download); };
  });
  await popup.click('#saved-export');
  await popup.waitForFunction(() => window.downloads.length === 1);
  const file = await popup.evaluate(async () => ({ name: window.downloads[0], type: window.exported.type, text: await window.exported.text() }));
  assert.equal(file.name, 'subpip-lines.csv');
  assert.match(file.type, /^text\/csv/);
  assert.deepEqual(file.text.replace(/^\uFEFF/, '').split('\r\n').slice(0, 2), [
    'Line,Translation,Word,Meaning,Title,Page,Saved',
    'second line,segunda línea,second,segunda,A film,https://example.com/a,2026-10-04'
  ]);
  await popup.close();
  await page.close();
});

test('without Premium the row leads to the upgrade page', async () => {
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  assert.equal(await popup.$eval('#saved-value', (el) => el.textContent), 'Premium');
  await popup.click('.row[data-go="saved"]');
  assert.equal(await popup.$eval('.view[data-view="upgrade"]', (el) => el.hidden), false);
  await popup.close();
  await page.close();
});

test('a line saved in the window is kept, with the page it came from', async () => {
  const page = await ctx.newPage('generic.html');
  const popup = await premiumPopup();
  await popup.evaluate(() => { window.close = () => {}; });
  await popup.click('#pip-btn');
  await page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('video'), { timeout: 6000 });
  await popup.close();
  // What the study tools post when Save line is pressed; the page is not trusted with more than the line
  await page.evaluate(() => window.postMessage({ type: 'SUBPIP_SAVE_LINE', line: { text: 'kept line', translation: 'línea guardada', word: 'kept', meaning: 'guardada', title: 'forged', url: 'https://forged.example/' } }, '*'));
  for (let i = 0; i < 40 && !(await stored()).length; i++) await sleep(100);
  const [line] = await stored();
  assert.deepEqual(
    { text: line.text, translation: line.translation, word: line.word, meaning: line.meaning, title: line.title, url: line.url },
    { text: 'kept line', translation: 'línea guardada', word: 'kept', meaning: 'guardada', title: 'generic', url: `http://127.0.0.1:${ctx.server.port}/generic.html` }
  );
  await page.close();
});
