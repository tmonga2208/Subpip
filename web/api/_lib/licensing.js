// Premium licensing: licenses are only created and activated here, never by
// clients (see firestore.rules). Dependencies are passed in so tests can use
// fakes: { db, FieldValue, razorpay, fetch, myMemoryEmail }.

import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { isAcceptedPayment } from './pricing.js';

export function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const timestamp = Date.now().toString(36).toUpperCase();
  let key = 'SUBPIP-';
  for (let i = 0; i < 8; i++) key += chars.charAt(crypto.randomInt(chars.length));
  return `${key}-${timestamp.slice(-4)}`;
}

// Re-fetch the payment from Razorpay: it must be real, captured, and (for new
// purchases) at least the price in its currency
async function fetchCapturedPayment({ razorpay }, paymentId, { requireFullPrice }) {
  let payment = await razorpay.payments.fetch(paymentId);
  if (payment.status === 'authorized') {
    payment = await razorpay.payments.capture(paymentId, payment.amount, payment.currency);
  }
  if (payment.status !== 'captured' || !isAcceptedPayment(payment, { requireFullPrice })) return null;
  return payment;
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
  if (existing) return existing.data().key;

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
    if (error.code === 6) return (await ref.get()).data().key; // ALREADY_EXISTS
    throw error;
  }
  return licenseKey;
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

// Called by the checkout page after Razorpay reports success
export async function confirmPayment(data, ctx, deps) {
  const paymentId = typeof data.paymentId === 'string' ? data.paymentId.trim() : '';
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new HttpsError('invalid-argument', 'Valid payment ID is required');

  let payment;
  try {
    payment = await fetchCapturedPayment(deps, paymentId, { requireFullPrice: true });
  } catch {
    throw new HttpsError('not-found', 'Payment not found');
  }
  if (!payment) throw new HttpsError('failed-precondition', 'Payment not completed');

  const licenseKey = await createLicenseForPayment(deps, payment);
  return { licenseKey, email: payment.email || null };
}

export async function activateLicense(data, ctx, deps) {
  const { uid } = requireAuth(ctx);
  const key = typeof data.key === 'string' ? data.key.trim().toUpperCase() : '';
  if (!key) throw new HttpsError('invalid-argument', 'License key is required');

  const snap = await deps.db.collection('licenses').where('key', '==', key).limit(1).get();
  if (snap.empty) return { success: false, error: 'Invalid license key' };
  const licenseDoc = snap.docs[0];
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
    .filter((doc) => !doc.data().usedBy || doc.data().usedBy === uid)
    .sort((a, b) => (b.data().usedBy === uid) - (a.data().usedBy === uid));

  for (const licenseDoc of candidates) {
    if (await ensureLicenseVerified(deps, licenseDoc)) return bindLicenseToUser(deps, licenseDoc.ref, uid);
  }
  return { success: false, error: 'No payment found for this email. Please complete payment first.' };
}

// Premium translation via MyMemory; a contact email raises its free daily limit
export async function translateText(data, ctx, deps) {
  const { uid } = requireAuth(ctx);
  const { text, targetLang } = data;
  if (!text || typeof text !== 'string') throw new HttpsError('invalid-argument', 'Text is required');
  if (!targetLang || typeof targetLang !== 'string') throw new HttpsError('invalid-argument', 'Target language is required');

  const user = await deps.db.collection('users').doc(uid).get();
  if (!user.exists || !user.data().isPremium) throw new HttpsError('permission-denied', 'Premium subscription required');

  const params = new URLSearchParams({ q: text, langpair: `Autodetect|${targetLang}` });
  if (deps.myMemoryEmail) params.set('de', deps.myMemoryEmail);
  const response = await deps.fetch(`https://api.mymemory.translated.net/get?${params}`);
  const body = await response.json();
  if (body.responseStatus !== 200 || !body.responseData?.translatedText) throw new HttpsError('internal', 'Translation failed');
  return { success: true, translation: body.responseData.translatedText, sourceText: text, targetLang };
}
