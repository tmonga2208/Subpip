// Premium licensing: licenses are only created and activated here, never by
// clients (see firestore.rules). Dependencies are passed in so tests can use
// fakes: { db, FieldValue, razorpay, fetch, myMemoryEmail }.

import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { isAcceptedPayment } from './pricing.js';
import { sendLicenseEmail } from './emails.js';
import { validPaymentSignature } from './orders.js';
import { alertOwner, day } from './alerts.js';
import { log } from './log.js';
import { translateForUser, MAX_TEXT_LENGTH } from './translate.js';

export function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const timestamp = Date.now().toString(36).toUpperCase();
  let key = 'SUBPIP-';
  for (let i = 0; i < 8; i++) key += chars.charAt(crypto.randomInt(chars.length));
  return `${key}-${timestamp.slice(-4)}`;
}

// Re-fetch the payment from Razorpay: it must be real, captured, and (for new
// purchases) at least the price in its currency
async function fetchCapturedPayment(deps, paymentId, { requireFullPrice }) {
  const { razorpay } = deps;
  let payment = await razorpay.payments.fetch(paymentId);
  if (payment.status === 'authorized') {
    try {
      payment = await razorpay.payments.capture(paymentId, payment.amount, payment.currency);
    } catch (error) {
      // Auto-capture may have won the race: carry on if it is captured now
      payment = await razorpay.payments.fetch(paymentId);
      if (payment.status !== 'captured') throw error;
    }
  }
  if (payment.status !== 'captured') return null;
  if (!isAcceptedPayment(payment, { requireFullPrice })) {
    // Charged but below the price (e.g. a Razorpay offer): the buyer paid and
    // gets no license, so the owner must know
    if (requireFullPrice) await alertPaymentRejected(deps, payment);
    return null;
  }
  return payment;
}

export async function alertPaymentRejected(deps, payment) {
  await alertOwner(deps, 'payment-rejected',
    `Payment ${payment.id} was captured (${payment.amount} ${payment.currency}) but is below the Premium price, so no license was issued. Refund it or issue a license manually.`,
    { paymentId: payment.id, amount: payment.amount, currency: payment.currency });
}

// New license docs are keyed by payment id; older ones had other ids
async function findLicenseByPaymentId({ db }, paymentId) {
  const byId = await db.collection('licenses').doc(paymentId).get();
  if (byId.exists) return byId;
  const snap = await db.collection('licenses').where('paymentId', '==', paymentId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

// Idempotent: the webhook and confirmPayment can race safely because the doc
// id is the payment id and create() fails if it already exists
export async function createLicenseForPayment(deps, payment) {
  const { db, FieldValue } = deps;
  const existing = await findLicenseByPaymentId(deps, payment.id);
  if (existing) return { key: existing.data().key, created: false, email: existing.data().email || null, ref: existing.ref };

  const email = (payment.email || payment.notes?.email || '').toLowerCase().trim();
  const licenseKey = generateLicenseKey();
  const ref = db.collection('licenses').doc(payment.id);
  try {
    await ref.create({
      key: licenseKey,
      paymentId: payment.id,
      email: email || null,
      amount: payment.amount,
      currency: payment.currency,
      contact: payment.contact || null,
      createdAt: FieldValue.serverTimestamp(),
      usedBy: null,
      activatedAt: null,
      verified: true
    });
  } catch (error) {
    if (error.code === 6) return { key: (await ref.get()).data().key, created: false, email: email || null, ref }; // ALREADY_EXISTS
    throw error;
  }
  return { key: licenseKey, created: true, email: email || null, ref };
}

// Create the license (idempotent) and make sure it gets emailed exactly once.
// Whichever call claims the send does it; if that call dies before sending,
// the claim expires and a later call (webhook retry, confirmPayment) sends it.
const EMAIL_CLAIM_MS = 5 * 60 * 1000;

export async function issueLicense(deps, payment) {
  return (await issue(deps, payment)).key;
}

async function issue(deps, payment) {
  const { key, email, ref } = await createLicenseForPayment(deps, payment);
  const activatedFor = await activateForOrder(deps, payment, ref);
  await emailLicenseOnce(deps, { ref, key, email, payment, activatedFor });
  return { key, activatedFor };
}

// An order started from the popup (see checkout.js) names the account it is
// for: Premium is activated there straight away. Only the server's own record
// of the order counts, never notes on the payment, which the payer controls.
// Returns the account's email, or null. It never throws: the buyer still gets
// the key and can activate by hand.
async function activateForOrder(deps, payment, licenseRef) {
  if (!payment.order_id) return null;
  try {
    const order = await deps.db.collection('orders').doc(payment.order_id).get();
    if (!order.exists) return null;
    const { uid, email } = order.data();
    const bound = await bindLicenseToUser(deps, licenseRef, uid);
    return bound.success ? email || 'your SubPIP account' : null;
  } catch (error) {
    log('error', 'auto-activation-failed', { paymentId: payment.id, error: error.message });
    return null;
  }
}

async function emailLicenseOnce(deps, { ref, key, email, payment, activatedFor }) {
  if (!email) return;
  if (!deps.mailer) {
    log('error', 'license-email-skipped', { reason: 'mailer-not-configured', paymentId: payment.id });
    return;
  }
  const nowMs = deps.now().getTime();
  const claimed = await deps.db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.emailedAt) return false;
    if (data.emailClaimedAt && nowMs - data.emailClaimedAt < EMAIL_CLAIM_MS) return false;
    tx.update(ref, { emailClaimedAt: nowMs });
    return true;
  });
  if (!claimed) return;
  if (await sendLicenseEmail(deps, { to: email, keys: [key], payment, activatedFor })) await ref.update({ emailedAt: nowMs });
}

export const RESEND_MESSAGE = "If a purchase exists for that email, we've sent the license to it.";
const RESEND_INTERVAL_MS = 10 * 60 * 1000;
const RESEND_PER_ADDRESS_PER_DAY = 3;
// The email service's free plan sends 100 emails a day in all: this keeps the
// lost-key form from spending the share that purchase emails and alerts need
const RESEND_GLOBAL_PER_DAY = 30;

// "Lost your key?": emails a buyer's keys, only to the purchase email, rate
// limited; the reply never reveals a purchase (the email is sent after it)
export async function resendLicense(data, ctx, deps) {
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpsError('invalid-argument', 'Enter a valid email address');

  const today = day(deps.now());
  const limitRef = deps.db.collection('resend').doc(crypto.createHash('sha256').update(email).digest('hex'));
  const globalRef = deps.db.collection('resend_daily').doc(today);
  const nowMs = deps.now().getTime();
  const allowed = await deps.db.runTransaction(async (tx) => {
    const [limit, global] = await Promise.all([tx.get(limitRef), tx.get(globalRef)]);
    const address = limit.exists ? limit.data() : {};
    const sentToday = address.day === today ? address.count : 0;
    const globalToday = global.exists ? global.data().count : 0;
    if (address.lastSentAt && nowMs - address.lastSentAt < RESEND_INTERVAL_MS) return false;
    if (sentToday >= RESEND_PER_ADDRESS_PER_DAY || globalToday >= RESEND_GLOBAL_PER_DAY) return false;
    tx.set(limitRef, { lastSentAt: nowMs, day: today, count: sentToday + 1 });
    tx.set(globalRef, { count: globalToday + 1 });
    return true;
  });
  if (!allowed) return { message: RESEND_MESSAGE };

  const [byEmail, byLegacyEmail] = await Promise.all([
    deps.db.collection('licenses').where('email', '==', email).get(),
    deps.db.collection('licenses').where('purchaserEmail', '==', email).get()
  ]);
  const keys = [...byEmail.docs, ...byLegacyEmail.docs]
    .map((doc) => doc.data())
    .filter((license) => license.verified === true && !license.revoked)
    .map((license) => license.key);
  if (keys.length) {
    const sending = sendLicenseEmail(deps, { to: email, keys });
    // Reply now and finish sending in the background, so response time
    // doesn't depend on whether a purchase exists
    if (deps.defer) deps.defer(sending);
    else await sending;
  }
  return { message: RESEND_MESSAGE };
}

// Licenses from the old client-side flow have `isValid` instead of `verified`:
// confirm their payment with Razorpay once, then mark them verified
async function ensureLicenseVerified(deps, licenseDoc) {
  const data = licenseDoc.data();
  if (data.verified === true) return true;
  if (!data.paymentId) return false;
  try {
    const payment = await fetchCapturedPayment(deps, data.paymentId, { requireFullPrice: false });
    if (!payment) return false;
    await licenseDoc.ref.update({
      verified: true,
      email: (data.email || data.purchaserEmail || payment.email || '').toLowerCase() || null
    });
    return true;
  } catch {
    return false;
  }
}

// Bind a license to a user and mark them premium, atomically
async function bindLicenseToUser({ db, FieldValue }, licenseRef, uid) {
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(licenseRef)).data();
    if (data.usedBy && data.usedBy !== uid) {
      return { success: false, error: 'License already used by another account' };
    }
    tx.update(licenseRef, { usedBy: uid, activatedAt: data.activatedAt || FieldValue.serverTimestamp() });
    tx.set(db.collection('users').doc(uid), { isPremium: true, licenseKey: data.key }, { merge: true });
    return { success: true, licenseKey: data.key };
  });
}

function requireAuth(ctx) {
  if (!ctx.auth) throw new HttpsError('unauthenticated', 'Please log in first');
  return ctx.auth;
}

// Called by the checkout after Razorpay reports success for an order
export async function confirmPayment(data, ctx, deps) {
  const paymentId = typeof data.paymentId === 'string' ? data.paymentId.trim() : '';
  const orderId = typeof data.orderId === 'string' ? data.orderId.trim() : '';
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^order_[A-Za-z0-9]+$/.test(orderId)) {
    throw new HttpsError('invalid-argument', 'Valid payment and order IDs are required');
  }
  if (!validPaymentSignature(orderId, paymentId, data.signature, deps.keySecret)) {
    throw new HttpsError('invalid-argument', 'Payment signature is invalid');
  }

  let payment;
  try {
    payment = await fetchCapturedPayment(deps, paymentId, { requireFullPrice: true });
  } catch {
    throw new HttpsError('not-found', 'Payment not found');
  }
  if (!payment) throw new HttpsError('failed-precondition', 'Payment not completed');
  if (payment.order_id !== orderId) throw new HttpsError('failed-precondition', 'Payment does not match the order');

  try {
    const { key, activatedFor } = await issue(deps, payment);
    return { licenseKey: key, email: payment.email || null, ...(activatedFor ? { activatedFor } : {}) };
  } catch (error) {
    await alertOwner(deps, 'license-creation-failed', `Payment ${paymentId} was captured but creating the license failed: ${error.message}`, { paymentId, orderId });
    throw new HttpsError('internal', 'Payment received, but creating your license failed. We have been notified.');
  }
}

export async function activateLicense(data, ctx, deps) {
  const { uid } = requireAuth(ctx);
  const key = typeof data.key === 'string' ? data.key.trim().toUpperCase() : '';
  if (!key) throw new HttpsError('invalid-argument', 'License key is required');

  const snap = await deps.db.collection('licenses').where('key', '==', key).limit(1).get();
  if (snap.empty) return { success: false, error: 'Invalid license key' };
  const licenseDoc = snap.docs[0];
  if (licenseDoc.data().revoked) return { success: false, error: 'This license was refunded' };
  if (!(await ensureLicenseVerified(deps, licenseDoc))) return { success: false, error: 'License payment not verified' };
  return bindLicenseToUser(deps, licenseDoc.ref, uid);
}

export async function claimLicenseByEmail(data, ctx, deps) {
  const { uid, token } = requireAuth(ctx);
  const email = (token.email || '').toLowerCase();
  if (!email) throw new HttpsError('failed-precondition', 'Account has no email');
  // Anyone can sign up with a buyer's address; only a verified inbox may claim
  if (!token.email_verified) throw new HttpsError('failed-precondition', 'EMAIL_NOT_VERIFIED');

  const [byEmail, byLegacyEmail] = await Promise.all([
    deps.db.collection('licenses').where('email', '==', email).get(),
    deps.db.collection('licenses').where('purchaserEmail', '==', email).get()
  ]);
  const candidates = [...byEmail.docs, ...byLegacyEmail.docs]
    .filter((doc) => !doc.data().revoked && (!doc.data().usedBy || doc.data().usedBy === uid))
    .sort((a, b) => (b.data().usedBy === uid) - (a.data().usedBy === uid));

  for (const licenseDoc of candidates) {
    if (await ensureLicenseVerified(deps, licenseDoc)) return bindLicenseToUser(deps, licenseDoc.ref, uid);
  }
  return { success: false, error: 'No payment found for this email. Please complete payment first.' };
}

// Premium translation (see translate.js)
export async function translateText(data, ctx, deps) {
  const { uid } = requireAuth(ctx);
  const { text, targetLang } = data;
  if (!text || typeof text !== 'string') throw new HttpsError('invalid-argument', 'Text is required');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpsError('invalid-argument', 'Text is too long');
  if (!targetLang || typeof targetLang !== 'string') throw new HttpsError('invalid-argument', 'Target language is required');

  const user = await deps.db.collection('users').doc(uid).get();
  if (!user.exists || !user.data().isPremium) throw new HttpsError('permission-denied', 'Premium subscription required');

  const { translation, provider } = await translateForUser(deps, uid, text, targetLang);
  return { success: true, translation, provider, sourceText: text, targetLang };
}

// A refund (7-day policy) revokes the license and the Premium it granted
export async function revokeLicenseForRefund(deps, refund, paymentEntity) {
  const licenseDoc = await findLicenseByPaymentId(deps, refund.payment_id);
  if (!licenseDoc) return false;
  return deps.db.runTransaction(async (tx) => {
    const license = (await tx.get(licenseDoc.ref)).data();
    // Only a full refund cancels Premium; partial (goodwill) refunds don't
    const fullRefund = paymentEntity?.refund_status === 'full'
      || (typeof refund.amount === 'number' && typeof license.amount === 'number' && refund.amount >= license.amount);
    if (!fullRefund) return false;
    const userRef = license.usedBy ? deps.db.collection('users').doc(license.usedBy) : null;
    const user = userRef ? await tx.get(userRef) : null;
    tx.update(licenseDoc.ref, { revoked: true, revokedAt: deps.FieldValue.serverTimestamp(), refundId: refund.id || null });
    if (user && user.exists && user.data().licenseKey === license.key) tx.update(userRef, { isPremium: false, licenseKey: null });
    return true;
  });
}
