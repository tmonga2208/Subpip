// Premium prices (smallest unit: paise / cents), by currency, price level and
// plan. India pays in rupees. Elsewhere it is dollars, at a lower level for
// the countries where $15 is a lot (the site decides which, by time zone).
// Lifetime never ends; "year" is one year from the purchase, not renewed by
// itself. A captured payment must match one of these to buy anything.
export const PLAN_PRICES = {
  INR: { standard: { lifetime: 99900, year: 39900 } },      // ₹999, ₹399
  USD: {
    standard: { lifetime: 1500, year: 600 },                 // $15, $6
    low: { lifetime: 700, year: 300 }                        // $7, $3
  }
};
// The standard lifetime price per currency, as it was before plans
export const PRICES = { INR: PLAN_PRICES.INR.standard.lifetime, USD: PLAN_PRICES.USD.standard.lifetime };
export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// What an order costs, or null for a plan or level that does not exist. A
// currency with one level charges it whichever level is asked for.
export function priceFor({ currency, plan = 'lifetime', tier = 'standard' } = {}) {
  const levels = Object.hasOwn(PLAN_PRICES, currency || '') ? PLAN_PRICES[currency] : null;
  if (!levels || !['standard', 'low'].includes(tier) || !['lifetime', 'year'].includes(plan)) return null;
  return (levels[tier] || levels.standard)[plan];
}

// The plan a payment bought: its amount is one of the listed prices, or more
// than the highest (a checkout opened before a price went down). null buys nothing.
export function planOfPayment(payment) {
  const levels = Object.hasOwn(PLAN_PRICES, payment.currency || '') ? PLAN_PRICES[payment.currency] : null;
  if (!levels) return null;
  for (const prices of Object.values(levels)) {
    for (const [plan, amount] of Object.entries(prices)) if (payment.amount === amount) return plan;
  }
  return payment.amount > PRICES[payment.currency] ? 'lifetime' : null;
}

export function isAcceptedPayment(payment, { requireFullPrice = true } = {}) {
  if (!Object.hasOwn(PLAN_PRICES, payment.currency || '')) return false;
  return !requireFullPrice || planOfPayment(payment) !== null;
}
