import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertOwner, day } from '../../web/api/_lib/alerts.js';
import { configStatus, requiredConfigOk } from '../../web/api/_lib/deps.js';
import { fakeFirestore, fakeMailer, fixedClock } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('day() is the UTC date', () => {
  assert.equal(day(new Date('2026-09-29T23:30:00Z')), '2026-09-29');
});

test('alerts email the owner with the type in the subject', async () => {
  const mailer = fakeMailer();
  const sent = await quiet(() => alertOwner({ db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') },
    'license-email-failed', 'Could not email a license', { paymentId: 'pay_1' }));
  assert.equal(sent, true);
  assert.equal(mailer.sent[0].to, 'owner@example.com');
  assert.match(mailer.sent[0].subject, /license-email-failed/);
  assert.match(mailer.sent[0].text, /pay_1/);
});

test('at most 3 alerts of a type per day', async () => {
  const deps = { db: fakeFirestore(), mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  for (let i = 0; i < 5; i++) await quiet(() => alertOwner(deps, 'internal-error', `boom ${i}`));
  assert.equal(deps.mailer.sent.length, 3);
  await quiet(() => alertOwner(deps, 'deepl-quota', 'other type'));
  assert.equal(deps.mailer.sent.length, 4);
  deps.now = fixedClock('2026-09-30T00:05:00Z');
  await quiet(() => alertOwner(deps, 'internal-error', 'next day'));
  assert.equal(deps.mailer.sent.length, 5);
});

test('alerts never throw, even when email fails or is not configured', async () => {
  const mailer = fakeMailer();
  mailer.failWith = 'SMTP down';
  const deps = { db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  assert.equal(await quiet(() => alertOwner(deps, 'internal-error', 'x')), false);
  assert.equal(await quiet(() => alertOwner({ ...deps, mailer: null }, 'internal-error', 'x')), false);
});

test('configStatus reports presence only, and what is required', () => {
  const config = configStatus({ FIREBASE_SERVICE_ACCOUNT: '{}', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RESEND_API_KEY: 're_p', EMAIL_FROM: 'SubPIP <a@b.c>' });
  assert.deepEqual(config, { firebase: true, razorpay: true, webhook: true, deepl: false, email: true });
  assert.equal(requiredConfigOk(config), true);
  assert.equal(requiredConfigOk({ ...config, email: false }), false);
  // Resend needs both its key and a sender on a verified domain
  assert.equal(configStatus({ RESEND_API_KEY: 're_p' }).email, false);
  assert.equal(configStatus({ EMAIL_FROM: 'SubPIP <a@b.c>' }).email, false);
});
