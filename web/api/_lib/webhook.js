// Razorpay webhook: a backup path that creates the license even if the buyer
// closes the checkout before confirmPayment runs. The signature is checked
// against the raw body, so it must be read before anything parses it.

import crypto from 'node:crypto';
import { isAcceptedPayment } from './pricing.js';
import { issueLicense, revokeLicenseForRefund, alertPaymentRejected } from './licensing.js';
import { alertOwner } from './alerts.js';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function validSignature(rawBody, signature, secret) {
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function handleWebhook(req, res, deps) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  let event;
  let paymentId;
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature || !deps.webhookSecret) return res.status(400).send('Bad Request');

    const rawBody = await readRawBody(req);
    if (!validSignature(rawBody, signature, deps.webhookSecret)) {
      // A wrong or rotated RAZORPAY_WEBHOOK_SECRET would otherwise fail silently
      await alertOwner(deps, 'webhook-signature', 'A Razorpay webhook had an invalid signature. Check RAZORPAY_WEBHOOK_SECRET matches the webhook in Razorpay.');
      return res.status(401).send('Unauthorized');
    }

    const body = JSON.parse(rawBody.toString('utf8'));
    event = body.event;
    if (body.event === 'refund.processed') {
      paymentId = body.payload.refund.entity.payment_id;
      const revoked = await revokeLicenseForRefund(deps, body.payload.refund.entity, body.payload.payment?.entity);
      return res.status(200).json({ success: true, revoked });
    }
    if (body.event !== 'payment.captured') return res.status(200).send('Event ignored');

    const payment = body.payload.payment.entity;
    paymentId = payment.id;
    if (!isAcceptedPayment(payment)) {
      await alertPaymentRejected(deps, payment);
      return res.status(200).send('Ignored: amount mismatch');
    }

    await issueLicense(deps, payment);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[api] Webhook error:', error);
    await alertOwner(deps, event === 'payment.captured' ? 'license-creation-failed' : 'internal-error',
      `Razorpay webhook ${event || '(unparsed)'} failed: ${error.message}`, { paymentId });
    return res.status(500).send('Internal Server Error');
  }
}
