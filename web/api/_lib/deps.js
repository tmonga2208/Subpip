// Live dependencies for the API, built from Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON
//   RAZORPAY_KEY_SECRET       Razorpay API key secret (pairs with RAZORPAY_KEY_ID)
//   RAZORPAY_WEBHOOK_SECRET   secret set on the Razorpay webhook
//   DEEPL_API_KEY             DeepL API Free key (Premium translation)
//   RESEND_API_KEY            Resend API key (license emails, alerts, feedback)
//   EMAIL_FROM                sender on a domain verified in Resend, e.g. SubPIP <licenses@example.com>
//   ALERT_EMAIL               optional; owner alerts go here (default: the support address)

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Razorpay from 'razorpay';
import { waitUntil } from '@vercel/functions';
import { createMailer } from './mailer.js';
import { SUPPORT_EMAIL } from './emails.js';

export const RAZORPAY_KEY_ID = 'rzp_live_S9zPibMgaqE7VV';

// Which settings are present (never their values)
export function configStatus(env) {
  return {
    firebase: !!env.FIREBASE_SERVICE_ACCOUNT,
    razorpay: !!env.RAZORPAY_KEY_SECRET,
    webhook: !!env.RAZORPAY_WEBHOOK_SECRET,
    deepl: !!env.DEEPL_API_KEY,
    email: !!(env.RESEND_API_KEY && env.EMAIL_FROM)
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
    // Replies to any email reach support, whatever address sends it
    mailer: createMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: SUPPORT_EMAIL }),
    alertTo: env.ALERT_EMAIL || SUPPORT_EMAIL,
    fetch: globalThis.fetch,
    now: () => new Date(),
    // Finish work after the response is sent (Vercel keeps the function alive)
    defer: (promise) => waitUntil(promise)
  };
}
