// POST /api/razorpayWebhook — Razorpay payment.captured events (see _lib/webhook.js)
import { handleWebhook } from './_lib/webhook.js';
import { liveDeps } from './_lib/deps.js';

export default async function handler(req, res) {
  let deps;
  try {
    deps = liveDeps();
  } catch (error) {
    console.error('[api] Webhook not configured:', error.message);
    return res.status(500).send('Server not configured');
  }
  return handleWebhook(req, res, deps);
}
