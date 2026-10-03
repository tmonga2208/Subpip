// Buying from the popup while signed in: the purchase is tied to that account
// on the server, so Premium turns on by itself once the payment is captured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { startCheckout } from '../../web/api/_lib/checkout.js';
import { createOrder } from '../../web/api/_lib/orders.js';
import { confirmPayment, activateLicense } from '../../web/api/_lib/licensing.js';
import { handleWebhook } from '../../web/api/_lib/webhook.js';
import { licenseEmail } from '../../web/api/_lib/emails.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue, signFor } from '../helpers/fake-firestore.js';

const SECRET = 'rk_secret';
const quiet = async (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
const deps = (payments = {}) => ({
  db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(payments), keyId: 'rzp_test', keySecret: SECRET, webhookSecret: 'wh',
  mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-10-03T10:00:00Z')
});
const account = (uid = 'u1', email = 'Me@Example.com') => ({ auth: { uid, token: { email } } });
const paid = (orderId, extra = {}) => ({ status: 'captured', currency: 'USD', amount: 1500, email: 'payer@example.com', order_id: orderId, ...extra });
const confirm = (d, paymentId, orderId) => confirmPayment({ paymentId, orderId, signature: signFor(orderId, paymentId, SECRET) }, {}, d);

// popup → startCheckout → checkout page → createOrder, as the real flow does
async function orderFromPopup(d, ctx = account()) {
  const { code } = await startCheckout({}, ctx, d);
  const order = await createOrder({ currency: 'USD', email: 'payer@example.com', checkout: code }, {}, d);
  return { code, order };
}

test('starting a checkout needs a signed-in account', async () => {
  await assert.rejects(startCheckout({}, {}, deps()), (e) => e instanceof HttpsError && e.status === 'unauthenticated');
});

test('each checkout gets its own unguessable code', async () => {
  const d = deps();
  const first = (await startCheckout({}, account(), d)).code;
  const second = (await startCheckout({}, account(), d)).code;
  assert.match(first, /^[A-Za-z0-9_-]{20,}$/);
  assert.notEqual(first, second);
});

test('an order made with a checkout code tells the page which account it is for', async () => {
  const d = deps();
  const { order } = await orderFromPopup(d);
  assert.equal(order.accountEmail, 'me@example.com');
  assert.equal(order.amount, 1500);
});

test('paying for an order started from the popup activates Premium on that account, no key needed', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await orderFromPopup(d);
  const result = await confirm(d, 'pay_1', 'order_1');
  assert.equal(result.activatedFor, 'me@example.com');
  assert.deepEqual(d.db.read('users/u1'), { isPremium: true, licenseKey: result.licenseKey });
  assert.equal(d.db.read('licenses/pay_1').usedBy, 'u1');
});

test('the webhook alone activates it too, when the buyer closes the page early', async () => {
  const d = deps();
  await orderFromPopup(d);
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', ...paid('order_1') } } } });
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'x-razorpay-signature': crypto.createHmac('sha256', 'wh').update(raw).digest('hex') };
  const res = { status() { return res; }, json() { return res; }, send() { return res; } };
  await quiet(() => handleWebhook(req, res, d));
  assert.equal(d.db.read('users/u1').isPremium, true);
});

test('a checkout from the website (no code) still just issues a key', async () => {
  const d = deps({ pay_1: paid('order_1') });
  const order = await createOrder({ currency: 'USD', email: 'payer@example.com' }, {}, d);
  assert.equal('accountEmail' in order, false);
  const result = await confirm(d, 'pay_1', 'order_1');
  assert.ok(result.licenseKey);
  assert.equal('activatedFor' in result, false);
  assert.equal(d.db.read('licenses/pay_1').usedBy, null);
});

test('an unknown, malformed or expired code is ignored: the order is a normal one', async () => {
  const d = deps({ pay_1: paid('order_1'), pay_2: paid('order_2'), pay_3: paid('order_3') });
  for (const checkout of ['no-such-code-0123456789abcdef', '../../users/u1', 42]) {
    const order = await createOrder({ currency: 'USD', email: 'payer@example.com', checkout }, {}, d);
    assert.equal('accountEmail' in order, false, String(checkout));
  }
  const { code } = await startCheckout({}, account(), d);
  d.now = fixedClock('2026-10-03T12:00:01Z'); // two hours and a second later
  const late = await createOrder({ currency: 'USD', checkout: code }, {}, d);
  assert.equal('accountEmail' in late, false);
  await confirm(d, 'pay_1', 'order_1');
  assert.equal(d.db.read('users/u1'), undefined);
});

test('the payer cannot point the activation at another account through payment notes', async () => {
  // Razorpay copies notes set by the checkout page onto the payment; only the
  // server's own record of the order counts
  const d = deps({ pay_1: paid('order_1', { notes: { uid: 'victim', email: 'payer@example.com' } }) });
  await createOrder({ currency: 'USD', email: 'payer@example.com' }, {}, d);
  await confirm(d, 'pay_1', 'order_1');
  assert.equal(d.db.read('users/victim'), undefined);
});

test('if activating fails, the buyer still gets the license and the email', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await orderFromPopup(d);
  const collection = d.db.collection.bind(d.db);
  d.db.collection = (name) => {
    if (name === 'orders') throw new Error('Firestore unavailable');
    return collection(name);
  };
  const result = await quiet(() => confirm(d, 'pay_1', 'order_1'));
  assert.ok(result.licenseKey);
  assert.equal('activatedFor' in result, false);
  assert.equal(d.mailer.sent.filter((m) => m.to === 'payer@example.com').length, 1);
  // ...and the key still works by hand
  d.db.collection = collection;
  assert.equal((await activateLicense({ key: result.licenseKey }, account(), d)).success, true);
});

test('the license email says when Premium is already active, instead of asking to paste the key', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await orderFromPopup(d);
  await confirm(d, 'pay_1', 'order_1');
  const [mail] = d.mailer.sent.filter((m) => m.to === 'payer@example.com');
  assert.match(mail.text, /already active on me@example\.com/);
  assert.doesNotMatch(mail.text, /paste the key/);
  assert.match(mail.html, /already active on me@example\.com/);
  // a purchase without an account keeps the activation steps
  assert.match(licenseEmail({ keys: ['K'], payment: { id: 'pay_9', amount: 1500, currency: 'USD' } }).text, /paste the key/);
});

test('a database problem while tying the order to the account never blocks the purchase', async () => {
  const d = deps({ pay_1: paid('order_1') });
  const { code } = await startCheckout({}, account(), d);
  const collection = d.db.collection.bind(d.db);
  for (const broken of ['checkouts', 'orders']) {
    d.db.collection = (name) => {
      if (name === broken) throw new Error('Firestore unavailable');
      return collection(name);
    };
    const order = await quiet(() => createOrder({ currency: 'USD', email: 'payer@example.com', checkout: code }, {}, d));
    assert.equal(order.amount, 1500, broken);
    // the page must not promise an automatic activation that will not happen
    assert.equal('accountEmail' in order, false, broken);
  }
});
