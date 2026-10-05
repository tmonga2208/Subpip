// What people tell the owner through the site's two forms: why they
// uninstalled SubPIP (uninstalled.html), and what did not work on a site
// (report.html, opened from the popup). Both are anonymous: the choice, an
// optional comment, the extension version and, for a report, the site's name.
// Each one is stored and emailed to the owner, within daily caps so a flood
// can neither fill the database nor use up the daily email allowance that
// license emails depend on.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { day } from './alerts.js';
import { log } from './log.js';

export const FEEDBACK_REASONS = {
  site: "It didn't work on the site I use",
  captions: "Captions didn't show in Picture-in-Picture",
  premium: 'Too much needs Premium',
  done: 'I only needed it for a while',
  'other-tool': 'I found something else',
  other: 'Something else'
};
export const PROBLEMS = {
  captions: "Captions don't show in the window",
  window: "The window doesn't open",
  controls: "The controls don't work",
  other: 'Something else'
};
const MAX_COMMENT_LENGTH = 1000;
const MAX_SITE_LENGTH = 100;
const STORED_PER_DAY = 300;
const EMAILED_PER_DAY = 20;

// The name of the site and nothing else: a pasted link loses its path, and
// what is not a host name is dropped
export function siteName(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
  const label = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
  return host.length <= MAX_SITE_LENGTH && new RegExp(`^${label}(\\.${label})*$`).test(host) ? host : null;
}

const commentOf = (data) => (typeof data.comment === 'string' ? data.comment.trim().slice(0, MAX_COMMENT_LENGTH) : '');
const versionOf = (data) => (typeof data.version === 'string' && /^\d[\d.]{0,11}$/.test(data.version) ? data.version : null);
const choiceOf = (value, choices) => (typeof value === 'string' && Object.hasOwn(choices, value) ? value : null);

// What to keep and what to tell the owner: { record, subject, text }
function uninstallAnswer(data) {
  const reason = choiceOf(data.reason, FEEDBACK_REASONS);
  if (!reason) throw new HttpsError('invalid-argument', 'Choose a reason');
  const comment = commentOf(data);
  const version = versionOf(data);
  return {
    record: { reason, comment, version },
    subject: `[SubPIP feedback] ${FEEDBACK_REASONS[reason]}`,
    text: `Someone uninstalled SubPIP${version ? ` ${version}` : ''}.\n\nWhy: ${FEEDBACK_REASONS[reason]}\n\n${comment || '(no comment)'}`
  };
}

function problemReport(data) {
  const problem = choiceOf(data.problem, PROBLEMS);
  if (!problem) throw new HttpsError('invalid-argument', 'Choose what went wrong');
  const site = siteName(data.site);
  const comment = commentOf(data);
  const version = versionOf(data);
  return {
    record: { kind: 'problem', problem, site, comment, version },
    subject: `[SubPIP problem] ${site || 'no site given'}: ${PROBLEMS[problem]}`,
    text: `Someone reported a problem with SubPIP${version ? ` ${version}` : ''}.\n\nSite: ${site || '(not given)'}\nWhat: ${PROBLEMS[problem]}\n\n${comment || '(no comment)'}`
  };
}

export async function sendFeedback(data, ctx, deps) {
  const { record, subject, text } = data.kind === 'problem' ? problemReport(data) : uninstallAnswer(data);

  const counterRef = deps.db.collection('feedback_daily').doc(day(deps.now()));
  const position = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const count = snap.exists ? snap.data().count : 0;
    if (count >= STORED_PER_DAY) return null;
    tx.set(counterRef, { count: count + 1 });
    return count + 1;
  });
  // Over the cap the visitor is still thanked; there is nothing they can do about it
  if (position === null) return { ok: true };

  const id = `${deps.now().getTime()}_${crypto.randomBytes(4).toString('hex')}`;
  await deps.db.collection('feedback').doc(id).set({ ...record, createdAt: deps.FieldValue.serverTimestamp() });

  if (position <= EMAILED_PER_DAY && deps.mailer && deps.alertTo) {
    const sending = deps.mailer.send({ to: deps.alertTo, subject, text })
      .catch((error) => log('error', 'feedback-email-failed', { error: error.message }));
    // Reply now and finish sending in the background
    if (deps.defer) deps.defer(sending);
    else await sending;
  }
  return { ok: true };
}
