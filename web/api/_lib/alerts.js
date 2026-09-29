// Owner alerts by email, throttled per type per UTC day. Never throws: an
// alert must not turn a handled problem into a crash.
import { log } from './log.js';

const MAX_PER_TYPE_PER_DAY = 3;

export const day = (date) => date.toISOString().slice(0, 10);

export async function alertOwner(deps, type, message, details = {}) {
  log('error', `alert:${type}`, { message, ...details });
  try {
    if (!deps?.mailer || !deps.alertTo || !deps.db) return false;
    const ref = deps.db.collection('alerts').doc(`${type}_${day(deps.now())}`);
    const allowed = await deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? snap.data().count : 0;
      if (count >= MAX_PER_TYPE_PER_DAY) return false;
      tx.set(ref, { count: count + 1 }, { merge: true });
      return true;
    });
    if (!allowed) return false;
    await deps.mailer.send({
      to: deps.alertTo,
      subject: `[SubPIP alert] ${type}`,
      text: `${message}\n\n${JSON.stringify(details, null, 2)}\n\n(At most ${MAX_PER_TYPE_PER_DAY} "${type}" alerts are sent per day.)`
    });
    return true;
  } catch (error) {
    log('error', 'alert-failed', { type, error: error.message });
    return false;
  }
}
