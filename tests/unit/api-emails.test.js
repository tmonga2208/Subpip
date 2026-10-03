import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, licenseEmail, sendLicenseEmail } from '../../web/api/_lib/emails.js';
import { issueLicense, resendLicense, RESEND_MESSAGE } from '../../web/api/_lib/licensing.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const payment = { id: 'pay_E1', status: 'captured', currency: 'USD', amount: 1500, email: 'Buyer@Example.com' };
const deps = (extra = {}) => ({ db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(), mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z'), ...extra });

test('amounts are formatted per currency', () => {
  assert.equal(formatAmount(1500, 'USD'), '$15');
  assert.equal(formatAmount(100000, 'INR'), '₹1,000');
});

test('the license email has the key, steps, receipt and refund note', () => {
  const email = licenseEmail({ keys: ['SUBPIP-AAAAAAAA-1111'], payment });
  assert.equal(email.subject, 'Your SubPIP Premium license');
  for (const part of ['SUBPIP-AAAAAAAA-1111', 'Account & license', '$15', 'pay_E1', '7 days']) assert.ok(email.text.includes(part), part);
  for (const part of ['SUBPIP-AAAAAAAA-1111', 'Account &amp; license', '$15', 'pay_E1', '7 days']) assert.ok(email.html.includes(part), part);
});

// Mail apps block images and strip stylesheets, so the design has to hold
// with neither
test('the HTML is a whole document that needs no images or outside files', () => {
  const { html } = licenseEmail({ keys: ['SUBPIP-AAAAAAAA-1111'], payment });
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<img|<link|<script|url\(/i);
});

test('the inbox preview says what is inside without showing the key', () => {
  const { html } = licenseEmail({ keys: ['SUBPIP-AAAAAAAA-1111'], payment });
  const visible = html.slice(html.indexOf('<body')).replace(/<[^>]+>/g, ' ').trim();
  assert.match(visible, /^Your license key and how to activate it\./);
});

test('every key is shown when the email carries several (lost-key)', () => {
  const keys = ['SUBPIP-AAAAAAAA-1111', 'SUBPIP-BBBBBBBB-2222'];
  const email = licenseEmail({ keys });
  for (const key of keys) {
    assert.ok(email.text.includes(key), key);
    assert.ok(email.html.includes(key), key);
  }
  // No payment, so no receipt
  assert.doesNotMatch(email.text, /Receipt/);
  assert.doesNotMatch(email.html, /Payment ID/);
});

test('text from outside cannot add markup to the email', () => {
  const { html } = licenseEmail({ keys: ['K'], payment: { id: 'pay_<b>x</b>', amount: 1500, currency: 'USD' }, activatedFor: '"><script>alert(1)</script>@example.com' });
  assert.doesNotMatch(html, /<script|<b>x/);
  assert.match(html, /&lt;script&gt;/);
});

test('the email says where to get the key again and how to reach support', () => {
  const email = licenseEmail({ keys: ['K'], payment });
  assert.match(email.text, /https:\/\/subpip\.vercel\.app\/premium\.html/);
  assert.match(email.html, /href="https:\/\/subpip\.vercel\.app\/premium\.html"/);
  assert.match(email.text, /reply to this email/i);
  assert.match(email.html, /reply to this email/i);
});

test('issuing a license emails the buyer exactly once, even when called twice', async () => {
  const d = deps();
  const first = await issueLicense(d, payment);
  const second = await issueLicense(d, payment);
  assert.equal(second, first);
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(d.mailer.sent[0].to, 'buyer@example.com');
  assert.ok(d.mailer.sent[0].text.includes(first));
});

test('a failed license email still issues the license and alerts the owner', async () => {
  const mailer = fakeMailer();
  mailer.failWith = 'SMTP down';
  const d = deps({ mailer });
  const key = await quiet(() => issueLicense(d, payment));
  assert.ok(key);
  assert.ok(d.db.read('licenses/pay_E1'));
  // The buyer's email failed; the alert (also via mailer) failed too, but nothing threw
});

test('sendLicenseEmail without an address or mailer returns false', async () => {
  assert.equal(await quiet(() => sendLicenseEmail(deps(), { to: null, keys: ['K'] })), false);
  assert.equal(await quiet(() => sendLicenseEmail(deps({ mailer: null }), { to: 'a@b.c', keys: ['K'] })), false);
});

test('lost-key: sends keys only to the purchase email, with a generic reply', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  d.db.docs.set('licenses/pay_2', { key: 'SUBPIP-REFUND01-0001', email: 'buyer@example.com', verified: true, revoked: true });
  const reply = await resendLicense({ email: ' Buyer@Example.com ' }, {}, d);
  assert.deepEqual(reply, { message: RESEND_MESSAGE });
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(d.mailer.sent[0].to, 'buyer@example.com');
  assert.ok(d.mailer.sent[0].text.includes('SUBPIP-OWNED001-0001'));
  assert.ok(!d.mailer.sent[0].text.includes('SUBPIP-REFUND01-0001'));
});

test('lost-key: unknown emails get the same reply and no email', async () => {
  const d = deps();
  assert.deepEqual(await resendLicense({ email: 'nobody@example.com' }, {}, d), { message: RESEND_MESSAGE });
  assert.equal(d.mailer.sent.length, 0);
});

test('lost-key: at most one email per address per 10 minutes', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  assert.equal(d.mailer.sent.length, 1);
  d.now = fixedClock('2026-09-29T10:11:00Z');
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  assert.equal(d.mailer.sent.length, 2);
});

test('lost-key: invalid emails are rejected', async () => {
  await assert.rejects(resendLicense({ email: 'not-an-email' }, {}, deps()), (e) => e.status === 'invalid-argument');
});
