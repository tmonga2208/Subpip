// The one-time ask for a rating on the Chrome Web Store. How often the window
// has been opened, and since when, is kept on this computer only and decides
// when the popup asks. Everyone gets the same question, whatever they think of
// SubPIP. It ends with either answer, or once it has been shown three times.

export const RATING = 'subpipRating';
const OPENS_BEFORE_ASKING = 10;
const DAYS_BEFORE_ASKING = 3;
const TIMES_SHOWN = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// state: { opens, since, shown, done }
export function shouldAskForRating(state, now = Date.now()) {
  if (!state || state.done || (state.shown || 0) >= TIMES_SHOWN) return false;
  return (state.opens || 0) >= OPENS_BEFORE_ASKING && typeof state.since === 'number' && now - state.since >= DAYS_BEFORE_ASKING * DAY_MS;
}

export async function ratingState() {
  return (await chrome.storage.local.get([RATING]))[RATING] || {};
}

async function save(change) {
  const state = await ratingState();
  await chrome.storage.local.set({ [RATING]: { ...state, ...change(state) } });
}

export const noteWindowOpened = (now = Date.now()) => save((state) => ({ opens: (state.opens || 0) + 1, since: state.since || now }));
export const noteAskShown = () => save((state) => ({ shown: (state.shown || 0) + 1 }));
export const endRatingAsk = () => save(() => ({ done: true }));
