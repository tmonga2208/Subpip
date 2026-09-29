// Production-hardening final-review fixes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { issueLicense, resendLicense, confirmPayment } from '../../web/api/_lib/licensing.js';
import { handleWebhook } from '../../web/api/_lib/webhook.js';
import { mailerOptions } from '../../web/api/_lib/mailer.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue, signFor } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
const deps = (extra = {}) => {
  const deferred = [];
  return { db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(), mailer: fakeMailer(), alertTo: 'owner@example.com',
    now: fixedClock('2026-09-29T10:00:00Z'), keySecret: 'k', defer: (p) => deferred.push(p), deferred, ...extra };
};
function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  return res;
}
function webhookReq(payload, secret, signature) {
  const raw = JSON.stringify(payload);
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'x-razorpay-signature': signature ?? crypto.createHmac('sha256', secret).update(raw).digest('hex') };
  return req;
}

// 1. Lost-key timing
test('lost-key replies without waiting for the email to send', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  let release;
  d.mailer.send = () => new Promise((resolve) => { release = resolve; });
  const reply = await Promise.race([resendLicense({ email: 'buyer@example.com' }, {}, d), new Promise((r) => setTimeout(() => r('TIMED OUT'), 200))]);
  assert.notEqual(reply, 'TIMED OUT', 'reply waited for SMTP');
  assert.equal(d.deferred.length, 1);
  release();
  await Promise.all(d.deferred);
});

// 8. Lost-key volume caps
test('lost-key sends at most 3 emails per address per day', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  for (let i = 0; i < 5; i++) {
    d.now = fixedClock(new Date(Date.parse('2026-09-29T08:00:00Z') + i * 11 * 60000).toISOString());
    await quiet(() => resendLicense({ email: 'buyer@example.com' }, {}, d));
  }
  await Promise.all(d.deferred);
  assert.equal(d.mailer.sent.length, 3);
});

test('lost-key sends at most 100 emails a day across all addresses', async () => {
  const d = deps();
  for (let i = 0; i < 105; i++) d.db.docs.set(`licenses/pay_${i}`, { key: `SUBPIP-K${String(i).padStart(7, '0')}-0001`, email: `b${i}@example.com`, verified: true });
  for (let i = 0; i < 105; i++) await quiet(() => resendLicense({ email: `b${i}@example.com` }, {}, d));
  await Promise.all(d.deferred);
  assert.equal(d.mailer.sent.length, 100);
});

// 2. Charged but rejected → alert
test('a captured payment below the price alerts the owner (confirmPayment)', async () => {
  const d = deps({ razorpay: fakeRazorpay({ pay_1: { status: 'captured', currency: 'INR', amount: 50000, order_id: 'order_1' } }) });
  await quiet(() => assert.rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', 'k') }, {}, d)));
  assert.ok(d.mailer.sent.some((m) => /payment-rejected/.test(m.subject) && /pay_1/.test(m.text)));
});

test('a captured payment below the price alerts the owner (webhook)', async () => {
  const d = deps({ webhookSecret: 'wh' });
  const res = fakeRes();
  await quiet(() => handleWebhook(webhookReq({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_2', status: 'captured', currency: 'USD', amount: 100 } } } }, 'wh'), res, d));
  assert.equal(res.statusCode, 200);
  assert.ok(d.mailer.sent.some((m) => /payment-rejected/.test(m.subject) && /pay_2/.test(m.text)));
});

// 3. Partial refunds
const refundEvent = (paymentId, { refundAmount, refundStatus }) => ({
  event: 'refund.processed',
  payload: { refund: { entity: { id: 'rfnd_1', payment_id: paymentId, amount: refundAmount } }, payment: { entity: { id: paymentId, refund_status: refundStatus } } }
});

test('a partial refund does not revoke the license', async () => {
  const d = deps({ webhookSecret: 'wh' });
  d.db.docs.set('licenses/pay_P', { key: 'SUBPIP-PARTIAL1-0001', paymentId: 'pay_P', amount: 100000, verified: true, usedBy: 'u1' });
  d.db.docs.set('users/u1', { isPremium: true, licenseKey: 'SUBPIP-PARTIAL1-0001' });
  await quiet(() => handleWebhook(webhookReq(refundEvent('pay_P', { refundAmount: 10000, refundStatus: 'partial' }), 'wh'), fakeRes(), d));
  assert.equal(d.db.read('licenses/pay_P').revoked, undefined);
  assert.equal(d.db.read('users/u1').isPremium, true);
});

test('a full refund revokes the license', async () => {
  const d = deps({ webhookSecret: 'wh' });
  d.db.docs.set('licenses/pay_F', { key: 'SUBPIP-FULLREF1-0001', paymentId: 'pay_F', amount: 100000, verified: true, usedBy: 'u1' });
  d.db.docs.set('users/u1', { isPremium: true, licenseKey: 'SUBPIP-FULLREF1-0001' });
  await quiet(() => handleWebhook(webhookReq(refundEvent('pay_F', { refundAmount: 100000, refundStatus: 'full' }), 'wh'), fakeRes(), d));
  assert.equal(d.db.read('licenses/pay_F').revoked, true);
  assert.equal(d.db.read('users/u1').isPremium, false);
});

// 4. Email not lost when the creating call dies
test('a license created without its email is emailed by the next call, once', async () => {
  const d = deps();
  const payment = { id: 'pay_L', status: 'captured', currency: 'USD', amount: 1500, email: 'lost@example.com' };
  // First call "died" after creating the license: doc exists, never emailed
  d.db.docs.set('licenses/pay_L', { key: 'SUBPIP-LOSTMAIL-0001', paymentId: 'pay_L', email: 'lost@example.com', amount: 1500, currency: 'USD', verified: true, usedBy: null });
  await quiet(() => issueLicense(d, payment));
  await quiet(() => issueLicense(d, payment));
  assert.equal(d.mailer.sent.filter((m) => m.to === 'lost@example.com').length, 1);
  assert.ok(d.db.read('licenses/pay_L').emailedAt);
});

test('SMTP connections time out quickly instead of hanging the function', () => {
  const options = mailerOptions('a@b.c', 'pw');
  assert.ok(options.connectionTimeout <= 10000 && options.greetingTimeout <= 10000 && options.socketTimeout <= 15000);
});

// 5. Webhook alerts
test('a webhook with a bad signature alerts the owner', async () => {
  const d = deps({ webhookSecret: 'wh' });
  const res = fakeRes();
  await quiet(() => handleWebhook(webhookReq({ event: 'payment.captured' }, 'wh', 'deadbeef'), res, d));
  assert.equal(res.statusCode, 401);
  assert.ok(d.mailer.sent.some((m) => /webhook-signature/.test(m.subject)));
});

test('a webhook that fails to create a license alerts the owner', async () => {
  const d = deps({ webhookSecret: 'wh' });
  d.db.collection = () => { throw new Error('Firestore unavailable'); };
  const res = fakeRes();
  await quiet(() => handleWebhook(webhookReq({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_X', status: 'captured', currency: 'INR', amount: 100000 } } } }, 'wh'), res, d));
  assert.equal(res.statusCode, 500);
  // alertOwner itself needs Firestore for throttling, so it can't send here; the
  // failure is still logged. With Firestore up, the alert is sent:
  const d2 = deps({ webhookSecret: 'wh' });
  const realCreate = d2.db.collection.bind(d2.db);
  d2.db.collection = (name) => { const c = realCreate(name); if (name === 'licenses') { c.doc = () => { throw new Error('create failed'); }; } return c; };
  await quiet(() => handleWebhook(webhookReq({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Y', status: 'captured', currency: 'INR', amount: 100000 } } } }, 'wh'), fakeRes(), d2));
  assert.ok(d2.mailer.sent.some((m) => /license-creation-failed/.test(m.subject) && /pay_Y/.test(m.text)));
});

// 6. Capture race
test('if auto-capture wins the race, confirmPayment still issues the license', async () => {
  const payments = { pay_R: { status: 'authorized', currency: 'INR', amount: 100000, order_id: 'order_1', email: 'r@example.com' } };
  const razorpay = fakeRazorpay(payments);
  razorpay.payments.capture = async () => { payments.pay_R.status = 'captured'; throw new Error('This payment has already been captured'); };
  const d = deps({ razorpay });
  const result = await quiet(() => confirmPayment({ paymentId: 'pay_R', orderId: 'order_1', signature: signFor('order_1', 'pay_R', 'k') }, {}, d));
  assert.ok(result.licenseKey);
});
