// Premium price per currency (smallest unit: paise / cents). The website
// charges ₹1000 in India and $15 elsewhere; any captured payment must match.
export const PRICES = {
  INR: 100000, // ₹1000
  USD: 1500    // $15
};

export function isAcceptedPayment(payment, { requireFullPrice = true } = {}) {
  const price = PRICES[payment.currency];
  if (!price) return false;
  return !requireFullPrice || payment.amount >= price;
}
