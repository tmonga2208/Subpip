# Production Hardening (Payments, Licensing, Translation, Monitoring)

**Date:** 2026-09-29
**Status:** Draft for review

## Goal

Make SubPIP safe to sell: no paying user gets locked out, Premium translation survives real usage, the site meets payment-gateway policy expectations, every buyer reliably receives their key, payments follow Razorpay's standard server-verified flow, and the owner learns about failures without watching logs.

## Scope

In scope (owner's selection of the production review): #1 device lock, #2 translation, #4 policy pages, #5 license emails, #6 Razorpay Orders, #7 monitoring.

Out of scope: hosting change (stays on Vercel Hobby, owner accepts the non-commercial-terms risk), real-site QA (owner), CI, API rate limiting beyond the lost-key form, admin tooling beyond refund-driven revocation, new Premium features.

## Decisions

| Question | Choice |
|---|---|
| Devices per license | **Unlimited, tied to the account.** A license binds to one account; Premium works in any browser signed in to it. |
| Translation provider | **DeepL API Free** (500k chars/month) behind a shared server-side cache, with a per-user daily cap. |
| Email transport | **Owner's Gmail via an app password** (Nodemailer, SMTP). |
| Refund terms | **7 days, no questions asked.** A refund revokes the license. |

## 1. Premium follows the account (#1)

- Remove the browser fingerprint (`LicenseManager.getDeviceId`) and the device comparison (`validateSession`). The popup decides Premium solely from `users/{uid}.isPremium`.
- The server stops reading or writing `deviceId`; existing `deviceId` values in Firestore are ignored.
- A license still binds to exactly one account (`licenses.usedBy`), enforced server-side as today.

## 2. Translation (#2)

Server endpoint `translateText` (Premium only, as today):

1. **Cache:** look up `translations/{sha256(lang + "\n" + text)}`. A hit is returned immediately, costs nothing, and does not count toward the user's cap.
2. **Language support:** DeepL target codes: en→`EN-US`, es→`ES`, fr→`FR`, de→`DE`, it→`IT`, pt→`PT-BR`, zh→`ZH-HANS`, ja→`JA`, ko→`KO`, ar→`AR`, ru→`RU`. Any other language (e.g. `hi`) is **unsupported** on the server.
3. **Per-user cap:** 60,000 new characters per user per UTC day, tracked in `usage/{uid}_{YYYY-MM-DD}`.
4. **DeepL call** with `DEEPL_API_KEY`; the result is written to the cache.
5. **Fallback:** when the language is unsupported, the user is over the cap, DeepL's quota is exhausted (HTTP 456), or DeepL fails, the server responds with an error (`resource-exhausted`, HTTP 429, or `failed-precondition` for unsupported). The extension already falls back to MyMemory **from the user's own browser**, which has its own per-IP quota. The server never calls MyMemory.
6. DeepL quota exhaustion triggers an owner alert (throttled, §6).

## 3. Policy pages and refunds (#4)

- New pages on the shared site layout: `terms.html` (Terms of Service), `refund.html` (7-day no-questions refund; refund revokes the license; how to request), `contact.html` (email, expected response time). Every page's footer links Privacy, Terms, Refunds, Contact. The checkout shows "By paying you agree to the Terms and Refund Policy" with links.
- Pages are templates, not legal advice; the owner may need to add a business address/phone for Razorpay.
- **Refund revocation:** the webhook handles `refund.processed`: it finds the license by `payload.refund.entity.payment_id`, marks it `revoked: true` with `revokedAt`, and sets the bound user's `isPremium: false, licenseKey: null` (only if that user's `licenseKey` matches). `activateLicense` and `claimLicenseByEmail` refuse revoked licenses.
- Privacy policy updates: remove the device identifier; add DeepL (Premium translation) and Google/Gmail (license emails); describe the server translation cache and the lost-key email.

## 4. License emails (#5)

- `createLicenseForPayment` reports whether *this call* created the license (`{ key, created }`). Only the creating call sends the email, so checkout and webhook racing never send twice.
- Email to the purchase email: subject "Your SubPIP Premium license", plain text + simple HTML: key, three activation steps, receipt (amount formatted per currency, payment ID), refund note, support contact.
- Sending failure never fails the purchase; it is logged and alerts the owner.
- **Lost-key form** on the checkout page → `resendLicense { email }`: at most one email per address per 10 minutes (`resend/{sha256(email)}`); sends all non-revoked keys bought with that email **only to that email**; always answers the same generic message ("If a purchase exists for that email, we've sent the license to it") so it can't reveal who bought.

## 5. Razorpay Orders (#6)

- `createOrder { currency, email }`: currency must be a key of the price table (INR/USD); the server sets the amount from the table and calls `razorpay.orders.create({ amount, currency, receipt, notes: { email } })`. Returns `{ orderId, amount, currency, keyId }`.
- Checkout calls `createOrder` (currency still chosen from the time zone), then opens Razorpay with `order_id`, the returned amount and currency.
- `confirmPayment { paymentId, orderId, signature }`: verifies `HMAC_SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)` in constant time (mismatch → `invalid-argument`), re-fetches the payment, requires `payment.order_id === orderId`, captured, and accepted by the price table; then creates the license (idempotent) and emails it. Calls without an order ID/signature are rejected; such buyers still get the license via the webhook and email.
- The webhook, idempotency and legacy-license verification are unchanged.

## 6. Monitoring (#7)

- **Structured logs:** one JSON line per notable event (`{ level, event, ...fields }`) for Vercel's log search.
- **Owner alerts** by email to `ALERT_EMAIL` (default `GMAIL_USER`), throttled to 3 per alert type per UTC day (`alerts/{type}_{date}`), never throwing:
  - `license-creation-failed`: a captured, accepted payment for which license creation threw;
  - `license-email-failed`;
  - `internal-error`: unexpected errors in any endpoint;
  - `deepl-quota`: DeepL returned 456.
- **Health:** `GET /api/health` → `200 { ok: true, config }` when required settings are present, else `503`; `config` lists each setting as `true/false` (never values): `firebase`, `razorpay`, `webhook`, `deepl`, `email`. Suitable for a free uptime monitor.

## Configuration (Vercel env, production)

Existing: `FIREBASE_SERVICE_ACCOUNT`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. New: `DEEPL_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, optional `ALERT_EMAIL`. Razorpay webhook events: `payment.captured`, `refund.processed`.

Required for `ok: true`: firebase, razorpay, webhook, email. DeepL missing makes translation fall back to MyMemory but does not fail health.

## Data (Firestore, server-only; clients have no access under current rules)

| Collection | Doc id | Fields |
|---|---|---|
| `licenses` | payment id | + `revoked`, `revokedAt` |
| `users` | uid | `isPremium`, `licenseKey` (no `deviceId`) |
| `translations` | sha256(lang+text) | `lang`, `text`, `translation`, `provider`, `createdAt` |
| `usage` | `{uid}_{date}` | `chars` |
| `resend` | sha256(email) | `lastSentAt` (ms) |
| `alerts` | `{type}_{date}` | `count` |

## Testing

- Unit (fakes for Firestore, Razorpay incl. orders, mailer, DeepL fetch, clock): signature valid/invalid/mismatched order; created-vs-existing email once; race; resend rate limit and generic answer; revoked licenses refused; refund revocation; translation cache hit/miss, cap, unsupported language, DeepL 456 → alert + exhausted; alert throttle; health config/503; account-only Premium (no device fields).
- E2E: checkout uses `createOrder` then `confirmPayment` with signature (stubbed); lost-key form; policy pages pass the cross-page checks (no sideways scroll, links resolve); popup Premium ignores `deviceId`.
- `npm run lint` and `npm test` pass.
