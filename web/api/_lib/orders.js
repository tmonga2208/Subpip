// Razorpay Orders: the server fixes the amount; the payment signature proves
// Razorpay processed this payment for this order.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { PRICES, priceFor } from './pricing.js';
import { accountForCheckout } from './checkout.js';
import { log } from './log.js';

export async function createOrder(data, ctx, deps) {
  const currency = data.currency;
  if (!Object.hasOwn(PRICES, currency)) throw new HttpsError('invalid-argument', 'Unsupported currency');
  // The plan and price level are the buyer's to choose; the amount never is
  const plan = data.plan === undefined ? 'lifetime' : data.plan;
  const amount = priceFor({ currency, plan, tier: data.tier === undefined ? 'standard' : data.tier });
  if (amount === null) throw new HttpsError('invalid-argument', 'Unsupported plan');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase().slice(0, 254) : '';
  const order = await deps.razorpay.orders.create({
    amount,
    currency,
    receipt: `subpip_${deps.now().getTime()}`,
    notes: { plan, ...(email ? { email } : {}) }
  });
  const account = await recordAccount(deps, data.checkout, order.id);
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: deps.keyId, ...(plan === 'year' ? { plan } : {}), ...(account ? { accountEmail: account.email } : {}) };
}

// Started from the popup while signed in: the order is recorded for that
// account, so its payment can activate Premium there without a key. If this
// fails the purchase goes ahead as an ordinary one (the buyer pastes the key).
async function recordAccount(deps, checkoutCode, orderId) {
  try {
    const account = await accountForCheckout(deps, checkoutCode);
    if (!account) return null;
    await deps.db.collection('orders').doc(orderId).set({ uid: account.uid, email: account.email, createdAt: deps.now().getTime() });
    return account;
  } catch (error) {
    log('error', 'checkout-account-failed', { orderId, error: error.message });
    return null;
  }
}

export function validPaymentSignature(orderId, paymentId, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
