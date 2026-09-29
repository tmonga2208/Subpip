// Razorpay Orders: the server fixes the amount; the payment signature proves
// Razorpay processed this payment for this order.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { PRICES } from './pricing.js';

export async function createOrder(data, ctx, deps) {
  const currency = data.currency;
  if (!Object.hasOwn(PRICES, currency)) throw new HttpsError('invalid-argument', 'Unsupported currency');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase().slice(0, 254) : '';
  const order = await deps.razorpay.orders.create({
    amount: PRICES[currency],
    currency,
    receipt: `subpip_${deps.now().getTime()}`,
    notes: email ? { email } : {}
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: deps.keyId };
}

export function validPaymentSignature(orderId, paymentId, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
