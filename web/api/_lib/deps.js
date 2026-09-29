// Live dependencies for the API, built from Vercel environment variables:
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON (Firebase console → Project settings → Service accounts)
//   RAZORPAY_KEY_SECRET       Razorpay API key secret (pairs with the public key id below)
//   RAZORPAY_WEBHOOK_SECRET   secret set on the Razorpay webhook
//   MYMEMORY_EMAIL            optional contact email for MyMemory's higher free limit

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import Razorpay from 'razorpay';

const RAZORPAY_KEY_ID = 'rzp_live_S9zPibMgaqE7VV';

export function liveDeps() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  return {
    db: getFirestore(),
    auth: getAuth(),
    FieldValue,
    razorpay: new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }),
    fetch: globalThis.fetch,
    myMemoryEmail: process.env.MYMEMORY_EMAIL || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || ''
  };
}
