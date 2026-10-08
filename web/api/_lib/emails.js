// The license email (key, how to activate, receipt) and sending it safely
import { alertOwner } from './alerts.js';
import { log } from './log.js';
import { emailLayout, escapeHtml, FONT, MONO, TABLE } from './email-layout.js';

export const SUPPORT_EMAIL = 'tarunmonga2208@gmail.com';
const SITE_URL = 'https://subpip.online';
const REFUND_NOTE = 'Not happy? You can get a full refund within 7 days of purchase, no questions asked.';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 8 October 2027
export function formatDay(ms) {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
}

// Inline text style: size in px, color, then anything else
const type = (size, color, more = '') => `font-family:${FONT};font-size:${size}px;line-height:1.55;color:${color};${more}`;
const LABEL = type(11, '#71717a', 'font-weight:600;letter-spacing:.08em;text-transform:uppercase');
const link = (href, label) => `<a class="link" href="${href}" style="color:#c81e3a">${label}</a>`;

function keyBox(key, label) {
  return `<table ${TABLE} width="100%" style="margin:0 0 12px"><tr><td class="keybox" style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:16px 18px">
<div class="soft" style="${LABEL}">${label}</div>
<div class="key ink" style="margin-top:6px;font-family:${MONO};font-size:20px;font-weight:700;line-height:1.4;letter-spacing:.02em;color:#18181b">${escapeHtml(key)}</div>
</td></tr></table>`;
}

function stepRows(steps) {
  return `<table ${TABLE} width="100%">${steps.map((step, i) => `<tr>
<td width="24" valign="top" style="padding:0 0 10px"><div class="num" style="width:24px;height:24px;border-radius:12px;background:#18181b;text-align:center;${type(12, '#ffffff', 'font-weight:700;line-height:24px')}">${i + 1}</div></td>
<td valign="top" class="ink" style="padding:1px 0 10px 12px;${type(15, '#18181b')}">${escapeHtml(step)}</td>
</tr>`).join('')}</table>`;
}

function receiptRows(amount, paymentId, what = 'SubPIP Premium, lifetime') {
  return `<table ${TABLE} class="rule" width="100%" style="margin:28px 0 0;border-top:1px solid #e4e4e7">
<tr><td colspan="2" class="soft" style="padding:18px 0 8px;${LABEL}">Receipt</td></tr>
<tr><td class="ink" style="padding:3px 0;${type(14, '#18181b')}">${escapeHtml(what)}</td><td align="right" class="ink" style="padding:3px 0;${type(14, '#18181b', 'font-weight:600;white-space:nowrap')}">${escapeHtml(amount)}</td></tr>
<tr><td class="soft" style="padding:3px 0;${type(13, '#71717a')}">Payment ID</td><td align="right" class="soft" style="padding:3px 0;font-family:${MONO};font-size:13px;line-height:1.55;color:#71717a">${escapeHtml(paymentId)}</td></tr>
</table>`;
}

// activatedFor: the account Premium was already activated on (a purchase
// started from the popup), so there is nothing left to paste
// until: for a one-year licence, when it ends
export function licenseEmail({ keys, payment, activatedFor, until = null }) {
  const plural = keys.length > 1;
  const active = activatedFor
    ? `Premium is already active on ${activatedFor}: open SubPIP and it is there. Keep this key as your proof of purchase.`
    : '';
  const steps = [
    'Click the SubPIP icon in your browser.',
    'Sign in (or create an account) with this email address.',
    'Open Account & license, paste the key and press Activate.'
  ];
  const amount = payment ? formatAmount(payment.amount, payment.currency) : '';
  const keyAgainUrl = `${SITE_URL}/premium.html`;
  const subject = 'Your SubPIP Premium license';

  const text = [
    `Thanks for getting SubPIP Premium!`,
    '',
    `Your license key${plural ? 's' : ''}:`,
    ...keys.map((key) => `  ${key}`),
    '',
    ...(active ? [active] : ['To activate:', ...steps.map((step, i) => `  ${i + 1}. ${step}`)]),
    '',
    payment ? `Receipt: ${amount} · ${until ? `one year of Premium, until ${formatDay(until)}` : 'lifetime Premium'} · payment ${payment.id}` : '',
    until ? 'It will not renew by itself: nothing more is charged unless you buy again.' : '',
    REFUND_NOTE,
    '',
    `Questions? Just reply to this email, or write to ${SUPPORT_EMAIL}.`,
    `Lost this email later? Get your key again at ${keyAgainUrl}`
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');

  const content = `<h1 class="ink" style="margin:0 0 8px;${type(22, '#18181b', 'font-weight:700;line-height:1.3')}">Your SubPIP Premium license${plural ? ' keys' : ''}</h1>
<p class="soft" style="margin:0 0 24px;${type(15, '#52525b')}">Thanks for getting SubPIP Premium! Your license key${plural ? 's are' : ' is'} below.</p>
${keys.map((key, i) => keyBox(key, plural ? `License key ${i + 1}` : 'Your license key')).join('\n')}
${active
    ? `<table ${TABLE} width="100%" style="margin:16px 0 0"><tr><td class="done" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 16px;${type(15, '#065f46')}"><strong>You are all set.</strong> ${escapeHtml(active)}</td></tr></table>`
    : `<h2 class="ink" style="margin:28px 0 14px;${type(16, '#18181b', 'font-weight:700')}">Activate it</h2>\n${stepRows(steps)}`}
${payment ? receiptRows(amount, payment.id, until ? `SubPIP Premium, one year (until ${formatDay(until)})` : undefined) : ''}
<p class="soft" style="margin:24px 0 0;${type(14, '#52525b')}">${REFUND_NOTE}</p>
<p class="soft" style="margin:8px 0 0;${type(14, '#52525b')}">Questions? Just reply to this email, or write to ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}.</p>`;

  const footer = `<p class="soft" style="margin:0 0 6px;${type(12, '#71717a')}">Lost this email later? Get your key again any time at ${link(keyAgainUrl, 'subpip.online/premium.html')}.</p>
<p class="soft" style="margin:0;${type(12, '#71717a')}">You are getting this email because this address was used to buy SubPIP Premium.<br>${link(`${SITE_URL}/refund.html`, 'Refunds')} &middot; ${link(`${SITE_URL}/privacy.html`, 'Privacy')} &middot; ${link(`${SITE_URL}/contact.html`, 'Contact')}</p>`;

  const preview = active
    ? 'Premium is already active. Here is your key and your receipt.'
    : `Your license key${plural ? 's' : ''} and how to activate ${plural ? 'them' : 'it'}.`;
  return { subject, text, html: emailLayout({ title: subject, preview, content, footer, logoUrl: `${SITE_URL}/logo.png` }) };
}

// Never throws; a failure is logged and alerted, and the caller carries on
export async function sendLicenseEmail(deps, { to, keys, payment, activatedFor, until }) {
  if (!to) {
    log('warn', 'license-email-skipped', { reason: 'no-email', paymentId: payment?.id });
    return false;
  }
  if (!deps.mailer) {
    log('error', 'license-email-skipped', { reason: 'mailer-not-configured', paymentId: payment?.id });
    return false;
  }
  try {
    await deps.mailer.send({ to, ...licenseEmail({ keys, payment, activatedFor, until }) });
    log('info', 'license-email-sent', { paymentId: payment?.id });
    return true;
  } catch (error) {
    await alertOwner(deps, 'license-email-failed', `Could not email a license: ${error.message}`, { paymentId: payment?.id });
    return false;
  }
}

// The two notes about a one-year pass: a week before it ends, and when it has
export function passEmail({ kind, until }) {
  const renewUrl = `${SITE_URL}/premium.html`;
  const reminder = kind === 'reminder';
  const subject = reminder ? `Your year of SubPIP Premium ends on ${formatDay(until)}` : 'Your year of SubPIP Premium has ended';
  const lines = reminder
    ? [`Your year of SubPIP Premium ends on ${formatDay(until)}.`, 'It will not renew by itself and nothing will be charged.', `If you would like another year, or lifetime Premium, you can get it here: ${renewUrl}`, 'A year bought before the end is added on to the one you have.']
    : [`Your year of SubPIP Premium ended on ${formatDay(until)}.`, 'Nothing was charged, and SubPIP keeps working without the Premium features.', `If you would like them back, for another year or for good: ${renewUrl}`];
  const text = [...lines, '', `Questions? Just reply to this email, or write to ${SUPPORT_EMAIL}.`].join('\n');
  const content = `<h1 class="ink" style="margin:0 0 16px;${type(22, '#18181b', 'font-weight:700;line-height:1.3')}">${escapeHtml(subject)}</h1>
${lines.slice(1).map((line) => `<p class="soft" style="margin:0 0 12px;${type(15, '#52525b')}">${escapeHtml(line).replace(renewUrl, link(renewUrl, 'subpip.online/premium.html'))}</p>`).join('\n')}
<p class="soft" style="margin:16px 0 0;${type(14, '#52525b')}">Questions? Just reply to this email, or write to ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}.</p>`;
  const footer = `<p class="soft" style="margin:0;${type(12, '#71717a')}">You are getting this email because this address was used to buy a year of SubPIP Premium.<br>${link(`${SITE_URL}/privacy.html`, 'Privacy')} &middot; ${link(`${SITE_URL}/contact.html`, 'Contact')}</p>`;
  return { subject, text, html: emailLayout({ title: subject, preview: lines[1], content, footer, logoUrl: `${SITE_URL}/logo.png` }) };
}
