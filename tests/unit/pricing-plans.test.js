// Regional prices and the one-year pass, on the server: what an order costs,
// and which plan a captured payment bought
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_PRICES, priceFor, planOfPayment, isAcceptedPayment, YEAR_MS } from '../../web/api/_lib/pricing.js';
import { createOrder } from '../../web/api/_lib/orders.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

test('three price levels: India, the lower-priced countries, everywhere else; lifetime and one year', () => {
  assert.deepEqual(PLAN_PRICES, {
    INR: { standard: { lifetime: 99900, year: 39900 } },
    USD: { standard: { lifetime: 1500, year: 600 }, low: { lifetime: 700, year: 300 } }
  });
  assert.equal(YEAR_MS, 365 * 24 * 60 * 60 * 1000);
});

test('the price of an order comes from the table; what is not on it has no price', () => {
  assert.equal(priceFor({ currency: 'INR' }), 99900);
  assert.equal(priceFor({ currency: 'INR', plan: 'year' }), 39900);
  assert.equal(priceFor({ currency: 'USD', plan: 'lifetime', tier: 'low' }), 700);
  assert.equal(priceFor({ currency: 'USD', plan: 'year', tier: 'low' }), 300);
  assert.equal(priceFor({ currency: 'USD', plan: 'year' }), 600);
  // India has one level: asking for the lower one there changes nothing
  assert.equal(priceFor({ currency: 'INR', plan: 'year', tier: 'low' }), 39900);
  for (const odd of [{ currency: 'EUR' }, { currency: 'USD', plan: 'month' }, { currency: 'USD', tier: 'free' }, {}]) assert.equal(priceFor(odd), null, JSON.stringify(odd));
});

test('a captured payment is for the plan its amount buys', () => {
  assert.equal(planOfPayment({ currency: 'INR', amount: 99900 }), 'lifetime');
  assert.equal(planOfPayment({ currency: 'INR', amount: 39900 }), 'year');
  assert.equal(planOfPayment({ currency: 'USD', amount: 1500 }), 'lifetime');
  assert.equal(planOfPayment({ currency: 'USD', amount: 700 }), 'lifetime');
  assert.equal(planOfPayment({ currency: 'USD', amount: 600 }), 'year');
  assert.equal(planOfPayment({ currency: 'USD', amount: 300 }), 'year');
  // More than the highest price is still a lifetime purchase
  assert.equal(planOfPayment({ currency: 'INR', amount: 100000 }), 'lifetime');
});

test('an amount that is on no list buys nothing', () => {
  for (const payment of [{ currency: 'INR', amount: 39899 }, { currency: 'INR', amount: 50000 }, { currency: 'INR', amount: 700 }, { currency: 'USD', amount: 299 }, { currency: 'USD', amount: 1000 }, { currency: 'EUR', amount: 99900 }, { amount: 300 }]) {
    assert.equal(planOfPayment(payment), null, JSON.stringify(payment));
    assert.equal(isAcceptedPayment(payment), false);
  }
});

const deps = () => ({ db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(), keyId: 'rzp_test', keySecret: 's', now: fixedClock('2026-10-08T10:00:00Z') });

test('an order is created at the price of its plan and level, and says which plan', async () => {
  const d = deps();
  assert.equal((await createOrder({ currency: 'USD', plan: 'year', tier: 'low' }, {}, d)).amount, 300);
  assert.equal((await createOrder({ currency: 'USD', tier: 'low' }, {}, d)).amount, 700);
  assert.equal((await createOrder({ currency: 'INR', plan: 'year', email: 'b@example.com' }, {}, d)).amount, 39900);
  assert.deepEqual(d.razorpay.orders.created.map((order) => order.notes), [{ plan: 'year' }, { plan: 'lifetime' }, { plan: 'year', email: 'b@example.com' }]);
  const order = await createOrder({ currency: 'USD', plan: 'year' }, {}, d);
  assert.deepEqual(order, { orderId: 'order_4', amount: 600, currency: 'USD', keyId: 'rzp_test', plan: 'year' });
});

test('an unknown plan or level is refused rather than guessed at', async () => {
  const d = deps();
  for (const data of [{ currency: 'USD', plan: 'month' }, { currency: 'USD', tier: 'free' }]) {
    await assert.rejects(createOrder(data, {}, d), (e) => e instanceof HttpsError && e.status === 'invalid-argument');
  }
  assert.equal(d.razorpay.orders.created.length, 0);
});
