// The store this copy came from, by browser. The same package is listed on
// the Chrome Web Store and on Edge Add-ons.
import { STORE_REVIEWS_URL } from './firebase.js';

// reviewsUrl: where a rating is left; null while that store has no listing to
// point at
export function storeFor(userAgent) {
  if (/\bEdg\//.test(userAgent || '')) return { name: 'Edge Add-ons', reviewsUrl: null };
  return { name: 'Chrome Web Store', reviewsUrl: STORE_REVIEWS_URL };
}
