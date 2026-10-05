// Buying from the popup while signed in. The popup asks for a checkout code
// and opens the checkout page with it; the order made there is then tied to
// the account, and the captured payment activates Premium on it by itself
// (see licensing.js). The code only says "this purchase is for that account".
// It travels after the "#" of the page's address, which is sent to no server.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';

const CHECKOUT_LIFETIME_MS = 2 * 60 * 60 * 1000;

export async function startCheckout(data, ctx, deps) {
  if (!ctx.auth) throw new HttpsError('unauthenticated', 'Please log in first');
  const code = crypto.randomBytes(18).toString('base64url');
  await deps.db.collection('checkouts').doc(code).set({
    uid: ctx.auth.uid,
    email: (ctx.auth.token?.email || '').toLowerCase() || null,
    createdAt: deps.now().getTime()
  });
  return { code };
}

// The account a checkout code stands for; null when it is missing, malformed,
// unknown or older than two hours (the order is then an ordinary one)
export async function accountForCheckout(deps, code) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const snap = await deps.db.collection('checkouts').doc(code).get();
  if (!snap.exists) return null;
  const { uid, email, createdAt } = snap.data();
  if (deps.now().getTime() - createdAt > CHECKOUT_LIFETIME_MS) return null;
  return { uid, email };
}
