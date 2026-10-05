// Razorpay webhook: a backup path that creates the license even if the buyer
// closes the checkout before confirmPayment runs. The signature is checked
// against the raw body, byte for byte as Razorpay sent it.

import crypto from 'node:crypto';
import { isAcceptedPayment } from './pricing.js';
import { issueLicense, revokeLicenseForRefund, alertPaymentRejected } from './licensing.js';
import { alertOwner } from './alerts.js';

// By listening, not by iterating the request: Vercel's helpers have already
// read the body once to offer req.body, and they put it back for 'data' and
// 'end' listeners only. A `for await` over the request finds nothing there.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
      // A wrong or rotated RAZORPAY_WEBHOOK_SECRET would otherwise fail silently.
      // The size tells that apart from a body that never reached this code.
      await alertOwner(deps, 'webhook-signature', 'A Razorpay webhook had an invalid signature. Check RAZORPAY_WEBHOOK_SECRET matches the webhook in Razorpay.', { bytes: rawBody.length });
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
