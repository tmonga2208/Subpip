// Premium price per currency (smallest unit: paise / cents). The website
// charges ₹999 in India and $15 elsewhere; any captured payment must match.
export const PRICES = {
  INR: 99900, // ₹999
  USD: 1500    // $15
};

export function isAcceptedPayment(payment, { requireFullPrice = true } = {}) {
  const price = PRICES[payment.currency];
  if (!price) return false;
  return !requireFullPrice || payment.amount >= price;
}
