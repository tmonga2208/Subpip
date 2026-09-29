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
