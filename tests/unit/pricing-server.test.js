// Server-side price check for captured Razorpay payments
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES, isAcceptedPayment } from '../../web/api/_lib/pricing.js';

test('two regional prices: ₹1000 and $15', () => {
  assert.deepEqual(PRICES, { INR: 100000, USD: 1500 });
});

test('full-price payments in either currency are accepted', () => {
  assert.equal(isAcceptedPayment({ currency: 'INR', amount: 100000 }), true);
  assert.equal(isAcceptedPayment({ currency: 'USD', amount: 1500 }), true);
});

test('underpaying is rejected in each currency', () => {
  assert.equal(isAcceptedPayment({ currency: 'INR', amount: 99999 }), false);
  assert.equal(isAcceptedPayment({ currency: 'USD', amount: 1000 }), false);
  // A $15 "amount" sent as INR is only ₹15
  assert.equal(isAcceptedPayment({ currency: 'INR', amount: 1500 }), false);
});

test('unknown currencies are rejected', () => {
  assert.equal(isAcceptedPayment({ currency: 'EUR', amount: 999999 }), false);
  assert.equal(isAcceptedPayment({ amount: 100000 }), false);
});

test('legacy check only needs a supported currency, not the full price', () => {
  assert.equal(isAcceptedPayment({ currency: 'USD', amount: 500 }, { requireFullPrice: false }), true);
  assert.equal(isAcceptedPayment({ currency: 'EUR', amount: 500 }, { requireFullPrice: false }), false);
});
