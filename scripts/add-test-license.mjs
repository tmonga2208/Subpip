// Create a Premium license directly in Firestore, for testing or manual
// support. Every run makes a new random key (a fixed key in a public repo
// would be a free license for anyone).
//
// Usage:
//   npm --prefix web install
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json node scripts/add-test-license.mjs [email]
//
// Redeem the printed key in the popup under Account & license. With an email,
// "Check payment" also finds it for that (verified) account.

import { createRequire } from 'node:module';
import { generateLicenseKey } from '../web/api/_lib/licensing.js';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault(), projectId: 'subpip-premium' });
const db = getFirestore();

const email = (process.argv[2] || '').toLowerCase().trim() || null;
const key = generateLicenseKey();
const ref = db.collection('licenses').doc(`manual_${Date.now()}`);

await ref.create({
  key,
  paymentId: null,
  email,
  amount: 0,
  currency: null,
  contact: null,
  createdAt: FieldValue.serverTimestamp(),
  usedBy: null,
  activatedAt: null,
  deviceId: null,
  verified: true,
  manual: true
});

console.log(`License created: ${key}${email ? ` (claimable by ${email})` : ''}`);
console.log(`Firestore doc: licenses/${ref.id}`);
