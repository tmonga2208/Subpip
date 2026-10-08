// The one-year pass: a licence that ends a year after it was bought, is told
// about beforehand, and is not renewed by itself
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPayment, activateLicense, translateText, resendLicense } from '../../web/api/_lib/licensing.js';
import { endFinishedPasses } from '../../web/api/_lib/passes.js';
import { YEAR_MS } from '../../web/api/_lib/pricing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, FieldValue, signFor } from '../helpers/fake-firestore.js';

const NOW = Date.parse('2026-10-08T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms) => () => new Date(ms);
const year = { status: 'captured', currency: 'USD', amount: 600, email: 'buyer@example.com', order_id: 'order_1' };
const life = { ...year, amount: 1500 };
const deps = (db, payments = {}, now = NOW) => ({ db, FieldValue, razorpay: fakeRazorpay(payments), keySecret: 'k', mailer: fakeMailer(), alertTo: 'o@x.y', now: at(now) });
const signed = (paymentId) => ({ paymentId, orderId: 'order_1', signature: signFor('order_1', paymentId, 'k') });
const signedIn = (uid) => ({ auth: { uid, token: { email: 'buyer@example.com', email_verified: true } } });

test('a one-year payment makes a licence that ends a year on; a lifetime one has no end', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_Y: year, pay_L: life });
  await confirmPayment(signed('pay_Y'), {}, d);
  await confirmPayment(signed('pay_L'), {}, d);
  assert.equal(db.read('licenses/pay_Y').plan, 'year');
  assert.equal(db.read('licenses/pay_Y').expiresAt, NOW + YEAR_MS);
  assert.equal(db.read('licenses/pay_L').plan, 'lifetime');
  assert.equal('expiresAt' in db.read('licenses/pay_L'), false);
});

test('its email says it is for one year, and until when', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_Y: year });
  await confirmPayment(signed('pay_Y'), {}, d);
  const [mail] = d.mailer.sent;
  assert.match(mail.text, /one year of Premium, until 8 October 2027/);
  assert.doesNotMatch(mail.text, /lifetime/i);
  assert.match(mail.html, /SubPIP Premium, one year/);
});

test('activating it makes the account Premium until that day', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_Y: year });
  const { licenseKey } = await confirmPayment(signed('pay_Y'), {}, d);
  assert.deepEqual(await activateLicense({ key: licenseKey }, signedIn('u1'), d), { success: true, licenseKey });
  assert.deepEqual(db.read('users/u1'), { isPremium: true, licenseKey, premiumUntil: NOW + YEAR_MS });
});

test('a second year bought before the first has ended is added on to it', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_Y: year });
  const first = await confirmPayment(signed('pay_Y'), {}, d);
  await activateLicense({ key: first.licenseKey }, signedIn('u1'), d);
  const later = deps(db, { pay_Z: year }, NOW + 300 * DAY);
  const second = await confirmPayment(signed('pay_Z'), {}, later);
  await activateLicense({ key: second.licenseKey }, signedIn('u1'), later);
  assert.equal(db.read('users/u1').premiumUntil, NOW + 2 * YEAR_MS);
  assert.equal(db.read('licenses/pay_Z').expiresAt, NOW + 2 * YEAR_MS);
  // Activating the same key again adds nothing more
  await activateLicense({ key: second.licenseKey }, signedIn('u1'), later);
  assert.equal(db.read('users/u1').premiumUntil, NOW + 2 * YEAR_MS);
});

test('a year bought by someone with lifetime Premium takes nothing away', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_L: life, pay_Y: year });
  const lifetime = await confirmPayment(signed('pay_L'), {}, d);
  await activateLicense({ key: lifetime.licenseKey }, signedIn('u1'), d);
  const pass = await confirmPayment(signed('pay_Y'), {}, d);
  await activateLicense({ key: pass.licenseKey }, signedIn('u1'), d);
  const user = db.read('users/u1');
  assert.equal(user.isPremium, true);
  assert.equal(user.licenseKey, lifetime.licenseKey);
  assert.ok(!user.premiumUntil);
});

test('lifetime bought during a year replaces it and has no end', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_L: life, pay_Y: year });
  const pass = await confirmPayment(signed('pay_Y'), {}, d);
  await activateLicense({ key: pass.licenseKey }, signedIn('u1'), d);
  const lifetime = await confirmPayment(signed('pay_L'), {}, d);
  await activateLicense({ key: lifetime.licenseKey }, signedIn('u1'), d);
  assert.deepEqual(db.read('users/u1'), { isPremium: true, licenseKey: lifetime.licenseKey, premiumUntil: null });
});

test('a year that has ended cannot be activated, is not sent again, and does not translate', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_Y: year });
  const { licenseKey } = await confirmPayment(signed('pay_Y'), {}, d);
  await activateLicense({ key: licenseKey }, signedIn('u1'), d);
  const after = deps(db, {}, NOW + YEAR_MS + DAY);
  assert.deepEqual(await activateLicense({ key: licenseKey }, signedIn('u2'), after), { success: false, error: 'This license has ended. You can get another year, or lifetime, at subpip.online' });
  await assert.rejects(translateText({ text: 'hello', targetLang: 'es' }, signedIn('u1'), after), (e) => e instanceof HttpsError && e.status === 'permission-denied');
  await resendLicense({ email: 'buyer@example.com' }, {}, after);
  assert.equal(after.mailer.sent.length, 0);
});

// ---- the daily look at the passes ----

async function withPass(db, paymentId = 'pay_Y', uid = 'u1') {
  const d = deps(db, { [paymentId]: year });
  const { licenseKey } = await confirmPayment(signed(paymentId), {}, d);
  if (uid) await activateLicense({ key: licenseKey }, signedIn(uid), d);
  return licenseKey;
}

test('a week before the end the buyer is reminded, once', async () => {
  const db = fakeFirestore();
  await withPass(db);
  const early = deps(db, {}, NOW + YEAR_MS - 8 * DAY);
  assert.deepEqual(await endFinishedPasses({}, {}, early), { ok: true, reminded: 0, ended: 0 });
  const week = deps(db, {}, NOW + YEAR_MS - 6 * DAY);
  assert.deepEqual(await endFinishedPasses({}, {}, week), { ok: true, reminded: 1, ended: 0 });
  const [mail] = week.mailer.sent;
  assert.equal(mail.to, 'buyer@example.com');
  assert.equal(mail.subject, 'Your year of SubPIP Premium ends on 8 October 2027');
  assert.match(mail.text, /It will not renew by itself and nothing will be charged/);
  assert.match(mail.text, /https:\/\/subpip\.online\/premium\.html/);
  assert.deepEqual(await endFinishedPasses({}, {}, week), { ok: true, reminded: 0, ended: 0 });
  assert.equal(db.read('users/u1').isPremium, true);
});

test('on the day it ends, Premium is switched off for that account and the buyer is told', async () => {
  const db = fakeFirestore();
  const key = await withPass(db);
  const after = deps(db, {}, NOW + YEAR_MS + 60 * 1000);
  assert.deepEqual(await endFinishedPasses({}, {}, after), { ok: true, reminded: 0, ended: 1 });
  assert.equal(db.read('licenses/pay_Y').ended, true);
  assert.equal(db.read('users/u1').isPremium, false);
  assert.equal(db.read('users/u1').licenseKey, null);
  const mail = after.mailer.sent.find((each) => /has ended/.test(each.subject));
  assert.equal(mail.subject, 'Your year of SubPIP Premium has ended');
  assert.match(mail.text, /Nothing was charged/);
  assert.doesNotMatch(JSON.stringify(after.mailer.sent), new RegExp(key));
  assert.deepEqual(await endFinishedPasses({}, {}, after), { ok: true, reminded: 0, ended: 0 });
});

test('the end of an old year does not switch off a year bought since, or lifetime', async () => {
  const db = fakeFirestore();
  await withPass(db);
  const renew = deps(db, { pay_Z: year }, NOW + 300 * DAY);
  const second = await confirmPayment(signed('pay_Z'), {}, renew);
  await activateLicense({ key: second.licenseKey }, signedIn('u1'), renew);
  const after = deps(db, {}, NOW + YEAR_MS + DAY);
  await endFinishedPasses({}, {}, after);
  assert.equal(db.read('licenses/pay_Y').ended, true);
  assert.equal(db.read('users/u1').isPremium, true);
  assert.equal(db.read('users/u1').licenseKey, second.licenseKey);
});

test('lifetime licences and refunded ones are left alone', async () => {
  const db = fakeFirestore();
  const d = deps(db, { pay_L: life });
  const lifetime = await confirmPayment(signed('pay_L'), {}, d);
  await activateLicense({ key: lifetime.licenseKey }, signedIn('u9'), d);
  await withPass(db, 'pay_R', null);
  db.docs.set('licenses/pay_R', { ...db.read('licenses/pay_R'), revoked: true });
  const after = deps(db, {}, NOW + 5 * YEAR_MS);
  assert.deepEqual(await endFinishedPasses({}, {}, after), { ok: true, reminded: 0, ended: 0 });
  assert.equal(db.read('users/u9').isPremium, true);
  assert.equal(after.mailer.sent.length, 0);
});

test('someone who has already bought again hears nothing about the old year', async () => {
  const db = fakeFirestore();
  await withPass(db);
  const renew = deps(db, { pay_Z: year }, NOW + 300 * DAY);
  const second = await confirmPayment(signed('pay_Z'), {}, renew);
  await activateLicense({ key: second.licenseKey }, signedIn('u1'), renew);
  const week = deps(db, {}, NOW + YEAR_MS - 3 * DAY);
  assert.deepEqual(await endFinishedPasses({}, {}, week), { ok: true, reminded: 0, ended: 0 });
  const after = deps(db, {}, NOW + YEAR_MS + DAY);
  await endFinishedPasses({}, {}, after);
  assert.equal(week.mailer.sent.length + after.mailer.sent.length, 0);
});
