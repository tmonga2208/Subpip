// The license email (key, how to activate, receipt) and sending it safely
import { alertOwner } from './alerts.js';
import { log } from './log.js';

const SUPPORT_EMAIL = 'tarunmonga2208@gmail.com';

export function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// activatedFor: the account Premium was already activated on (a purchase
// started from the popup), so there is nothing left to paste
export function licenseEmail({ keys, payment, activatedFor }) {
  const plural = keys.length > 1;
  const active = activatedFor
    ? `Premium is already active on ${activatedFor}: open SubPIP and it is there. Keep this key as your proof of purchase.`
    : '';
  const steps = [
    'Click the SubPIP icon in your browser.',
    'Sign in (or create an account) with this email address.',
    'Open Account & license, paste the key and press Activate.'
  ];
  const receipt = payment
    ? `Receipt: ${formatAmount(payment.amount, payment.currency)} · lifetime Premium · payment ${payment.id}`
    : '';
  const text = [
    `Thanks for getting SubPIP Premium!`,
    '',
    `Your license key${plural ? 's' : ''}:`,
    ...keys.map((key) => `  ${key}`),
    '',
    ...(active ? [active] : ['To activate:', ...steps.map((step, i) => `  ${i + 1}. ${step}`)]),
    '',
    receipt,
    'Not happy? You can get a full refund within 7 days of purchase, no questions asked.',
    `Questions: ${SUPPORT_EMAIL}`
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,system-ui,sans-serif;max-width:520px;color:#111">
<h2 style="margin:0 0 12px">Your SubPIP Premium license</h2>
<p>Thanks for getting SubPIP Premium!</p>
${keys.map((key) => `<p style="font:600 18px ui-monospace,Menlo,monospace;background:#f4f4f5;padding:12px 14px;border-radius:8px">${escapeHtml(key)}</p>`).join('')}
${active ? `<p>${escapeHtml(active)}</p>` : `<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`}
${receipt ? `<p style="color:#555">${escapeHtml(receipt)}</p>` : ''}
<p style="color:#555">Not happy? You can get a full refund within 7 days of purchase, no questions asked.</p>
<p style="color:#555">Questions: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
</div>`;
  return { subject: 'Your SubPIP Premium license', text, html };
}

// Never throws; a failure is logged and alerted, and the caller carries on
export async function sendLicenseEmail(deps, { to, keys, payment, activatedFor }) {
  if (!to) {
    log('warn', 'license-email-skipped', { reason: 'no-email', paymentId: payment?.id });
    return false;
  }
  if (!deps.mailer) {
    log('error', 'license-email-skipped', { reason: 'mailer-not-configured', paymentId: payment?.id });
    return false;
  }
  try {
    await deps.mailer.send({ to, ...licenseEmail({ keys, payment, activatedFor }) });
    log('info', 'license-email-sent', { paymentId: payment?.id });
    return true;
  } catch (error) {
    await alertOwner(deps, 'license-email-failed', `Could not email a license: ${error.message}`, { paymentId: payment?.id });
    return false;
  }
}
