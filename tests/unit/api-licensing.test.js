// Licensing endpoints (web/api/_lib/licensing.js) against fake Firestore/Razorpay
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPayment, activateLicense, claimLicenseByEmail, translateText } from '../../web/api/_lib/licensing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, FieldValue, signFor } from '../helpers/fake-firestore.js';

const paid = { status: 'captured', currency: 'INR', amount: 100000, email: 'Buyer@Example.com', order_id: 'order_1' };
const deps = (db, payments = {}, extra = {}) => ({ db, FieldValue, razorpay: fakeRazorpay(payments), keySecret: 'k', ...extra });
const signed = (paymentId) => ({ paymentId, orderId: 'order_1', signature: signFor('order_1', paymentId, 'k') });
const signedIn = (uid, token = {}) => ({ auth: { uid, token } });
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof HttpsError && e.status === status);

// ---- confirmPayment ----

test('confirmPayment creates one license for a captured full-price payment', async () => {
  const db = fakeFirestore();
  const result = await confirmPayment(signed('pay_A1'), {}, deps(db, { pay_A1: paid }));
  assert.match(result.licenseKey, /^SUBPIP-[A-Z0-9]{8}-[A-Z0-9]{4}$/);
  const license = db.read('licenses/pay_A1');
  assert.equal(license.key, result.licenseKey);
  assert.equal(license.email, 'buyer@example.com');
  assert.equal(license.verified, true);
  assert.equal(license.usedBy, null);
});

test('confirmPayment is idempotent: the same payment returns the same key', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_A1: paid });
  const first = await confirmPayment(signed('pay_A1'), {}, d);
  const second = await confirmPayment(signed('pay_A1'), {}, d);
  assert.equal(second.licenseKey, first.licenseKey);
});

test('confirmPayment accepts $15 in USD', async () => {
  const db = fakeFirestore();
  const result = await confirmPayment(signed('pay_U1'), {}, deps(db, { pay_U1: { ...paid, currency: 'USD', amount: 1500 } }));
  assert.ok(result.licenseKey);
});

test('confirmPayment rejects underpayment, unknown ids and malformed ids', async () => {
  const db = fakeFirestore();
  await rejects(confirmPayment(signed('pay_LOW'), {}, deps(db, { pay_LOW: { ...paid, amount: 50000 } })), 'failed-precondition');
  await rejects(confirmPayment(signed('pay_NONE'), {}, deps(db)), 'not-found');
  await rejects(confirmPayment({ paymentId: 'order_1', orderId: 'order_1', signature: 'x' }, {}, deps(db)), 'invalid-argument');
  assert.equal(db.read('licenses/pay_LOW'), undefined);
});

test('confirmPayment captures an authorized payment before issuing a license', async () => {
  const db = fakeFirestore();
  const payments = { pay_AU: { ...paid, status: 'authorized' } };
  await confirmPayment(signed('pay_AU'), {}, deps(db, payments));
  assert.equal(payments.pay_AU.status, 'captured');
});

// ---- activateLicense ----

test('activateLicense requires sign-in', async () => {
  await rejects(activateLicense({ key: 'X' }, {}, deps(fakeFirestore())), 'unauthenticated');
});

test('activateLicense binds a verified license and marks the user premium', async () => {
  const db = fakeFirestore({ 'licenses/pay_A1': { key: 'SUBPIP-AAAAAAAA-1111', verified: true, usedBy: null } });
  const result = await activateLicense({ key: ' subpip-aaaaaaaa-1111 ', deviceId: 'dev1' }, signedIn('u1'), deps(db));
  assert.deepEqual(result, { success: true, licenseKey: 'SUBPIP-AAAAAAAA-1111' });
  assert.equal(db.read('licenses/pay_A1').usedBy, 'u1');
  assert.deepEqual(db.read('users/u1'), { isPremium: true, licenseKey: 'SUBPIP-AAAAAAAA-1111' });
});

test('activateLicense refuses a license owned by another account', async () => {
  const db = fakeFirestore({ 'licenses/pay_A1': { key: 'SUBPIP-AAAAAAAA-1111', verified: true, usedBy: 'someone-else' } });
  const result = await activateLicense({ key: 'SUBPIP-AAAAAAAA-1111' }, signedIn('u1'), deps(db));
  assert.equal(result.success, false);
  assert.equal(db.read('users/u1'), undefined);
});

test('activateLicense reports unknown keys', async () => {
  const result = await activateLicense({ key: 'SUBPIP-NOPE' }, signedIn('u1'), deps(fakeFirestore()));
  assert.deepEqual(result, { success: false, error: 'Invalid license key' });
});

test('legacy (client-created) licenses are verified against Razorpay once', async () => {
  const db = fakeFirestore({ 'licenses/license_1': { key: 'SUBPIP-LEGACY01-0001', isValid: true, paymentId: 'pay_OLD', purchaserEmail: 'old@example.com', usedBy: null } });
  const result = await activateLicense({ key: 'SUBPIP-LEGACY01-0001' }, signedIn('u1'), deps(db, { pay_OLD: { status: 'captured', currency: 'INR', amount: 50000 } }));
  assert.equal(result.success, true);
  assert.equal(db.read('licenses/license_1').verified, true);
});

test('legacy licenses without a real payment are refused', async () => {
  const db = fakeFirestore({ 'licenses/license_2': { key: 'SUBPIP-FORGED01-0001', isValid: true, paymentId: 'pay_FAKE', usedBy: null } });
  const result = await activateLicense({ key: 'SUBPIP-FORGED01-0001' }, signedIn('u1'), deps(db));
  assert.deepEqual(result, { success: false, error: 'License payment not verified' });
});

// ---- claimLicenseByEmail ----

test('claimLicenseByEmail needs a verified email', async () => {
  await rejects(claimLicenseByEmail({}, signedIn('u1', { email: 'buyer@example.com', email_verified: false }), deps(fakeFirestore())), 'failed-precondition');
});

test('claimLicenseByEmail activates the unused license bought with that email', async () => {
  const db = fakeFirestore({ 'licenses/pay_A1': { key: 'SUBPIP-AAAAAAAA-1111', verified: true, usedBy: null, email: 'buyer@example.com' } });
  const result = await claimLicenseByEmail({}, signedIn('u1', { email: 'Buyer@Example.com', email_verified: true }), deps(db));
  assert.equal(result.success, true);
  assert.equal(db.read('users/u1').isPremium, true);
});

test('claimLicenseByEmail reports when nothing was bought', async () => {
  const result = await claimLicenseByEmail({}, signedIn('u1', { email: 'nobody@example.com', email_verified: true }), deps(fakeFirestore()));
  assert.equal(result.success, false);
});

// ---- translateText ----

test('translateText is premium-only and needs sign-in', async () => {
  const db = fakeFirestore({ 'users/free': { isPremium: false } });
  await rejects(translateText({ text: 'hi', targetLang: 'es' }, {}, deps(db)), 'unauthenticated');
  await rejects(translateText({ text: 'hi', targetLang: 'es' }, signedIn('free'), deps(db)), 'permission-denied');
});

test('translateText returns the MyMemory translation for premium users', async () => {
  const db = fakeFirestore({ 'users/pro': { isPremium: true } });
  let calledUrl = '';
  const fetch = async (url) => {
    calledUrl = url;
    return { json: async () => ({ responseStatus: 200, responseData: { translatedText: 'hola' } }) };
  };
  const result = await translateText({ text: 'hello', targetLang: 'es' }, signedIn('pro'), deps(db, {}, { fetch, myMemoryEmail: 'ops@example.com' }));
  assert.equal(result.translation, 'hola');
  assert.match(calledUrl, /langpair=Autodetect%7Ces|langpair=Autodetect\|es/);
  assert.match(calledUrl, /de=ops%40example\.com/);
});
