// The daily look at the one-year passes: a week before one ends its buyer is
// reminded, once; when it has ended, Premium is switched off for the account
// it was on and the buyer is told. Nothing is ever charged here. Safe to run
// any number of times: each licence is marked as it is dealt with.
import { passEmail } from './emails.js';
import { log } from './log.js';

const REMIND_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

async function tell(deps, license, kind) {
  if (!license.email || !deps.mailer) return;
  await deps.mailer.send({ to: license.email, ...passEmail({ kind, until: license.expiresAt }) })
    .catch((error) => log('error', 'pass-email-failed', { kind, paymentId: license.paymentId, error: error.message }));
}

// Whether the licence is still what its buyer has: unused (so the key is all
// they have) or the one in use on their account. Replaced by a later year or
// by lifetime, its end is of no interest to them.
async function stillTheirs(deps, license) {
  if (!license.usedBy) return true;
  const user = await deps.db.collection('users').doc(license.usedBy).get();
  return user.exists && user.data().licenseKey === license.key;
}

export async function endFinishedPasses(data, ctx, deps) {
  const at = deps.now().getTime();
  const passes = await deps.db.collection('licenses').where('plan', '==', 'year').get();
  let reminded = 0;
  let ended = 0;
  for (const doc of passes.docs) {
    const license = doc.data();
    if (license.revoked || license.ended || typeof license.expiresAt !== 'number') continue;
    if (license.expiresAt <= at) {
      const theirs = await stillTheirs(deps, license);
      const done = await deps.db.runTransaction(async (tx) => {
        const now = (await tx.get(doc.ref)).data();
        if (now.ended || now.revoked || now.expiresAt > at) return false;
        const userRef = now.usedBy ? deps.db.collection('users').doc(now.usedBy) : null;
        const user = userRef ? await tx.get(userRef) : null;
        tx.update(doc.ref, { ended: true });
        // Only where this is still the licence in use: a year bought since, or lifetime, stays
        if (user && user.exists && user.data().licenseKey === now.key) tx.update(userRef, { isPremium: false, licenseKey: null, premiumUntil: null });
        return now;
      });
      if (done) {
        ended++;
        if (theirs) await tell(deps, done, 'ended');
      }
    } else if (license.expiresAt - at <= REMIND_BEFORE_MS && !license.remindedAt) {
      await doc.ref.update({ remindedAt: at });
      if (!(await stillTheirs(deps, license))) continue;
      reminded++;
      await tell(deps, license, 'reminder');
    }
  }
  return { ok: true, reminded, ended };
}
