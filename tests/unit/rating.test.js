// The one-time ask for a store rating: when it is due, and the count behind it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RATING, shouldAskForRating, ratingState, noteWindowOpened, noteAskShown, endRatingAsk } from '../../src/shared/rating.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const used = (extra = {}) => ({ opens: 10, since: NOW - 3 * DAY, ...extra });

// What is saved on this computer
function browserWith(saved = {}) {
  const local = { ...saved };
  globalThis.chrome = { storage: { local: {
    get: async (keys) => Object.fromEntries([].concat(keys).filter((key) => key in local).map((key) => [key, local[key]])),
    set: async (items) => { Object.assign(local, items); }
  } } };
  return local;
}

test('the ask is due after ten opens and three days, not before', () => {
  assert.equal(shouldAskForRating(used(), NOW), true);
  assert.equal(shouldAskForRating(used({ opens: 9 }), NOW), false);
  assert.equal(shouldAskForRating(used({ since: NOW - 3 * DAY + 1 }), NOW), false);
  assert.equal(shouldAskForRating({ opens: 50 }, NOW), false, 'no first day on record');
  assert.equal(shouldAskForRating({}, NOW), false);
  assert.equal(shouldAskForRating(undefined, NOW), false);
});

test('it is shown on three popup opens at most, and never once it was answered', () => {
  assert.equal(shouldAskForRating(used({ shown: 2 }), NOW), true);
  assert.equal(shouldAskForRating(used({ shown: 3 }), NOW), false);
  assert.equal(shouldAskForRating(used({ done: true }), NOW), false);
});

test('each opened window is counted, and the day of the first one is kept', async () => {
  const local = browserWith();
  assert.deepEqual(await ratingState(), {});
  await noteWindowOpened(NOW);
  await noteWindowOpened(NOW + DAY);
  assert.deepEqual(local[RATING], { opens: 2, since: NOW });
});

test('showing the ask and answering it are remembered beside the count', async () => {
  const local = browserWith({ [RATING]: { opens: 12, since: NOW - 5 * DAY } });
  await noteAskShown();
  await noteAskShown();
  assert.deepEqual(local[RATING], { opens: 12, since: NOW - 5 * DAY, shown: 2 });
  await endRatingAsk();
  assert.deepEqual(local[RATING], { opens: 12, since: NOW - 5 * DAY, shown: 2, done: true });
  assert.equal(shouldAskForRating(await ratingState(), NOW), false);
});
