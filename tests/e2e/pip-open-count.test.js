// How often the window has been opened is counted on this computer, for the
// one-time ask for a rating. The count has to see every way of opening it, so
// these go through the extension's own path (see shortcutViaAction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension({ shortcutViaAction: true });

const pipOpens = (page) => page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('video'), { timeout: 5000 });
const pipCloses = (page) => page.waitForFunction(() => !window.documentPictureInPicture.window, { timeout: 5000 });
const saved = () => ctx.worker.evaluate(async () => (await chrome.storage.local.get('subpipRating')).subpipRating);
async function countBecomes(opens) {
  for (let i = 0; i < 40 && (await saved())?.opens !== opens; i++) await sleep(50);
  return saved();
}

test('every opened window is counted once, with the day of the first', async () => {
  const before = Date.now();
  const page = await ctx.newPage('generic.html');
  assert.equal(await saved(), undefined);
  await ctx.pressShortcut(page);
  await pipOpens(page);
  const first = await countBecomes(1);
  assert.equal(first.opens, 1);
  assert.ok(first.since >= before && first.since <= Date.now());

  await ctx.pressShortcut(page);
  await pipCloses(page);
  await ctx.pressShortcut(page);
  await pipOpens(page);
  assert.deepEqual(await countBecomes(2), { opens: 2, since: first.since });
  // Nothing more is added while the window just stays open
  await sleep(400);
  assert.equal((await saved()).opens, 2);
  await page.close();
});
