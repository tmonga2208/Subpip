# Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SubPIP safe to sell: account-based Premium, DeepL translation behind a cache and per-user cap, policy pages with refund revocation, emailed licenses and a lost-key form, Razorpay Orders with signature verification, and owner alerts plus a health check.

**Architecture:** Server code stays in Vercel Functions (`web/api/`), each endpoint a thin wrapper over dependency-injected library modules in `web/api/_lib/`. New library modules: `log.js`, `mailer.js`, `alerts.js`, `emails.js`, `translate.js`, `orders.js` (signature). `deps.js` builds live dependencies from env vars and reports config presence for `/api/health`. The extension drops its device fingerprint; the checkout page moves to `createOrder` → Razorpay → `confirmPayment(signature)`.

**Tech Stack:** Node 24 (Vercel), firebase-admin 13, razorpay SDK, nodemailer (Gmail SMTP), DeepL API Free over `fetch`; `node:test` + puppeteer-core (existing harness).

**Spec:** `docs/superpowers/specs/2026-09-29-production-hardening-design.md`

## Global Constraints

- Premium is per account, no device limit; the server never reads or writes `deviceId`.
- Translation: cache `translations/{sha256(lang+"\n"+text)}`; per-user cap **60,000** new characters per UTC day (`usage/{uid}_{YYYY-MM-DD}`); DeepL targets en→`EN-US`, es→`ES`, fr→`FR`, de→`DE`, it→`IT`, pt→`PT-BR`, zh→`ZH-HANS`, ja→`JA`, ko→`KO`, ar→`AR`, ru→`RU`; other languages unsupported on the server; the server never calls MyMemory.
- Refunds: 7 days, no questions; `refund.processed` revokes the license and the bound user's Premium.
- License email sent exactly once, by the call that created the license; failure never fails the purchase.
- Lost-key: one email per address per **10 minutes**; generic reply: "If a purchase exists for that email, we've sent the license to it."
- Orders: amount always from the server price table (INR 100000, USD 1500); signature `HMAC_SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)` checked in constant time; payment `order_id` must equal the order.
- Alerts: `ALERT_EMAIL` or `GMAIL_USER`; max **3** per type per UTC day; alert code never throws.
- Health: required = firebase, razorpay, webhook, email; `200` when all present else `503`; values never exposed.
- New Firestore collections are server-only (current rules already deny unspecified paths).
- Lint and all tests pass after every task.

## Review Focus

- **Razorpay retries or duplicate webhooks for the same payment:** exactly one license and one email. Pinned in Task 3.
- **Someone probing the lost-key form with others' emails:** the reply never reveals whether a purchase exists, and nothing is sent to any address but the purchase email. Pinned in Task 3.
- **A tampered checkout (changed amount, reused order, forged signature):** no license. Pinned in Task 4.
- **Very long "caption" strings sent to translation to burn the quota:** rejected before counting. Pinned in Task 5.
- **Alert storms (a broken dependency failing every request):** at most 3 emails per type per day. Pinned in Task 2.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/api/_lib/log.js` | create | JSON log lines |
| `web/api/_lib/mailer.js` | create | Gmail SMTP transport (`send`) |
| `web/api/_lib/alerts.js` | create | Throttled owner alerts, `day()` helper |
| `web/api/_lib/emails.js` | create | License email content + `sendLicenseEmail` |
| `web/api/_lib/orders.js` | create | Order creation, payment signature check |
| `web/api/_lib/translate.js` | create | Cache, cap, DeepL |
| `web/api/_lib/http.js` | modify | New statuses; alert on unexpected errors |
| `web/api/_lib/licensing.js` | modify | No device ids; `issueLicense`; revoked; `resendLicense`; `confirmPayment` with signature; `translateText` via `translate.js` |
| `web/api/_lib/webhook.js` | modify | `issueLicense`; `refund.processed` |
| `web/api/_lib/deps.js` | modify | mailer, keys, clock, `configStatus()` |
| `web/api/createOrder.js`, `resendLicense.js`, `health.js` | create | Endpoints |
| `web/package.json` | modify | `nodemailer` |
| `src/popup/license-manager.js`, `auth.js`, `account.js` | modify | Remove device lock |
| `web/premium.html` | modify | Orders flow, lost-key form, policy agreement line |
| `web/terms.html`, `web/refund.html`, `web/contact.html` | create | Policy pages |
| `web/index.html`, `web/privacy.html`, `web/premium.html` | modify | Footer links; privacy text |
| `web/style.css` | modify | Lost-key and agreement styles |
| `tests/helpers/fake-firestore.js` | modify | `orders.create`, fake mailer, fake clock |
| `tests/helpers/web.js`, `tests/helpers/extension.js` | modify | Order-aware stubs; `deviceId` in user stub |
| `tests/unit/*`, `tests/e2e/*` | create/modify | As listed per task |
| `README.md` | modify | Configuration section |

---

### Task 1: Premium follows the account

**Files:** Modify `src/popup/license-manager.js`, `src/popup/auth.js`, `src/popup/account.js`, `web/api/_lib/licensing.js`, `tests/helpers/extension.js`, `tests/unit/api-licensing.test.js`. Create `tests/e2e/popup-account-premium.test.js`.

**Interfaces:**
- Produces: `LicenseManager.activateLicense(key)` and `claimLicenseByEmail()` send no `deviceId`; `LicenseManager` has no `getDeviceId` / `validateSession`; `auth` has no `notice()`; server `users/{uid}` writes are `{ isPremium, licenseKey }`; `firebaseStub({ deviceId })` option.

- [ ] **Step 1: Failing tests**

In `tests/helpers/extension.js`, add a `deviceId = null` option to `firebaseStub` and include it in the user document fields:

```js
export function firebaseStub({ uid = 'u1', email = 'tester@example.com', premium = false, signIn = 'ok', status = 'ok', premiumAfterActivate = false, deviceId = null } = {}) {
```

and in the users-doc response replace the `fields` object with:

```js
{ email: { stringValue: email }, isPremium: { booleanValue: isPremium }, ...(deviceId ? { deviceId: { stringValue: deviceId } } : {}) }
```

Create `tests/e2e/popup-account-premium.test.js`:

```js
// Premium belongs to the account: a device id recorded by an older version
// (or another browser) must not take Premium away
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();

test('Premium stays on when the account was activated in another browser', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true, deviceId: 'device_from_another_browser' }) });
  await popup.waitForFunction(() => document.body.dataset.ready === 'true');
  assert.equal(await popup.$eval('#plan-badge', (b) => b.textContent), 'Premium');
  assert.equal((await ctx.storage()).subpipAuth.isPremium, true);
  await popup.close();
});
```

In `tests/unit/api-licensing.test.js`, change the expectation in "activateLicense binds a verified license and marks the user premium" to:

```js
  assert.deepEqual(db.read('users/u1'), { isPremium: true, licenseKey: 'SUBPIP-AAAAAAAA-1111' });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/popup-account-premium.test.js` → FAIL (badge Free).
Run: `node --test tests/unit/api-licensing.test.js` → FAIL (users doc still has `deviceId`).

- [ ] **Step 3: Server** — in `web/api/_lib/licensing.js`:

Replace the whole `bindLicenseToUser` function with:

```js
// Bind a license to a user and mark them premium, atomically
async function bindLicenseToUser({ db, FieldValue }, licenseRef, uid) {
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(licenseRef)).data();
    if (data.usedBy && data.usedBy !== uid) {
      return { success: false, error: 'License already used by another account' };
    }
    tx.update(licenseRef, { usedBy: uid, activatedAt: data.activatedAt || FieldValue.serverTimestamp() });
    tx.set(db.collection('users').doc(uid), { isPremium: true, licenseKey: data.key }, { merge: true });
    return { success: true, licenseKey: data.key };
  });
}
```

Change the two call sites: `bindLicenseToUser(deps, licenseDoc.ref, uid, data.deviceId)` → `bindLicenseToUser(deps, licenseDoc.ref, uid)` (in `activateLicense` and `claimLicenseByEmail`). In `createLicenseForPayment`, delete the line `deviceId: null`.

- [ ] **Step 4: Extension** — in `src/popup/license-manager.js`:
  1. Delete the `validateSession` method and the `getDeviceId` method entirely (with their comments).
  2. In `activateLicense`, replace the two lines `const deviceId = await this.getDeviceId();` / `const result = await this.callFunction('activateLicense', { key: licenseKey, deviceId });` with `const result = await this.callFunction('activateLicense', { key: licenseKey });`.
  3. In `claimLicenseByEmail`, replace `const deviceId = await this.getDeviceId();` / `return await this.callFunction('claimLicenseByEmail', { deviceId });` with `return await this.callFunction('claimLicenseByEmail', {});`.
  4. In `createUserDocument`, delete `deviceId: { nullValue: null }` (and the comma before it). In `getUserStatus`, delete the `deviceId: ...` line.

In `src/popup/auth.js`:
  1. Delete `let notice = '';`, the line `notice = '';` in `refreshStatus`, and `notice: () => notice,` from the returned object.
  2. Replace:

```js
      premium = false;
      if (status.data.isPremium) {
        const session = await manager.validateSession(user.uid);
        premium = session.valid;
        if (!session.valid) notice = session.error;
      }
```

with:

```js
      premium = !!status.data.isPremium;
```

In `src/popup/account.js`, delete the line `if (auth.notice()) say($('license-error'), auth.notice());`.

Verify: `grep -rn "deviceId\|getDeviceId\|validateSession\|notice" src/popup web/api` → no matches.

- [ ] **Step 5: Run the tests** — `npm run build && node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/popup-account-premium.test.js` → PASS; `node --test tests/unit/api-licensing.test.js` → PASS.

- [ ] **Step 6: Lint, full suite, commit**

```bash
npm run lint && npm test
git add src/popup web/api/_lib/licensing.js tests
git commit -m "fix: Premium follows the account; remove the browser fingerprint lock"
```

---

### Task 2: Logs, mailer, throttled alerts and health check

**Files:** Create `web/api/_lib/log.js`, `web/api/_lib/mailer.js`, `web/api/_lib/alerts.js`, `web/api/health.js`, `tests/unit/api-alerts.test.js`. Modify `web/api/_lib/deps.js`, `web/api/_lib/http.js`, `web/package.json`, `tests/helpers/fake-firestore.js`, `tests/unit/api-http.test.js`.

**Interfaces:**
- Produces: `log(level, event, fields)`; `createMailer({ user, pass }) → { send(message) } | null`; `day(date) → 'YYYY-MM-DD'`; `alertOwner(deps, type, message, details?) → Promise<boolean>`; `configStatus(env) → { firebase, razorpay, webhook, deepl, email }`; `requiredConfigOk(config) → boolean`; live deps gain `mailer`, `alertTo`, `now`, `keyId`, `keySecret`, `deeplKey`; test helpers `fakeMailer()` → `{ sent: [], send }`, `fixedClock(iso)` → `() => Date`.

- [ ] **Step 1: Test helpers** — append to `tests/helpers/fake-firestore.js`:

```js
// Mailer stand-in: records messages; set failWith to make send() reject
export function fakeMailer() {
  const mailer = {
    sent: [],
    failWith: null,
    async send(message) {
      if (mailer.failWith) throw new Error(mailer.failWith);
      mailer.sent.push(message);
    }
  };
  return mailer;
}

export const fixedClock = (iso) => () => new Date(iso);
```

- [ ] **Step 2: Failing tests** — create `tests/unit/api-alerts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertOwner, day } from '../../web/api/_lib/alerts.js';
import { configStatus, requiredConfigOk } from '../../web/api/_lib/deps.js';
import { fakeFirestore, fakeMailer, fixedClock } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('day() is the UTC date', () => {
  assert.equal(day(new Date('2026-09-29T23:30:00Z')), '2026-09-29');
});

test('alerts email the owner with the type in the subject', async () => {
  const mailer = fakeMailer();
  const sent = await quiet(() => alertOwner({ db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') },
    'license-email-failed', 'Could not email a license', { paymentId: 'pay_1' }));
  assert.equal(sent, true);
  assert.equal(mailer.sent[0].to, 'owner@example.com');
  assert.match(mailer.sent[0].subject, /license-email-failed/);
  assert.match(mailer.sent[0].text, /pay_1/);
});

test('at most 3 alerts of a type per day', async () => {
  const deps = { db: fakeFirestore(), mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  for (let i = 0; i < 5; i++) await quiet(() => alertOwner(deps, 'internal-error', `boom ${i}`));
  assert.equal(deps.mailer.sent.length, 3);
  await quiet(() => alertOwner(deps, 'deepl-quota', 'other type'));
  assert.equal(deps.mailer.sent.length, 4);
  deps.now = fixedClock('2026-09-30T00:05:00Z');
  await quiet(() => alertOwner(deps, 'internal-error', 'next day'));
  assert.equal(deps.mailer.sent.length, 5);
});

test('alerts never throw, even when email fails or is not configured', async () => {
  const mailer = fakeMailer();
  mailer.failWith = 'SMTP down';
  const deps = { db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  assert.equal(await quiet(() => alertOwner(deps, 'internal-error', 'x')), false);
  assert.equal(await quiet(() => alertOwner({ ...deps, mailer: null }, 'internal-error', 'x')), false);
});

test('configStatus reports presence only, and what is required', () => {
  const config = configStatus({ FIREBASE_SERVICE_ACCOUNT: '{}', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w', GMAIL_USER: 'a@b.c', GMAIL_APP_PASSWORD: 'p' });
  assert.deepEqual(config, { firebase: true, razorpay: true, webhook: true, deepl: false, email: true });
  assert.equal(requiredConfigOk(config), true);
  assert.equal(requiredConfigOk({ ...config, email: false }), false);
});
```

Append to `tests/unit/api-http.test.js`:

```js
test('unexpected errors alert the owner (when dependencies are available)', async () => {
  const { fakeMailer, fixedClock, fakeFirestore } = await import('../helpers/fake-firestore.js');
  const mailer = fakeMailer();
  const deps = { auth, db: fakeFirestore(), mailer, alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z') };
  const handler = callable(async function brokenThing() { throw new Error('kaboom'); }, async () => deps);
  const log = console.error;
  console.error = () => {};
  await handler(fakeReq({ body: { data: {} } }), fakeRes());
  console.error = log;
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /internal-error/);
  assert.match(mailer.sent[0].text, /brokenThing/);
});

test('/api/health reports config presence without values', async () => {
  const { default: health } = await import('../../web/api/health.js');
  const KEYS = ['FIREBASE_SERVICE_ACCOUNT', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'DEEPL_API_KEY'];
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { FIREBASE_SERVICE_ACCOUNT: '{"secret":1}', RAZORPAY_KEY_SECRET: 'rk', RAZORPAY_WEBHOOK_SECRET: 'wh', GMAIL_USER: 'a@b.c', GMAIL_APP_PASSWORD: 'pw' });
  delete process.env.DEEPL_API_KEY;
  const ok = fakeRes();
  await health({ method: 'GET', headers: {} }, ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.body, { ok: true, config: { firebase: true, razorpay: true, webhook: true, deepl: false, email: true } });
  assert.doesNotMatch(JSON.stringify(ok.body), /secret|rk|wh|pw/);
  delete process.env.GMAIL_APP_PASSWORD;
  const down = fakeRes();
  await health({ method: 'GET', headers: {} }, down);
  assert.equal(down.statusCode, 503);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
```

- [ ] **Step 3: Run to verify they fail** — `node --test tests/unit/api-alerts.test.js tests/unit/api-http.test.js` → FAIL (modules missing).

- [ ] **Step 4: Install nodemailer**

```bash
npm --prefix web install nodemailer@^8
```

(If `npm view nodemailer version` shows a different current major, use that major and note it in the ledger.)

- [ ] **Step 5: Log, mailer, alerts** — create `web/api/_lib/log.js`:

```js
// One JSON line per notable event, searchable in Vercel's logs
export function log(level, event, fields = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
```

`web/api/_lib/mailer.js`:

```js
// Email through the owner's Gmail (SMTP + app password). Returns null when
// not configured, so callers can degrade instead of crashing.
import nodemailer from 'nodemailer';

export function createMailer({ user, pass }) {
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return {
    send: (message) => transport.sendMail({ from: `SubPIP <${user}>`, ...message })
  };
}
```

`web/api/_lib/alerts.js`:

```js
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
```

- [ ] **Step 6: Live deps and config** — replace all of `web/api/_lib/deps.js` with:

```js
// Live dependencies for the API, built from Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON
//   RAZORPAY_KEY_SECRET       Razorpay API key secret (pairs with RAZORPAY_KEY_ID)
//   RAZORPAY_WEBHOOK_SECRET   secret set on the Razorpay webhook
//   DEEPL_API_KEY             DeepL API Free key (Premium translation)
//   GMAIL_USER, GMAIL_APP_PASSWORD  Gmail account + app password for emails
//   ALERT_EMAIL               optional; owner alerts go here (default GMAIL_USER)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Razorpay from 'razorpay';
import { createMailer } from './mailer.js';

export const RAZORPAY_KEY_ID = 'rzp_live_S9zPibMgaqE7VV';

// Which settings are present (never their values)
export function configStatus(env) {
  return {
    firebase: !!env.FIREBASE_SERVICE_ACCOUNT,
    razorpay: !!env.RAZORPAY_KEY_SECRET,
    webhook: !!env.RAZORPAY_WEBHOOK_SECRET,
    deepl: !!env.DEEPL_API_KEY,
    email: !!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD)
  };
}

// DeepL is optional: without it translation falls back to MyMemory in the extension
export const requiredConfigOk = (config) => config.firebase && config.razorpay && config.webhook && config.email;

export function liveDeps(env = process.env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  return {
    db: getFirestore(),
    auth: getAuth(),
    FieldValue,
    razorpay: new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }),
    keyId: RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    deeplKey: env.DEEPL_API_KEY || '',
    mailer: createMailer({ user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD }),
    alertTo: env.ALERT_EMAIL || env.GMAIL_USER || '',
    fetch: globalThis.fetch,
    now: () => new Date()
  };
}
```

Create `web/api/health.js`:

```js
// GET /api/health — for uptime monitors: which settings are present, never values
import { configStatus, requiredConfigOk } from './_lib/deps.js';

export default function handler(req, res) {
  const config = configStatus(process.env);
  const ok = requiredConfigOk(config);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(ok ? 200 : 503).json({ ok, config });
}
```

- [ ] **Step 7: http.js** — in `web/api/_lib/http.js`:
  1. Add to `HTTP_STATUS`: `'resource-exhausted': 429,` and `unavailable: 503,`.
  2. Add `import { alertOwner } from './alerts.js';` at the top.
  3. In `callable`, declare `let deps;` before `try`, change `const deps = await getDeps();` to `deps = await getDeps();`, and in the non-`HttpsError` branch, before `return sendError(...)`, add:

```js
      if (deps) await alertOwner(deps, 'internal-error', error.message, { endpoint: handler.name || 'unknown' });
```

- [ ] **Step 8: Run the tests** — `node --test tests/unit/api-alerts.test.js tests/unit/api-http.test.js tests/unit/api-endpoints.test.js` → PASS.

- [ ] **Step 9: Lint, full suite, commit**

```bash
npm run lint && npm test
git add web/api web/package.json web/package-lock.json tests
git commit -m "feat(api): structured logs, Gmail mailer, throttled owner alerts, /api/health"
```

---

### Task 3: License emails and the lost-key form

**Files:** Create `web/api/_lib/emails.js`, `web/api/resendLicense.js`, `tests/unit/api-emails.test.js`, `tests/e2e/web-lost-key.test.js`. Modify `web/api/_lib/licensing.js`, `web/api/_lib/webhook.js`, `web/premium.html`, `web/style.css`, `tests/helpers/web.js`, `tests/unit/api-licensing.test.js`, `tests/unit/api-http.test.js`.

**Interfaces:**
- Consumes: `alertOwner`, `log` (Task 2); `fakeMailer`, `fixedClock` (Task 2).
- Produces: `createLicenseForPayment(deps, payment) → { key, created, email }`; `issueLicense(deps, payment) → key` (creates + emails once); `formatAmount(amount, currency)`; `licenseEmail({ keys, payment? }) → { subject, text, html }`; `sendLicenseEmail(deps, { to, keys, payment? }) → boolean`; `resendLicense({ email }, ctx, deps) → { message }`; `RESEND_MESSAGE`; stub `resendStub()`.

- [ ] **Step 1: Failing unit tests** — create `tests/unit/api-emails.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount, licenseEmail, sendLicenseEmail } from '../../web/api/_lib/emails.js';
import { issueLicense, resendLicense, RESEND_MESSAGE } from '../../web/api/_lib/licensing.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const payment = { id: 'pay_E1', status: 'captured', currency: 'USD', amount: 1500, email: 'Buyer@Example.com' };
const deps = (extra = {}) => ({ db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(), mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-09-29T10:00:00Z'), ...extra });

test('amounts are formatted per currency', () => {
  assert.equal(formatAmount(1500, 'USD'), '$15');
  assert.equal(formatAmount(100000, 'INR'), '₹1,000');
});

test('the license email has the key, steps, receipt and refund note', () => {
  const email = licenseEmail({ keys: ['SUBPIP-AAAAAAAA-1111'], payment });
  assert.equal(email.subject, 'Your SubPIP Premium license');
  for (const part of ['SUBPIP-AAAAAAAA-1111', 'Account & license', '$15', 'pay_E1', '7 days']) assert.ok(email.text.includes(part), part);
  assert.match(email.html, /SUBPIP-AAAAAAAA-1111/);
});

test('issuing a license emails the buyer exactly once, even when called twice', async () => {
  const d = deps();
  const first = await issueLicense(d, payment);
  const second = await issueLicense(d, payment);
  assert.equal(second, first);
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(d.mailer.sent[0].to, 'buyer@example.com');
  assert.ok(d.mailer.sent[0].text.includes(first));
});

test('a failed license email still issues the license and alerts the owner', async () => {
  const mailer = fakeMailer();
  mailer.failWith = 'SMTP down';
  const d = deps({ mailer });
  const key = await quiet(() => issueLicense(d, payment));
  assert.ok(key);
  assert.ok(d.db.read('licenses/pay_E1'));
  // The buyer's email failed; the alert (also via mailer) failed too, but nothing threw
});

test('sendLicenseEmail without an address or mailer returns false', async () => {
  assert.equal(await quiet(() => sendLicenseEmail(deps(), { to: null, keys: ['K'] })), false);
  assert.equal(await quiet(() => sendLicenseEmail(deps({ mailer: null }), { to: 'a@b.c', keys: ['K'] })), false);
});

test('lost-key: sends keys only to the purchase email, with a generic reply', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  d.db.docs.set('licenses/pay_2', { key: 'SUBPIP-REFUND01-0001', email: 'buyer@example.com', verified: true, revoked: true });
  const reply = await resendLicense({ email: ' Buyer@Example.com ' }, {}, d);
  assert.deepEqual(reply, { message: RESEND_MESSAGE });
  assert.equal(d.mailer.sent.length, 1);
  assert.equal(d.mailer.sent[0].to, 'buyer@example.com');
  assert.ok(d.mailer.sent[0].text.includes('SUBPIP-OWNED001-0001'));
  assert.ok(!d.mailer.sent[0].text.includes('SUBPIP-REFUND01-0001'));
});

test('lost-key: unknown emails get the same reply and no email', async () => {
  const d = deps();
  assert.deepEqual(await resendLicense({ email: 'nobody@example.com' }, {}, d), { message: RESEND_MESSAGE });
  assert.equal(d.mailer.sent.length, 0);
});

test('lost-key: at most one email per address per 10 minutes', async () => {
  const d = deps();
  d.db.docs.set('licenses/pay_1', { key: 'SUBPIP-OWNED001-0001', email: 'buyer@example.com', verified: true });
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  assert.equal(d.mailer.sent.length, 1);
  d.now = fixedClock('2026-09-29T10:11:00Z');
  await resendLicense({ email: 'buyer@example.com' }, {}, d);
  assert.equal(d.mailer.sent.length, 2);
});

test('lost-key: invalid emails are rejected', async () => {
  await assert.rejects(resendLicense({ email: 'not-an-email' }, {}, deps()), (e) => e.status === 'invalid-argument');
});
```

In `tests/unit/api-http.test.js`, in "a correctly signed payment.captured webhook creates the license", pass a mailer and assert the email:

```js
  const { fakeMailer, fixedClock } = await import('../helpers/fake-firestore.js');
  const mailer = fakeMailer();
  await handleWebhook(webhookReq(captured({ id: 'pay_W1', currency: 'USD', amount: 1500, email: 'w@example.com' }), 'whsec'), res,
    { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec', mailer, now: fixedClock('2026-09-29T10:00:00Z') });
  assert.equal(res.statusCode, 200);
  assert.ok(db.read('licenses/pay_W1').key);
  assert.equal(mailer.sent.length, 1);
```

(replace that test's existing `await handleWebhook(...)` call and assertions with the block above).

- [ ] **Step 2: Run to verify they fail** — `node --test tests/unit/api-emails.test.js tests/unit/api-http.test.js` → FAIL.

- [ ] **Step 3: Emails module** — create `web/api/_lib/emails.js`:

```js
// The license email (key, how to activate, receipt) and sending it safely
import { alertOwner } from './alerts.js';
import { log } from './log.js';

const SUPPORT_EMAIL = 'tarunmonga2208@gmail.com';

export function formatAmount(amount, currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function licenseEmail({ keys, payment }) {
  const plural = keys.length > 1;
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
    'To activate:',
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
    '',
    receipt,
    'Not happy? You can get a full refund within 7 days of purchase, no questions asked.',
    `Questions: ${SUPPORT_EMAIL}`
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,system-ui,sans-serif;max-width:520px;color:#111">
<h2 style="margin:0 0 12px">Your SubPIP Premium license</h2>
<p>Thanks for getting SubPIP Premium!</p>
${keys.map((key) => `<p style="font:600 18px ui-monospace,Menlo,monospace;background:#f4f4f5;padding:12px 14px;border-radius:8px">${escapeHtml(key)}</p>`).join('')}
<ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
${receipt ? `<p style="color:#555">${escapeHtml(receipt)}</p>` : ''}
<p style="color:#555">Not happy? You can get a full refund within 7 days of purchase, no questions asked.</p>
<p style="color:#555">Questions: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
</div>`;
  return { subject: 'Your SubPIP Premium license', text, html };
}

// Never throws; a failure is logged and alerted, and the caller carries on
export async function sendLicenseEmail(deps, { to, keys, payment }) {
  if (!to) {
    log('warn', 'license-email-skipped', { reason: 'no-email', paymentId: payment?.id });
    return false;
  }
  if (!deps.mailer) {
    log('error', 'license-email-skipped', { reason: 'mailer-not-configured', paymentId: payment?.id });
    return false;
  }
  try {
    await deps.mailer.send({ to, ...licenseEmail({ keys, payment }) });
    log('info', 'license-email-sent', { paymentId: payment?.id });
    return true;
  } catch (error) {
    await alertOwner(deps, 'license-email-failed', `Could not email a license: ${error.message}`, { paymentId: payment?.id });
    return false;
  }
}
```

(`formatAmount` with `en-US` renders INR as `₹1,000` and USD as `$15`.)

- [ ] **Step 4: Licensing** — in `web/api/_lib/licensing.js`:
  1. Add `import { sendLicenseEmail } from './emails.js';` (`crypto` is already imported).
  2. Change `createLicenseForPayment` so it returns `{ key, created, email }`:
     - `if (existing) return existing.data().key;` → `if (existing) return { key: existing.data().key, created: false, email: existing.data().email || null };`
     - in the `catch`: `if (error.code === 6) return (await ref.get()).data().key;` → `if (error.code === 6) return { key: (await ref.get()).data().key, created: false, email: email || null };`
     - final `return licenseKey;` → `return { key: licenseKey, created: true, email: email || null };`
  3. Add after `createLicenseForPayment`:

```js
// Create the license (idempotent) and email it, only from the call that created it
export async function issueLicense(deps, payment) {
  const { key, created, email } = await createLicenseForPayment(deps, payment);
  if (created) await sendLicenseEmail(deps, { to: email, keys: [key], payment });
  return key;
}

export const RESEND_MESSAGE = "If a purchase exists for that email, we've sent the license to it.";
const RESEND_INTERVAL_MS = 10 * 60 * 1000;

// "Lost your key?": emails a buyer's keys, only to the purchase email, at
// most once per 10 minutes per address; the reply never reveals a purchase
export async function resendLicense(data, ctx, deps) {
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpsError('invalid-argument', 'Enter a valid email address');

  const limitRef = deps.db.collection('resend').doc(crypto.createHash('sha256').update(email).digest('hex'));
  const nowMs = deps.now().getTime();
  const allowed = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(limitRef);
    if (snap.exists && nowMs - snap.data().lastSentAt < RESEND_INTERVAL_MS) return false;
    tx.set(limitRef, { lastSentAt: nowMs });
    return true;
  });
  if (!allowed) return { message: RESEND_MESSAGE };

  const [byEmail, byLegacyEmail] = await Promise.all([
    deps.db.collection('licenses').where('email', '==', email).get(),
    deps.db.collection('licenses').where('purchaserEmail', '==', email).get()
  ]);
  const keys = [...byEmail.docs, ...byLegacyEmail.docs]
    .map((doc) => doc.data())
    .filter((license) => license.verified === true && !license.revoked)
    .map((license) => license.key);
  if (keys.length) await sendLicenseEmail(deps, { to: email, keys });
  return { message: RESEND_MESSAGE };
}
```

  4. In `confirmPayment`, replace `const licenseKey = await createLicenseForPayment(deps, payment);` with `const licenseKey = await issueLicense(deps, payment);`.

- [ ] **Step 5: Webhook** — in `web/api/_lib/webhook.js`, change the import to `import { issueLicense } from './licensing.js';` and `await createLicenseForPayment(deps, payment);` → `await issueLicense(deps, payment);`.

- [ ] **Step 6: Endpoint** — create `web/api/resendLicense.js`:

```js
// POST /api/resendLicense — "Lost your key?" (see _lib/licensing.js)
import { callable } from './_lib/http.js';
import { resendLicense } from './_lib/licensing.js';
import { liveDeps } from './_lib/deps.js';

export default callable(resendLicense, liveDeps);
```

Add `'resendLicense'` to the `CALLABLES` array in `tests/unit/api-endpoints.test.js`.

- [ ] **Step 7: Run unit tests** — `node --test tests/unit/api-emails.test.js tests/unit/api-http.test.js tests/unit/api-licensing.test.js tests/unit/api-endpoints.test.js` → PASS.

- [ ] **Step 8: Lost-key form on the checkout — failing e2e test**

Append to `tests/helpers/web.js`:

```js
// The resendLicense endpoint; records the email it was asked for
export function resendStub(seen = []) {
  return (request) => {
    if (!request.url().includes('/api/resendLicense')) return false;
    seen.push(JSON.parse(request.postData() || '{}').data?.email);
    request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { message: "If a purchase exists for that email, we've sent the license to it." } }) });
    return true;
  };
}
```

Create `tests/e2e/web-lost-key.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, resendStub, both } from '../helpers/web.js';

const ctx = useWebsite();

test('lost-key form sends the email and shows the generic reply', async () => {
  const seen = [];
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), resendStub(seen)) });
  await page.click('.lost-key summary');
  await page.type('#lostKeyEmail', 'buyer@example.com');
  await page.click('#lostKeyForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('lostKeyMsg').textContent.length > 0);
  assert.equal(await page.$eval('#lostKeyMsg', (el) => el.textContent), "If a purchase exists for that email, we've sent the license to it.");
  assert.deepEqual(seen, ['buyer@example.com']);
  await page.close();
});
```

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-lost-key.test.js` → FAIL (no form).

- [ ] **Step 9: Lost-key form** — in `web/premium.html`, insert after `<p class="secure-badge">Secured by Razorpay</p>`:

```html
        <details class="lost-key">
          <summary>Lost your license key?</summary>
          <form id="lostKeyForm" novalidate>
            <label class="field-label" for="lostKeyEmail">Email you bought with</label>
            <input type="email" id="lostKeyEmail" class="email-input" placeholder="you@example.com" autocomplete="email">
            <button class="btn btn-ghost btn-block" type="submit">Email my license</button>
            <p class="muted lost-key-msg" id="lostKeyMsg" role="status"></p>
          </form>
        </details>
```

In the module script, just before the closing `</script>` of the `<script type="module">` block, add:

```js
        // "Lost your key?": the server emails keys only to the purchase address
        document.getElementById('lostKeyForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const message = document.getElementById('lostKeyMsg');
            const email = document.getElementById('lostKeyEmail').value.trim();
            try {
                const response = await fetch(`${FUNCTIONS_BASE_URL}/resendLicense`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: { email } })
                });
                const body = await response.json();
                message.textContent = body.error ? body.error.message : body.result.message;
            } catch {
                message.textContent = 'Could not reach SubPIP. Please try again.';
            }
        });
```

Append to `web/style.css`:

```css
.lost-key { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
.lost-key summary { color: var(--text-2); font-size: 14px; cursor: pointer; }
.lost-key summary:hover { color: var(--text); }
.lost-key form { margin-top: 12px; }
.lost-key .btn { margin-top: 10px; }
.lost-key-msg { margin-top: 10px; font-size: 14px; }
```

- [ ] **Step 10: Run e2e** — `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-lost-key.test.js tests/e2e/web-premium.test.js tests/e2e/web-site.test.js` → PASS.

- [ ] **Step 11: Lint, full suite, commit**

```bash
npm run lint && npm test
git add web tests
git commit -m "feat: email licenses once on purchase; lost-key form with rate limit"
```

---

### Task 4: Razorpay Orders with signature verification

**Files:** Create `web/api/_lib/orders.js`, `web/api/createOrder.js`, `tests/unit/api-orders.test.js`. Modify `web/api/_lib/licensing.js`, `web/premium.html`, `tests/helpers/fake-firestore.js`, `tests/helpers/web.js`, `tests/unit/api-licensing.test.js`, `tests/unit/api-endpoints.test.js`, `tests/e2e/web-premium.test.js`, `tests/e2e/web-pricing.test.js`.

**Interfaces:**
- Consumes: `PRICES` (existing), `issueLicense`, `alertOwner`.
- Produces: `createOrder({ currency, email }, ctx, deps) → { orderId, amount, currency, keyId }`; `validPaymentSignature(orderId, paymentId, signature, secret) → boolean`; `confirmPayment({ paymentId, orderId, signature })`; `fakeRazorpay` gains `orders.create` and records `created`; `signFor(orderId, paymentId, secret)` test helper; `confirmStub` also answers `/api/createOrder`.

- [ ] **Step 1: Test helpers** — in `tests/helpers/fake-firestore.js`, add `import crypto from 'node:crypto';` at the top, and in `fakeRazorpay` add an `orders` member next to `payments`:

```js
    orders: {
      created: [],
      async create(order) {
        const id = `order_${this.created.length + 1}`;
        this.created.push({ ...order, id });
        return { ...order, id, status: 'created' };
      }
    },
```

and append:

```js
export const signFor = (orderId, paymentId, secret) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
```

- [ ] **Step 2: Failing tests** — create `tests/unit/api-orders.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, validPaymentSignature } from '../../web/api/_lib/orders.js';
import { confirmPayment } from '../../web/api/_lib/licensing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeRazorpay, fakeMailer, fixedClock, FieldValue, signFor } from '../helpers/fake-firestore.js';

const SECRET = 'rk_secret';
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof HttpsError && e.status === status);
const deps = (payments = {}) => ({ db: fakeFirestore(), FieldValue, razorpay: fakeRazorpay(payments), keyId: 'rzp_test', keySecret: SECRET, mailer: fakeMailer(), alertTo: 'o@x.y', now: fixedClock('2026-09-29T10:00:00Z') });

test('createOrder sets the amount from the price table', async () => {
  const d = deps();
  assert.deepEqual(await createOrder({ currency: 'USD', email: 'b@example.com' }, {}, d), { orderId: 'order_1', amount: 1500, currency: 'USD', keyId: 'rzp_test' });
  assert.deepEqual(await createOrder({ currency: 'INR' }, {}, d), { orderId: 'order_2', amount: 100000, currency: 'INR', keyId: 'rzp_test' });
  assert.deepEqual(d.razorpay.orders.created[0].notes, { email: 'b@example.com' });
});

test('createOrder ignores any client amount and rejects unknown currencies', async () => {
  const d = deps();
  const order = await createOrder({ currency: 'USD', amount: 1 }, {}, d);
  assert.equal(order.amount, 1500);
  await rejects(createOrder({ currency: 'EUR' }, {}, d), 'invalid-argument');
});

test('payment signatures are checked exactly', () => {
  const sig = signFor('order_1', 'pay_1', SECRET);
  assert.equal(validPaymentSignature('order_1', 'pay_1', sig, SECRET), true);
  assert.equal(validPaymentSignature('order_1', 'pay_2', sig, SECRET), false);
  assert.equal(validPaymentSignature('order_1', 'pay_1', 'deadbeef', SECRET), false);
  assert.equal(validPaymentSignature('order_1', 'pay_1', sig, 'other_secret'), false);
});

const paid = (orderId) => ({ status: 'captured', currency: 'USD', amount: 1500, email: 'b@example.com', order_id: orderId });

test('confirmPayment issues a license for a signed payment on its order', async () => {
  const d = deps({ pay_1: paid('order_1') });
  const result = await confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d);
  assert.ok(result.licenseKey);
  assert.equal(d.mailer.sent.length, 1);
});

test('confirmPayment refuses a forged signature', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: 'forged' }, {}, d), 'invalid-argument');
  assert.equal(d.db.read('licenses/pay_1'), undefined);
});

test('confirmPayment refuses a payment that belongs to another order', async () => {
  const d = deps({ pay_1: paid('order_OTHER') });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d), 'failed-precondition');
});

test('confirmPayment requires the order id and signature', async () => {
  const d = deps({ pay_1: paid('order_1') });
  await rejects(confirmPayment({ paymentId: 'pay_1' }, {}, d), 'invalid-argument');
});

test('an underpaid order payment is refused', async () => {
  const d = deps({ pay_1: { ...paid('order_1'), amount: 100 } });
  await rejects(confirmPayment({ paymentId: 'pay_1', orderId: 'order_1', signature: signFor('order_1', 'pay_1', SECRET) }, {}, d), 'failed-precondition');
});
```

In `tests/unit/api-licensing.test.js`, update the `confirmPayment` tests to the order flow: at the top add `import { signFor } from '../helpers/fake-firestore.js';` (merge into the existing import), set `keySecret: 'k'` in the `deps` helper (`({ db, FieldValue, razorpay: fakeRazorpay(payments), keySecret: 'k', ...extra })`), give `paid` an `order_id: 'order_1'`, and replace each `confirmPayment({ paymentId: 'X' }, ...)` call with `confirmPayment({ paymentId: 'X', orderId: 'order_1', signature: signFor('order_1', 'X', 'k') }, ...)`. For the USD test use `{ ...paid, currency: 'USD', amount: 1500 }` (it inherits `order_id`). Keep the malformed-id case as `confirmPayment({ paymentId: 'order_1', orderId: 'order_1', signature: 'x' }, ...)` expecting `invalid-argument`.

Add `'createOrder'` to `CALLABLES` in `tests/unit/api-endpoints.test.js`.

- [ ] **Step 3: Run to verify they fail** — `node --test tests/unit/api-orders.test.js tests/unit/api-licensing.test.js` → FAIL.

- [ ] **Step 4: Orders module** — create `web/api/_lib/orders.js`:

```js
// Razorpay Orders: the server fixes the amount; the payment signature proves
// Razorpay processed this payment for this order.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { PRICES } from './pricing.js';

export async function createOrder(data, ctx, deps) {
  const currency = data.currency;
  if (!Object.hasOwn(PRICES, currency)) throw new HttpsError('invalid-argument', 'Unsupported currency');
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase().slice(0, 254) : '';
  const order = await deps.razorpay.orders.create({
    amount: PRICES[currency],
    currency,
    receipt: `subpip_${deps.now().getTime()}`,
    notes: email ? { email } : {}
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: deps.keyId };
}

export function validPaymentSignature(orderId, paymentId, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
```

- [ ] **Step 5: confirmPayment** — in `web/api/_lib/licensing.js`, add `import { validPaymentSignature } from './orders.js';` and `import { alertOwner } from './alerts.js';`, then replace the whole `confirmPayment` function with:

```js
// Called by the checkout after Razorpay reports success for an order
export async function confirmPayment(data, ctx, deps) {
  const paymentId = typeof data.paymentId === 'string' ? data.paymentId.trim() : '';
  const orderId = typeof data.orderId === 'string' ? data.orderId.trim() : '';
  if (!/^pay_[A-Za-z0-9]+$/.test(paymentId) || !/^order_[A-Za-z0-9]+$/.test(orderId)) {
    throw new HttpsError('invalid-argument', 'Valid payment and order IDs are required');
  }
  if (!validPaymentSignature(orderId, paymentId, data.signature, deps.keySecret)) {
    throw new HttpsError('invalid-argument', 'Payment signature is invalid');
  }

  let payment;
  try {
    payment = await fetchCapturedPayment(deps, paymentId, { requireFullPrice: true });
  } catch {
    throw new HttpsError('not-found', 'Payment not found');
  }
  if (!payment) throw new HttpsError('failed-precondition', 'Payment not completed');
  if (payment.order_id !== orderId) throw new HttpsError('failed-precondition', 'Payment does not match the order');

  try {
    const licenseKey = await issueLicense(deps, payment);
    return { licenseKey, email: payment.email || null };
  } catch (error) {
    await alertOwner(deps, 'license-creation-failed', `Payment ${paymentId} was captured but creating the license failed: ${error.message}`, { paymentId, orderId });
    throw new HttpsError('internal', 'Payment received, but creating your license failed. We have been notified.');
  }
}
```

- [ ] **Step 6: Endpoint** — create `web/api/createOrder.js`:

```js
// POST /api/createOrder — server-priced Razorpay order (see _lib/orders.js)
import { callable } from './_lib/http.js';
import { createOrder } from './_lib/orders.js';
import { liveDeps } from './_lib/deps.js';

export default callable(createOrder, liveDeps);
```

- [ ] **Step 7: Run unit tests** — `node --test tests/unit/api-orders.test.js tests/unit/api-licensing.test.js tests/unit/api-endpoints.test.js` → PASS.

- [ ] **Step 8: Checkout e2e stubs (failing first)** — in `tests/helpers/web.js`:
  1. In `FAKE_RAZORPAY`, change the success handler call to pass the order and a signature, and record the order id:

```js
  window.__rzpOptions = { amount: this.options.amount, currency: this.options.currency, orderId: this.options.order_id };
```

```js
    if (mode === 'success') this.options.handler({ razorpay_payment_id: 'pay_TEST123', razorpay_order_id: this.options.order_id, razorpay_signature: 'sig_TEST' });
```

  2. Replace `confirmStub` with a version that also answers `createOrder` and requires the signature:

```js
// createOrder (server-priced: INR 100000, USD 1500) and confirmPayment
// (requires order id + signature from the fake Razorpay)
export function confirmStub({ ok = true } = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (status, body) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  return (request) => {
    const url = request.url();
    if (request.method() === 'OPTIONS' && url.includes('/api/')) {
      request.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });
      return true;
    }
    if (url.includes('/api/createOrder')) {
      const { currency } = JSON.parse(request.postData() || '{}').data || {};
      const amount = { INR: 100000, USD: 1500 }[currency];
      request.respond(amount ? json(200, { result: { orderId: `order_${currency}`, amount, currency, keyId: 'rzp_test' } }) : json(400, { error: { message: 'Unsupported currency', status: 'INVALID_ARGUMENT' } }));
      return true;
    }
    if (!url.includes('/api/confirmPayment')) return false;
    const { orderId, signature } = JSON.parse(request.postData() || '{}').data || {};
    if (!orderId || !signature) {
      request.respond(json(400, { error: { message: 'Valid payment and order IDs are required', status: 'INVALID_ARGUMENT' } }));
    } else if (ok) {
      request.respond(json(200, { result: { licenseKey: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' } }));
    } else {
      request.respond(json(400, { error: { message: 'Payment not completed', status: 'FAILED_PRECONDITION' } }));
    }
    return true;
  };
}
```

  3. In `tests/e2e/web-pricing.test.js`, update the two `payAndCapture` expectations to include the order id: `{ amount: 100000, currency: 'INR', orderId: 'order_INR' }` and `{ amount: 1500, currency: 'USD', orderId: 'order_USD' }`.

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-premium.test.js tests/e2e/web-pricing.test.js` → FAIL (checkout doesn't create orders or send signatures).

- [ ] **Step 9: Checkout script** — in `web/premium.html`'s module script:
  1. Replace the `confirmPayment` function with:

```js
        // Server creates the order, so the amount is never set by this page
        async function createOrder(email) {
            const response = await fetch(`${FUNCTIONS_BASE_URL}/createOrder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { currency: price.currency, email } })
            });
            const body = await response.json();
            if (body.error) throw new Error(body.error.message || 'Could not start the payment');
            return body.result;
        }

        // Server verifies Razorpay's signature for this order and payment
        async function confirmPayment(response) {
            const result = await fetch(`${FUNCTIONS_BASE_URL}/confirmPayment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { paymentId: response.razorpay_payment_id, orderId: response.razorpay_order_id, signature: response.razorpay_signature } })
            });
            const body = await result.json();
            if (body.error) {
                throw new Error(body.error.message || 'Payment verification failed');
            }
            return body.result;
        }
```

  2. In `initiatePayment`, insert right before `const options = {`:

```js
            let order;
            showLoading(true);
            try {
                order = await createOrder(email);
            } catch (e) {
                showLoading(false);
                showError('Could not start the payment. Please try again.');
                return;
            }
            showLoading(false);
```

  3. In `options`, replace `key: RAZORPAY_KEY_ID,` / `amount: price.amount,` / `currency: price.currency,` with:

```js
                key: order.keyId,
                order_id: order.orderId,
                amount: order.amount,
                currency: order.currency,
```

  4. In `handlePaymentSuccess`, change `await confirmPayment(response.razorpay_payment_id)` to `await confirmPayment(response)`.
  5. Delete the now-unused `const RAZORPAY_KEY_ID = ...;` line.

- [ ] **Step 10: Run e2e** — `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-premium.test.js tests/e2e/web-pricing.test.js tests/e2e/web-review-fixes.test.js` → PASS.

- [ ] **Step 11: Lint, full suite, commit**

```bash
npm run lint && npm test
git add web tests
git commit -m "feat: Razorpay Orders with server pricing and payment signature checks"
```

---

### Task 5: DeepL translation with cache and per-user cap

**Files:** Create `web/api/_lib/translate.js`, `tests/unit/api-translate.test.js`. Modify `web/api/_lib/licensing.js`, `tests/unit/api-licensing.test.js`.

**Interfaces:**
- Consumes: `alertOwner`, `day` (Task 2), `HttpsError` statuses `resource-exhausted`, `unavailable` (Task 2).
- Produces: `DAILY_CHAR_LIMIT = 60000`; `MAX_TEXT_LENGTH = 1000`; `DEEPL_TARGETS`; `translateForUser(deps, uid, text, lang) → { translation, provider: 'cache' | 'deepl' }`; `translateText` returns `{ success, translation, provider, sourceText, targetLang }`.

- [ ] **Step 1: Failing tests** — create `tests/unit/api-translate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateForUser, DAILY_CHAR_LIMIT, DEEPL_TARGETS } from '../../web/api/_lib/translate.js';
import { translateText } from '../../web/api/_lib/licensing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof HttpsError && e.status === status);

function deepl({ status = 200, text = 'hola' } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: status === 200, status, json: async () => ({ translations: [{ text }] }) };
  };
  return { fetch, calls };
}
const deps = (fetch, extra = {}) => ({ db: fakeFirestore(), FieldValue, fetch, deeplKey: 'dk', mailer: fakeMailer(), alertTo: 'o@x.y', now: fixedClock('2026-09-29T10:00:00Z'), ...extra });

test('DeepL target codes', () => {
  assert.deepEqual(DEEPL_TARGETS, { en: 'EN-US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT-BR', zh: 'ZH-HANS', ja: 'JA', ko: 'KO', ar: 'AR', ru: 'RU' });
});

test('first request goes to DeepL, the second comes from the cache', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  assert.deepEqual(await translateForUser(d, 'u1', 'hello', 'es'), { translation: 'hola', provider: 'deepl' });
  assert.deepEqual(await translateForUser(d, 'u2', 'hello', 'es'), { translation: 'hola', provider: 'cache' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { text: ['hello'], target_lang: 'ES' });
  assert.equal(calls[0].auth, 'DeepL-Auth-Key dk');
});

test('cached lines do not count toward the daily cap', async () => {
  const { fetch } = deepl();
  const d = deps(fetch);
  await translateForUser(d, 'u1', 'hello', 'es');
  const before = d.db.read('usage/u1_2026-09-29').chars;
  await translateForUser(d, 'u1', 'hello', 'es');
  assert.equal(d.db.read('usage/u1_2026-09-29').chars, before);
});

test('over the daily cap the server says so (the extension then uses MyMemory)', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  d.db.docs.set('usage/u1_2026-09-29', { chars: DAILY_CHAR_LIMIT - 3 });
  await rejects(translateForUser(d, 'u1', 'hello', 'es'), 'resource-exhausted');
  assert.equal(calls.length, 0);
});

test('unsupported languages and a missing key are declined without calling DeepL', async () => {
  const { fetch, calls } = deepl();
  await rejects(translateForUser(deps(fetch), 'u1', 'hello', 'hi'), 'failed-precondition');
  await rejects(translateForUser(deps(fetch, { deeplKey: '' }), 'u1', 'hello', 'es'), 'failed-precondition');
  assert.equal(calls.length, 0);
});

test('DeepL quota exhausted (456) alerts the owner and declines', async () => {
  const { fetch } = deepl({ status: 456 });
  const d = deps(fetch);
  await quiet(() => rejects(translateForUser(d, 'u1', 'hello', 'es'), 'resource-exhausted'));
  assert.equal(d.mailer.sent.length, 1);
  assert.match(d.mailer.sent[0].subject, /deepl-quota/);
});

test('translateText rejects oversized text before counting anything', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  d.db.docs.set('users/pro', { isPremium: true });
  await rejects(translateText({ text: 'x'.repeat(1001), targetLang: 'es' }, { auth: { uid: 'pro', token: {} } }, d), 'invalid-argument');
  assert.equal(calls.length, 0);
  assert.equal(d.db.read('usage/pro_2026-09-29'), undefined);
});

test('translateText is premium-only and returns the provider', async () => {
  const { fetch } = deepl();
  const d = deps(fetch);
  d.db.docs.set('users/free', { isPremium: false });
  d.db.docs.set('users/pro', { isPremium: true });
  await rejects(translateText({ text: 'hi', targetLang: 'es' }, { auth: { uid: 'free', token: {} } }, d), 'permission-denied');
  const result = await translateText({ text: 'hello', targetLang: 'es' }, { auth: { uid: 'pro', token: {} } }, d);
  assert.deepEqual(result, { success: true, translation: 'hola', provider: 'deepl', sourceText: 'hello', targetLang: 'es' });
});
```

In `tests/unit/api-licensing.test.js`, delete the test "translateText returns the MyMemory translation for premium users" (MyMemory is no longer called by the server; the premium/auth test there stays).

- [ ] **Step 2: Run to verify they fail** — `node --test tests/unit/api-translate.test.js` → FAIL.

- [ ] **Step 3: Translate module** — create `web/api/_lib/translate.js`:

```js
// Premium translation: shared cache → per-user daily cap → DeepL. When DeepL
// can't help, the server declines and the extension falls back to MyMemory
// from the user's own browser (its own free quota). The server never calls MyMemory.
import crypto from 'node:crypto';
import { HttpsError } from './http.js';
import { alertOwner, day } from './alerts.js';

export const DAILY_CHAR_LIMIT = 60000;
export const MAX_TEXT_LENGTH = 1000;
export const DEEPL_TARGETS = { en: 'EN-US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT-BR', zh: 'ZH-HANS', ja: 'JA', ko: 'KO', ar: 'AR', ru: 'RU' };
const DEEPL_URL = 'https://api-free.deepl.com/v2/translate';

const cacheId = (lang, text) => crypto.createHash('sha256').update(`${lang}\n${text}`).digest('hex');

export async function translateForUser(deps, uid, text, lang) {
  const target = DEEPL_TARGETS[lang];
  if (!target || !deps.deeplKey) throw new HttpsError('failed-precondition', 'UNSUPPORTED_LANGUAGE');

  const cacheRef = deps.db.collection('translations').doc(cacheId(lang, text));
  const cached = await cacheRef.get();
  if (cached.exists) return { translation: cached.data().translation, provider: 'cache' };

  const usageRef = deps.db.collection('usage').doc(`${uid}_${day(deps.now())}`);
  const allowed = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const used = snap.exists ? snap.data().chars : 0;
    if (used + text.length > DAILY_CHAR_LIMIT) return false;
    tx.set(usageRef, { chars: used + text.length }, { merge: true });
    return true;
  });
  if (!allowed) throw new HttpsError('resource-exhausted', 'Daily translation limit reached');

  const response = await deps.fetch(DEEPL_URL, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${deps.deeplKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [text], target_lang: target })
  });
  if (response.status === 456) {
    await alertOwner(deps, 'deepl-quota', 'DeepL monthly character quota is used up; Premium translation is falling back to MyMemory until it resets.');
    throw new HttpsError('resource-exhausted', 'Translation quota reached');
  }
  if (!response.ok) throw new HttpsError('unavailable', 'Translation service unavailable');
  const translation = (await response.json()).translations?.[0]?.text;
  if (!translation) throw new HttpsError('unavailable', 'Translation service unavailable');

  await cacheRef.set({ lang, text, translation, provider: 'deepl', createdAt: deps.FieldValue.serverTimestamp() });
  return { translation, provider: 'deepl' };
}
```

- [ ] **Step 4: translateText** — in `web/api/_lib/licensing.js`, add `import { translateForUser, MAX_TEXT_LENGTH } from './translate.js';` and replace the whole `translateText` function with:

```js
// Premium translation (see translate.js)
export async function translateText(data, ctx, deps) {
  const { uid } = requireAuth(ctx);
  const { text, targetLang } = data;
  if (!text || typeof text !== 'string') throw new HttpsError('invalid-argument', 'Text is required');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpsError('invalid-argument', 'Text is too long');
  if (!targetLang || typeof targetLang !== 'string') throw new HttpsError('invalid-argument', 'Target language is required');

  const user = await deps.db.collection('users').doc(uid).get();
  if (!user.exists || !user.data().isPremium) throw new HttpsError('permission-denied', 'Premium subscription required');

  const { translation, provider } = await translateForUser(deps, uid, text, targetLang);
  return { success: true, translation, provider, sourceText: text, targetLang };
}
```

- [ ] **Step 5: Run tests** — `node --test tests/unit/api-translate.test.js tests/unit/api-licensing.test.js` → PASS.

- [ ] **Step 6: Lint, full suite, commit**

```bash
npm run lint && npm test
git add web/api tests
git commit -m "feat(api): DeepL translation with shared cache and per-user daily cap"
```

---

### Task 6: Policy pages, refund revocation and privacy updates

**Files:** Create `web/terms.html`, `web/refund.html`, `web/contact.html`, `tests/e2e/web-policies.test.js`. Modify `web/index.html`, `web/premium.html`, `web/privacy.html`, `web/style.css`, `web/api/_lib/webhook.js`, `web/api/_lib/licensing.js`, `tests/e2e/web-site.test.js`, `tests/e2e/web-privacy.test.js`, `tests/unit/api-http.test.js`, `tests/unit/api-licensing.test.js`.

**Interfaces:**
- Produces: footer on every page with links `privacy.html`, `terms.html`, `refund.html`, `contact.html`; checkout `.agree` line; `revokeLicenseForRefund(deps, refund)`; revoked licenses refused with `{ success: false, error: 'This license was refunded' }`.

- [ ] **Step 1: Failing unit tests** — append to `tests/unit/api-http.test.js`:

```js
const refunded = (paymentId) => ({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: paymentId } } } });

test('refund.processed revokes the license and the buyer\'s Premium', async () => {
  const db = fakeFirestore({
    'licenses/pay_R1': { key: 'SUBPIP-REFUNDED-0001', paymentId: 'pay_R1', verified: true, usedBy: 'u1' },
    'users/u1': { isPremium: true, licenseKey: 'SUBPIP-REFUNDED-0001' }
  });
  const res = fakeRes();
  await handleWebhook(webhookReq(refunded('pay_R1'), 'whsec'), res, { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(res.statusCode, 200);
  assert.equal(db.read('licenses/pay_R1').revoked, true);
  assert.deepEqual(db.read('users/u1'), { isPremium: false, licenseKey: null });
});

test('a refund leaves an account alone if it now uses a different license', async () => {
  const db = fakeFirestore({
    'licenses/pay_R2': { key: 'SUBPIP-OLDKEY01-0001', paymentId: 'pay_R2', verified: true, usedBy: 'u2' },
    'users/u2': { isPremium: true, licenseKey: 'SUBPIP-NEWKEY01-0001' }
  });
  await handleWebhook(webhookReq(refunded('pay_R2'), 'whsec'), fakeRes(), { db, FieldValue, razorpay: fakeRazorpay(), webhookSecret: 'whsec' });
  assert.equal(db.read('licenses/pay_R2').revoked, true);
  assert.equal(db.read('users/u2').isPremium, true);
});
```

Append to `tests/unit/api-licensing.test.js`:

```js
test('refunded licenses cannot be activated or claimed', async () => {
  const db = fakeFirestore({ 'licenses/pay_A1': { key: 'SUBPIP-AAAAAAAA-1111', verified: true, usedBy: null, revoked: true, email: 'buyer@example.com' } });
  assert.deepEqual(await activateLicense({ key: 'SUBPIP-AAAAAAAA-1111' }, signedIn('u1'), deps(db)), { success: false, error: 'This license was refunded' });
  const claim = await claimLicenseByEmail({}, signedIn('u1', { email: 'buyer@example.com', email_verified: true }), deps(db));
  assert.equal(claim.success, false);
  assert.equal(db.read('users/u1'), undefined);
});
```

Run: `node --test tests/unit/api-http.test.js tests/unit/api-licensing.test.js` → FAIL.

- [ ] **Step 2: Revocation** — in `web/api/_lib/licensing.js`:
  1. In `activateLicense`, after `const licenseDoc = snap.docs[0];` add:

```js
  if (licenseDoc.data().revoked) return { success: false, error: 'This license was refunded' };
```

  2. In `claimLicenseByEmail`, extend the candidate filter: `.filter((doc) => !doc.data().revoked && (!doc.data().usedBy || doc.data().usedBy === uid))`.
  3. Add (Firestore transactions must read before they write, so both documents are read first):

```js
export async function revokeLicenseForRefund(deps, refund) {
  const licenseDoc = await findLicenseByPaymentId(deps, refund.payment_id);
  if (!licenseDoc) return false;
  await deps.db.runTransaction(async (tx) => {
    const license = (await tx.get(licenseDoc.ref)).data();
    const userRef = license.usedBy ? deps.db.collection('users').doc(license.usedBy) : null;
    const user = userRef ? await tx.get(userRef) : null;
    tx.update(licenseDoc.ref, { revoked: true, revokedAt: deps.FieldValue.serverTimestamp(), refundId: refund.id || null });
    if (user && user.exists && user.data().licenseKey === license.key) tx.update(userRef, { isPremium: false, licenseKey: null });
  });
  return true;
}
```

  4. In `web/api/_lib/webhook.js`, import `revokeLicenseForRefund`, and replace `if (body.event !== 'payment.captured') return res.status(200).send('Event ignored');` with:

```js
    if (body.event === 'refund.processed') {
      const revoked = await revokeLicenseForRefund(deps, body.payload.refund.entity);
      return res.status(200).json({ success: true, revoked });
    }
    if (body.event !== 'payment.captured') return res.status(200).send('Event ignored');
```

Run the unit tests → PASS.

- [ ] **Step 3: Failing web tests** — create `tests/e2e/web-policies.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub } from '../helpers/web.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html'];

test('every page links all four policy pages in its footer', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const links = await page.$$eval('.site-footer a', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of ['privacy.html', 'terms.html', 'refund.html', 'contact.html']) assert.ok(links.includes(href), `${pagePath} footer lacks ${href}`);
    await page.close();
  }
});

test('refund policy states the 7-day no-questions refund and revocation', async () => {
  const page = await ctx.open('refund.html');
  const text = await page.$eval('article.prose', (el) => el.innerText);
  assert.match(text, /7 days/);
  assert.match(text, /no questions asked/i);
  assert.match(text, /license.*(deactivated|revoked)/i);
  await page.close();
});

test('terms and contact pages have the essentials', async () => {
  let page = await ctx.open('terms.html');
  let text = await page.$eval('article.prose', (el) => el.innerText);
  for (const part of ['Premium', 'lifetime', 'Refund', 'Contact']) assert.match(text, new RegExp(part), part);
  await page.close();
  page = await ctx.open('contact.html');
  assert.equal(await page.$eval('article.prose a[href^="mailto:"]', (a) => a.getAttribute('href')), 'mailto:tarunmonga2208@gmail.com');
  await page.close();
});

test('checkout says paying means agreeing to the Terms and Refund Policy', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  const agree = await page.$eval('.agree', (el) => ({ text: el.textContent, links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')) }));
  assert.match(agree.text, /agree/i);
  assert.deepEqual(agree.links, ['terms.html', 'refund.html']);
  await page.close();
});
```

In `tests/e2e/web-site.test.js`, change `const PAGES = [...]` to include the new pages: `['index.html', 'premium.html', 'privacy.html', 'terms.html', 'refund.html', 'contact.html']`.

In `tests/e2e/web-privacy.test.js`, in "the policy describes what the extension does today", add:

```js
  assert.match(text, /DeepL/);
  assert.match(text, /Gmail/);
  assert.doesNotMatch(text, /device identifier/i);
  assert.match(text, /cache/i);
```

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-policies.test.js tests/e2e/web-site.test.js tests/e2e/web-privacy.test.js` → FAIL.

- [ ] **Step 4: Shared footer** — in `web/index.html`, `web/premium.html` and `web/privacy.html`, replace the `<ul class="footer-links">…</ul>` block with:

```html
      <ul class="footer-links">
        <li><a href="privacy.html">Privacy</a></li>
        <li><a href="terms.html">Terms</a></li>
        <li><a href="refund.html">Refunds</a></li>
        <li><a href="contact.html">Contact</a></li>
        <li>© <span data-year></span> SubPIP</li>
      </ul>
```

- [ ] **Step 5: New pages** — each new page uses exactly the head, header and footer of `web/privacy.html` (title changed as noted) with this `<main>`.

`web/terms.html` (title `Terms of Service · SubPIP`):

```html
  <main class="container">
    <article class="prose">
      <h1>Terms of Service</h1>
      <p class="updated">Last updated: September 29, 2026</p>
      <section>
        <h2>1. The service</h2>
        <p>SubPIP is a browser extension that plays videos in Picture-in-Picture with subtitles. The free version is provided as is. SubPIP Premium adds caption translation, playback speed control and subtitles from a VTT/SRT link.</p>
      </section>
      <section>
        <h2>2. Premium license</h2>
        <p>Premium is a one-time payment (₹1000 in India, $15 elsewhere, shown at checkout) for a lifetime license, for as long as SubPIP is offered. A license activates on one SubPIP account and works in every browser where you sign in to that account. Licenses are personal: please don't share your account or key.</p>
      </section>
      <section>
        <h2>3. Payments and refunds</h2>
        <p>Payments are processed by Razorpay. You can get a full refund within 7 days of purchase, no questions asked; see the <a href="refund.html">Refund Policy</a>. A refunded license is deactivated.</p>
      </section>
      <section>
        <h2>4. Fair use</h2>
        <p>Premium translation includes a generous daily allowance per account. Automated or abusive use of SubPIP's servers may be limited or blocked, and licenses obtained through fraud may be revoked.</p>
      </section>
      <section>
        <h2>5. Third-party sites</h2>
        <p>SubPIP works on video sites you already use. Their content and terms remain theirs; SubPIP does not host or distribute videos or subtitles.</p>
      </section>
      <section>
        <h2>6. No warranty and liability</h2>
        <p>SubPIP is provided "as is", without warranties of any kind. Sites change, and features may stop working on some of them. To the extent the law allows, our total liability is limited to the amount you paid for Premium.</p>
      </section>
      <section>
        <h2>7. Changes</h2>
        <p>We may update these terms; the "Last updated" date will change. Continuing to use SubPIP after a change means you accept the updated terms.</p>
      </section>
      <section>
        <h2>8. Contact</h2>
        <p>Questions about these terms: <a href="mailto:tarunmonga2208@gmail.com">tarunmonga2208@gmail.com</a>. See also the <a href="contact.html">Contact page</a>.</p>
      </section>
    </article>
  </main>
```

`web/refund.html` (title `Refund Policy · SubPIP`):

```html
  <main class="container">
    <article class="prose">
      <h1>Refund Policy</h1>
      <p class="updated">Last updated: September 29, 2026</p>
      <section>
        <h2>7-day refund, no questions asked</h2>
        <p>If SubPIP Premium isn't right for you, you can get a full refund within 7 days of purchase, no questions asked.</p>
      </section>
      <section>
        <h2>How to request a refund</h2>
        <p>Email <a href="mailto:tarunmonga2208@gmail.com">tarunmonga2208@gmail.com</a> from the address you bought with, or include your Razorpay payment ID (it's in your license email). We'll process it within 3 business days.</p>
      </section>
      <section>
        <h2>What happens after a refund</h2>
        <p>The refund goes back to your original payment method through Razorpay; your bank may take 5–7 business days to show it. When the refund is processed, your license is deactivated and Premium features switch off on your account.</p>
      </section>
      <section>
        <h2>After 7 days</h2>
        <p>Refunds after 7 days aren't guaranteed, but if a Premium feature stops working for you and we can't fix it, contact us and we'll make it right.</p>
      </section>
    </article>
  </main>
```

`web/contact.html` (title `Contact · SubPIP`):

```html
  <main class="container">
    <article class="prose">
      <h1>Contact</h1>
      <section>
        <h2>Email</h2>
        <p><a href="mailto:tarunmonga2208@gmail.com">tarunmonga2208@gmail.com</a></p>
        <p>We usually reply within 2 business days.</p>
      </section>
      <section>
        <h2>Lost your license key?</h2>
        <p>Use "Lost your license key?" on the <a href="premium.html">Premium page</a> to have it emailed to the address you bought with, or press "Check payment" in the SubPIP popup.</p>
      </section>
      <section>
        <h2>Refunds and privacy</h2>
        <p>See the <a href="refund.html">Refund Policy</a> and the <a href="privacy.html">Privacy Policy</a>.</p>
      </section>
    </article>
  </main>
```

- [ ] **Step 6: Checkout agreement line** — in `web/premium.html`, insert after `<p class="secure-badge">Secured by Razorpay</p>`:

```html
        <p class="agree">By paying you agree to the <a href="terms.html">Terms</a> and <a href="refund.html">Refund Policy</a>.</p>
```

Append to `web/style.css`:

```css
.agree { margin-top: 8px; color: var(--text-2); font-size: 13px; text-align: center; }
.agree a { color: var(--text-2); }
```

- [ ] **Step 7: Privacy updates** — in `web/privacy.html`:
  1. In section 2, replace `whether your account is Premium, your license key and a device identifier used to enforce one license per device. Stored in Firebase Firestore.` with `whether your account is Premium and your license key. Stored in Firebase Firestore.`
  2. In section 3, replace the translation bullet with:

```html
          <li>To translate captions, only when you turn translation on. Free users' captions go to MyMemory directly from your browser. Premium users' captions go to our server, which checks that your account is Premium and translates them with DeepL; the server keeps a shared cache of translated caption lines (the text and its translation, not who asked for it) so repeated lines are not sent again. If the server can't translate a line, your browser uses MyMemory instead.</li>
```

  3. Replace the license bullet in section 3 with `<li>To create, verify and activate your Premium license, to email it to you after purchase (and again if you use "Lost your license key?"), and to let you recover it with "Check payment".</li>`.
  4. In section 4, add before the Razorpay item:

```html
          <li><strong>DeepL</strong> – translates Premium users' caption text. <a href="https://www.deepl.com/privacy" target="_blank" rel="noopener">DeepL privacy</a>.</li>
          <li><strong>Google (Gmail)</strong> – sends your license email and receipt. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google privacy</a>.</li>
```

- [ ] **Step 8: Run tests** — `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-policies.test.js tests/e2e/web-site.test.js tests/e2e/web-privacy.test.js tests/e2e/web-review-fixes.test.js` → PASS.

- [ ] **Step 9: Lint, full suite, commit**

```bash
npm run lint && npm test
git add web tests
git commit -m "feat: Terms, Refund and Contact pages; refunds revoke licenses; privacy updates"
```

---

### Task 7: Configuration docs and final verification

**Files:** Modify `README.md`.

- [ ] **Step 1: README configuration** — replace the "Backend + website" Quick Start item with:

```markdown
2. **Backend + website**: `web/` deploys to Vercel with `cd web && vercel --prod`; `web/api/` holds the server functions (orders, payments, licenses, license emails, translation, health). Firestore rules deploy with `firebase deploy --only firestore:rules` (free Spark plan).

### Configuration (Vercel → Project → Environment Variables, Production)

| Variable | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON (Admin SDK) |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook secret (events: `payment.captured`, `refund.processed`) → `https://subpip.vercel.app/api/razorpayWebhook` |
| `DEEPL_API_KEY` | DeepL API Free key (Premium translation; optional — without it translation falls back to MyMemory) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail account and app password for license emails and alerts |
| `ALERT_EMAIL` | Optional; where owner alerts go (defaults to `GMAIL_USER`) |

`GET /api/health` reports which settings are present (never their values) and returns 503 if a required one is missing; point an uptime monitor at it.
```

- [ ] **Step 2: Full check** — `npm run lint && npm test && npm run build`. Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: configuration for production (env vars, webhook events, health)"
```

- [ ] **Step 4: Report** — list the owner's setup steps: create the DeepL API Free key and a Gmail app password, add `DEEPL_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` (optionally `ALERT_EMAIL`) in Vercel production, add `refund.processed` to the Razorpay webhook events, then deploy (`cd web && vercel --prod`) and verify `/api/health` returns `ok: true`; optionally add an UptimeRobot monitor on `/api/health`.
