import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, validPaymentSignature } from '../../web/api/_lib/orders.js';
import { confirmPayment } from '../../web/api/_lib/licensing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue, signFor } from '../helpers/fake-firestore.js';

const SECRET = 'rk_secret';
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof HttpsError && e.status === status);
const deps = (payments = {}) => ({ db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(payments), keyId: 'rzp_test', keySecret: SECRET, mailer: fakeMailer(), alertTo: 'o@x.y', now: fixedClock('2026-09-29T10:00:00Z') });

test('createOrder sets the amount from the price table', async () => {
  const d = deps();
  assert.deepEqual(await createOrder({ currency: 'USD', email: 'b@example.com' }, {}, d), { orderId: 'order_1', amount: 1500, currency: 'USD', keyId: 'rzp_test' });
  assert.deepEqual(await createOrder({ currency: 'INR' }, {}, d), { orderId: 'order_2', amount: 99900, currency: 'INR', keyId: 'rzp_test' });
  assert.deepEqual(d.razorpay.orders.created[0].notes, { plan: 'lifetime', email: 'b@example.com' });
});

test('createOrder ignores any client amount and rejects unknown currencies', async () => {
  const d = deps();
  const order = await createOrder({ currency: 'USD', amount: 1 }, {}, d);
  assert.equal(order.amount, 1500);
  await rejects(createOrder({ currency: 'EUR' }, {}, d), 'invalid-argument');
});

test('payment signatures are checked exactly', () => {
  const sig = signFor('order_1', 'pay_1', SECRET);
  assert.equal(validPaymentSignature('order_1', 'pay_1', sig, SECRET), true);
  assert.equal(validPaymentSignature('order_1', 'pay_2', sig, SECRET), false);
  assert.equal(validPaymentSignature('order_1', 'pay_1', 'deadbeef', SECRET), false);
  assert.equal(validPaymentSignature('order_1', 'pay_1', sig, 'other_secret'), false);
});

const paid = (orderId) => ({ status: 'captured', currency: 'USD', amount: 1500, email: 'b@example.com', order_id: orderId });

test('confirmPayment issues a license for a signed payment on its order', async () => {
  const d = deps({ pay_1: paid('order_1') });
  const result = await confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d);
  assert.ok(result.licenseKey);
  assert.equal(d.mailer.sent.length, 1);
});

test('confirmPayment refuses a forged signature', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: 'forged' }, {}, d), 'invalid-argument');
  assert.equal(d.db.read('licenses/pay_1'), undefined);
});

test('confirmPayment refuses a payment that belongs to another order', async () => {
  const d = deps({ pay_1: paid('order_OTHER') });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d), 'failed-precondition');
});

test('confirmPayment requires the order id and signature', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await rejects(confirmPayment({ paymentId: 'pay_1' }, {}, d), 'invalid-argument');
});

test('an underpaid order payment is refused', async () => {
  const d = deps({ pay_1: { ...paid('order_1'), amount: 100 } });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d), 'failed-precondition');
});
