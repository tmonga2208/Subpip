// Premium price by region: ₹999 in India, $15 everywhere else. The server
// (functions/pricing.js) checks the charged amount; this is for display.

export const REGIONAL_PRICES = {
  INR: { currency: 'INR', amount: 99900, label: '₹999' },
  USD: { currency: 'USD', amount: 1500, label: '$15' }
};

const INDIA_TIME_ZONES = ['Asia/Kolkata', 'Asia/Calcutta'];

export function defaultCurrency(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return INDIA_TIME_ZONES.includes(timeZone) ? 'INR' : 'USD';
}

export function localPrice(timeZone) {
  return REGIONAL_PRICES[defaultCurrency(timeZone)];
}
