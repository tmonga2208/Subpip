// Feedback from the page shown after SubPIP is uninstalled (uninstalled.html).
// It is anonymous: a reason, an optional comment and the extension version.
// Each answer is stored and emailed to the owner, within daily caps so a flood
// can neither fill the database nor use up the Gmail allowance that license
// emails depend on.
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
const MAX_COMMENT_LENGTH = 1000;
const STORED_PER_DAY = 300;
const EMAILED_PER_DAY = 20;

export async function sendFeedback(data, ctx, deps) {
  const reason = typeof data.reason === 'string' && Object.hasOwn(FEEDBACK_REASONS, data.reason) ? data.reason : null;
  if (!reason) throw new HttpsError('invalid-argument', 'Choose a reason');
  const comment = typeof data.comment === 'string' ? data.comment.trim().slice(0, MAX_COMMENT_LENGTH) : '';
  const version = typeof data.version === 'string' && /^\d[\d.]{0,11}$/.test(data.version) ? data.version : null;

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
  await deps.db.collection('feedback').doc(id).set({ reason, comment, version, createdAt: deps.FieldValue.serverTimestamp() });

  if (position <= EMAILED_PER_DAY && deps.mailer && deps.alertTo) {
    const sending = deps.mailer.send({
      to: deps.alertTo,
      subject: `[SubPIP feedback] ${FEEDBACK_REASONS[reason]}`,
      text: `Someone uninstalled SubPIP${version ? ` ${version}` : ''}.\n\nWhy: ${FEEDBACK_REASONS[reason]}\n\n${comment || '(no comment)'}`
    }).catch((error) => log('error', 'feedback-email-failed', { error: error.message }));
    // Reply now and finish sending in the background
    if (deps.defer) deps.defer(sending);
    else await sending;
  }
  return { ok: true };
}
