import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { alertOwner, day } from '../../web/api/_lib/alerts.js';
import { configStatus, requiredConfigOk, liveDeps } from '../../web/api/_lib/deps.js';
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
  const config = configStatus({ FIREBASE_SERVICE_ACCOUNT: '{}', RAZORPAY_KEY_ID: 'rzp_test_k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', RESEND_API_KEY: 're_p', EMAIL_FROM: 'SubPIP <a@b.c>' });
  assert.deepEqual(config, { firebase: true, razorpay: true, webhook: true, deepl: false, email: true });
  assert.equal(requiredConfigOk(config), true);
  assert.equal(requiredConfigOk({ ...config, email: false }), false);
  // Resend needs both its key and a sender on a verified domain
  assert.equal(configStatus({ RESEND_API_KEY: 're_p' }).email, false);
  assert.equal(configStatus({ EMAIL_FROM: 'SubPIP <a@b.c>' }).email, false);
  // Razorpay needs both halves of its key: the ID and the secret
  assert.equal(configStatus({ RAZORPAY_KEY_SECRET: 's' }).razorpay, false);
  assert.equal(configStatus({ RAZORPAY_KEY_ID: 'rzp_test_k' }).razorpay, false);
});

// The ID once lived in the code while its secret lived in the settings, and
// the two went out of step: Razorpay then refused every request
test('the Razorpay key ID comes from the settings, beside its secret', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  const deps = liveDeps({
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'subpip-test', client_email: 'test@subpip-test.iam.gserviceaccount.com', private_key: privateKey }),
    RAZORPAY_KEY_ID: 'rzp_test_fromSettings',
    RAZORPAY_KEY_SECRET: 'shh',
    RESEND_API_KEY: 're_x',
    EMAIL_FROM: 'SubPIP <a@b.c>'
  });
  // What the browser is told to pay with is what the server signs with
  assert.equal(deps.keyId, 'rzp_test_fromSettings');
  assert.equal(deps.razorpay.key_id, 'rzp_test_fromSettings');
});

test('no Razorpay key is written in the code', () => {
  const filesUnder = (dir) => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(file).isDirectory() ? filesUnder(file) : [file];
  });
  const withKey = [...filesUnder('web'), ...filesUnder('src')]
    .filter((file) => /\.(js|html|json)$/.test(file) && !file.endsWith('package-lock.json'))
    .filter((file) => /rzp_(test|live)_[A-Za-z0-9]{6,}/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(withKey, []);
});
