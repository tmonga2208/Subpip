// Request/response wrapper (web/api/_lib/http.js) and the Razorpay webhook
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { callable, HttpsError } from '../../web/api/_lib/http.js';
import { handleWebhook } from '../../web/api/_lib/webhook.js';
import { fakeFirestore, fakeRazorpay, FieldValue } from '../helpers/fake-firestore.js';

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}
const fakeReq = ({ method = 'POST', body, headers = {} } = {}) => ({ method, body, headers });
const auth = { verifyIdToken: async (token) => { if (token !== 'good') throw new Error('bad token'); return { uid: 'u1', email: 'a@b.c' }; } };

test('callable passes data and the verified user to the handler', async () => {
  let seen;
  const handler = callable(async (data, ctx) => { seen = { data, ctx }; return { ok: 1 }; }, async () => ({ auth }));
  const res = fakeRes();
  await handler(fakeReq({ body: { data: { x: 1 } }, headers: { authorization: 'Bearer good' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { result: { ok: 1 } });
  assert.deepEqual(seen.data, { x: 1 });
  assert.equal(seen.ctx.auth.uid, 'u1');
  assert.equal(seen.ctx.auth.token.email, 'a@b.c');
});

test('callable treats a missing or invalid token as signed out', async () => {
  let seen;
  const handler = callable(async (data, ctx) => { seen = ctx.auth; return {}; }, async () => ({ auth }));
  await handler(fakeReq({ body: { data: {} }, headers: { authorization: 'Bearer forged' } }), fakeRes());
  assert.equal(seen, null);
});

test('callable maps HttpsError to a status and the callable error shape', async () => {
  const handler = callable(async () => { throw new HttpsError('permission-denied', 'Premium subscription required'); }, async () => ({ auth }));
  const res = fakeRes();
  await handler(fakeReq({ body: { data: {} } }), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: { message: 'Premium subscription required', status: 'PERMISSION_DENIED' } });
});

test('callable hides unexpected errors behind a generic 500', async () => {
  const handler = callable(async () => { throw new Error('db exploded with secrets'); }, async () => ({ auth }));
  const res = fakeRes();
  const log = console.error;
  console.error = () => {};
  await handler(fakeReq({ body: { data: {} } }), res);
  console.error = log;
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { message: 'Internal error', status: 'INTERNAL' } });
});

test('callable answers CORS preflight and rejects non-POST', async () => {
  const handler = callable(async () => ({}), async () => ({ auth }));
  const pre = fakeRes();
  await handler(fakeReq({ method: 'OPTIONS' }), pre);
  assert.equal(pre.statusCode, 204);
  assert.match(pre.headers['access-control-allow-headers'], /authorization/i);
  const get = fakeRes();
  await handler(fakeReq({ method: 'GET' }), get);
  assert.equal(get.statusCode, 405);
});

// ---- webhook ----

function webhookReq(payload, secret, signature) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const req = Readable.from([Buffer.from(raw)]);
  req.method = 'POST';
  req.headers = { 'x-razorpay-signature': sig };
  return req;
}
const captured = (entity) => ({ event: 'payment.captured', payload: { payment: { entity } } });

test('a correctly signed payment.captured webhook creates the license', async () => {
  const db = fakeFirestore();
  const res = fakeRes();
  const { fakeMailer, fixedClock } = await import('../helpers/fake-firestore.js');
  const mailer = fakeMailer();
  await handleWebhook(webhookReq(captured({ id: 'pay_W1', currency: 'USD', amount: 1500, email: 'w@example.com' }), 'whsec'), res,
    { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec', mailer, now: fixedClock('2026-09-29T10:00:00Z') });
  assert.equal(res.statusCode, 200);
  assert.ok(db.read('licenses/pay_W1').key);
  assert.equal(mailer.sent.length, 1);
});

test('a webhook with a bad signature is refused and creates nothing', async () => {
  const db = fakeFirestore();
  const res = fakeRes();
  await handleWebhook(webhookReq(captured({ id: 'pay_W2', currency: 'INR', amount: 100000 }), 'whsec', 'deadbeef'), res,
    { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(res.statusCode, 401);
  assert.equal(db.read('licenses/pay_W2'), undefined);
});

test('an underpaid webhook payment is ignored', async () => {
  const db = fakeFirestore();
  const res = fakeRes();
  await handleWebhook(webhookReq(captured({ id: 'pay_W3', currency: 'USD', amount: 100 }), 'whsec'), res,
    { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('licenses/pay_W3'), undefined);
});

test('unexpected errors alert the owner (when dependencies are available)', async () => {
  const { fakeMailer, fixedClock, fakeFirestore } = await import('../helpers/fake-firestore.js');
  const mailer = fakeMailer();
  const deps = { auth, db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  const handler = callable(async function brokenThing() { throw new Error('kaboom'); }, async () => deps);
  const log = console.error;
  console.error = () => {};
  await handler(fakeReq({ body: { data: {} } }), fakeRes());
  console.error = log;
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /internal-error/);
  assert.match(mailer.sent[0].text, /brokenThing/);
});

test('/api/health reports config presence without values', async () => {
  const { default: health } = await import('../../web/api/health.js');
  const KEYS = ['FIREBASE_SERVICE_ACCOUNT', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'DEEPL_API_KEY'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { FIREBASE_SERVICE_ACCOUNT: '{"secret":1}', RAZORPAY_KEY_SECRET: 'rk', RAZORPAY_WEBHOOK_SECRET: 'wh', GMAIL_USER: 'a@b.c', GMAIL_APP_PASSWORD: 'pw' });
  delete process.env.DEEPL_API_KEY;
  const ok = fakeRes();
  await health({ method: 'GET', headers: {} }, ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { ok: true, config: { firebase: true, razorpay: true, webhook: true, deepl: false, email: true } });
  assert.doesNotMatch(JSON.stringify(ok.body), /secret|rk|wh|pw/);
  delete process.env.GMAIL_APP_PASSWORD;
  const down = fakeRes();
  await health({ method: 'GET', headers: {} }, down);
  assert.equal(down.statusCode, 503);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const refunded = (paymentId) => ({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: paymentId } }, payment: { entity: { id: paymentId, refund_status: 'full' } } } });

test('refund.processed revokes the license and the buyer\'s Premium', async () => {
  const db = fakeFirestore({
    'licenses/pay_R1': { key: 'SUBPIP-REFUNDED-0001', paymentId: 'pay_R1', verified: true, usedBy: 'u1' },
    'users/u1': { isPremium: true, licenseKey: 'SUBPIP-REFUNDED-0001' }
  });
  const res = fakeRes();
  await handleWebhook(webhookReq(refunded('pay_R1'), 'whsec'), res, { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('licenses/pay_R1').revoked, true);
  assert.deepEqual(db.read('users/u1'), { isPremium: false, licenseKey: null });
});

test('a refund leaves an account alone if it now uses a different license', async () => {
  const db = fakeFirestore({
    'licenses/pay_R2': { key: 'SUBPIP-OLDKEY01-0001', paymentId: 'pay_R2', verified: true, usedBy: 'u2' },
    'users/u2': { isPremium: true, licenseKey: 'SUBPIP-NEWKEY01-0001' }
  });
  await handleWebhook(webhookReq(refunded('pay_R2'), 'whsec'), fakeRes(), { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(db.read('licenses/pay_R2').revoked, true);
  assert.equal(db.read('users/u2').isPremium, true);
});
