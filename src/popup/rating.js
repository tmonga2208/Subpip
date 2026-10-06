// The one-time ask for a store rating, on the first page under the main button

import { ratingState, shouldAskForRating, noteAskShown, endRatingAsk } from '../shared/rating.js';
import { storeFor } from '../shared/store.js';

export async function initRatingAsk({ doc }) {
  const { reviewsUrl } = storeFor(navigator.userAgent);
  if (!reviewsUrl || !shouldAskForRating(await ratingState())) return;
  const ask = doc.getElementById('rate-ask');
  ask.hidden = false;
  await noteAskShown();

  const end = async () => {
    ask.hidden = true;
    await endRatingAsk();
  };
  doc.getElementById('rate-no').addEventListener('click', end);
  doc.getElementById('rate-yes').addEventListener('click', async () => {
    await end();
    await chrome.tabs.create({ url: reviewsUrl });
  });
}
