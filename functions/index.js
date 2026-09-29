/**
 * SubPIP Premium - Payment Verification Cloud Functions
 *
 * Licenses are only ever created and activated here. Clients have no direct
 * access to the `licenses` collection and cannot write `users.isPremium`
 * (see firestore.rules).
 */

const functions = require('firebase-functions/v1');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const { isAcceptedPayment } = require('./pricing');

initializeApp();
const db = getFirestore();

const REGION = 'asia-south1';
const RAZORPAY_KEY_ID = 'rzp_live_S9zPibMgaqE7VV';

// Generate unique license key
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const timestamp = Date.now().toString(36).toUpperCase();
    let key = 'SUBPIP-';
    for (let i = 0; i < 8; i++) {
        key += chars.charAt(crypto.randomInt(chars.length));
    }
    key += '-' + timestamp.slice(-4);
    return key;
}

// Verify Razorpay webhook signature against the raw request body
function verifyWebhookSignature(rawBody, signature, secret) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function razorpayClient() {
    return new Razorpay({
        key_id: RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

// Fetch a payment from Razorpay and make sure it is a real, captured payment
async function fetchCapturedPayment(paymentId, { requireFullPrice }) {
    const razorpay = razorpayClient();
    let payment = await razorpay.payments.fetch(paymentId);

    if (payment.status === 'authorized') {
        payment = await razorpay.payments.capture(paymentId, payment.amount, payment.currency);
    }
    if (payment.status !== 'captured' || !isAcceptedPayment(payment, { requireFullPrice })) {
        return null;
    }
    return payment;
}

// Find an existing license for a payment (new docs are keyed by paymentId,
// older ones were created with other ids)
async function findLicenseByPaymentId(paymentId) {
    const byId = await db.collection('licenses').doc(paymentId).get();
    if (byId.exists) return byId;
    const snap = await db.collection('licenses').where('paymentId', '==', paymentId).limit(1).get();
    return snap.empty ? null : snap.docs[0];
}

// Create a license for a captured payment. Idempotent: the doc id is the
// payment id, so the webhook and confirmPayment can race safely.
async function createLicenseForPayment(payment) {
    const existing = await findLicenseByPaymentId(payment.id);
    if (existing) return existing.data().key;

    const email = (payment.email || payment.notes?.email || '').toLowerCase().trim();
    const licenseKey = generateLicenseKey();
    const ref = db.collection('licenses').doc(payment.id);

    try {
        await ref.create({
            key: licenseKey,
            paymentId: payment.id,
            email: email || null,
            amount: payment.amount,
            contact: payment.contact || null,
            createdAt: FieldValue.serverTimestamp(),
            usedBy: null,
            activatedAt: null,
            deviceId: null,
            verified: true
        });
    } catch (error) {
        // ALREADY_EXISTS: the other path created it first
        if (error.code === 6) {
            return (await ref.get()).data().key;
        }
        throw error;
    }

    console.log(`License created: ${licenseKey} for ${email} (Payment: ${payment.id})`);
    return licenseKey;
}

// Licenses created by the old client-side flow have `isValid` instead of
// `verified`. Confirm their payment with Razorpay once, then mark verified.
async function ensureLicenseVerified(licenseDoc) {
    const data = licenseDoc.data();
    if (data.verified === true) return true;
    if (!data.paymentId) return false;

    try {
        const payment = await fetchCapturedPayment(data.paymentId, { requireFullPrice: false });
        if (!payment) return false;
        await licenseDoc.ref.update({
            verified: true,
            email: (data.email || data.purchaserEmail || payment.email || '').toLowerCase() || null
        });
        return true;
    } catch (error) {
        console.error('Legacy license verification failed:', licenseDoc.id, error);
        return false;
    }
}

// Bind a license to a user and mark the user premium, atomically
async function bindLicenseToUser(licenseRef, uid, deviceId) {
    return db.runTransaction(async (tx) => {
        const license = await tx.get(licenseRef);
        const data = license.data();

        if (data.usedBy && data.usedBy !== uid) {
            return { success: false, error: 'License already used by another account' };
        }

        tx.update(licenseRef, {
            usedBy: uid,
            activatedAt: data.activatedAt || FieldValue.serverTimestamp(),
            deviceId: deviceId || null
        });
        tx.set(db.collection('users').doc(uid), {
            isPremium: true,
            licenseKey: data.key,
            deviceId: deviceId || null
        }, { merge: true });

        return { success: true, licenseKey: data.key };
    });
}

function requireAuth(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Please log in first');
    }
    return context.auth;
}

/**
 * Razorpay Webhook Handler
 * Backup path: creates the license even if the buyer closes the page
 * before confirmPayment runs.
 */
exports.razorpayWebhook = functions
    .region(REGION)
    .runWith({ secrets: ['RAZORPAY_WEBHOOK_SECRET'] })
    .https.onRequest(async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Method Not Allowed');
        }

        try {
            const signature = req.headers['x-razorpay-signature'];
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

            if (!signature || !webhookSecret) {
                console.error('Missing signature or webhook secret');
                return res.status(400).send('Bad Request');
            }

            if (!verifyWebhookSignature(req.rawBody, signature, webhookSecret)) {
                console.error('Invalid webhook signature');
                return res.status(401).send('Unauthorized');
            }

            if (req.body.event !== 'payment.captured') {
                return res.status(200).send('Event ignored');
            }

            const payment = req.body.payload.payment.entity;
            if (!isAcceptedPayment(payment)) {
                console.error('Payment amount/currency mismatch:', payment.id);
                return res.status(200).send('Ignored: amount mismatch');
            }

            await createLicenseForPayment(payment);
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error('Webhook error:', error);
            return res.status(500).send('Internal Server Error');
        }
    });

/**
 * Confirm Payment
 * Called by the premium page after Razorpay checkout succeeds. The payment is
 * re-fetched from Razorpay, so a forged payment id gets nothing.
 */
exports.confirmPayment = functions
    .region(REGION)
    .runWith({ secrets: ['RAZORPAY_KEY_SECRET'] })
    .https.onCall(async (data) => {
        const paymentId = typeof data.paymentId === 'string' ? data.paymentId.trim() : '';
        if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
            throw new functions.https.HttpsError('invalid-argument', 'Valid payment ID is required');
        }

        let payment;
        try {
            payment = await fetchCapturedPayment(paymentId, { requireFullPrice: true });
        } catch (error) {
            console.error('Razorpay fetch error:', paymentId, error);
            throw new functions.https.HttpsError('not-found', 'Payment not found');
        }
        if (!payment) {
            throw new functions.https.HttpsError('failed-precondition', 'Payment not completed');
        }

        const licenseKey = await createLicenseForPayment(payment);
        return { licenseKey, email: payment.email || null };
    });

/**
 * Activate License
 * Binds a license key to the signed-in user.
 */
exports.activateLicense = functions
    .region(REGION)
    .runWith({ secrets: ['RAZORPAY_KEY_SECRET'] })
    .https.onCall(async (data, context) => {
        const { uid } = requireAuth(context);
        const key = typeof data.key === 'string' ? data.key.trim().toUpperCase() : '';
        if (!key) {
            throw new functions.https.HttpsError('invalid-argument', 'License key is required');
        }

        const snap = await db.collection('licenses').where('key', '==', key).limit(1).get();
        if (snap.empty) {
            return { success: false, error: 'Invalid license key' };
        }

        const licenseDoc = snap.docs[0];
        if (!(await ensureLicenseVerified(licenseDoc))) {
            return { success: false, error: 'License payment not verified' };
        }

        return bindLicenseToUser(licenseDoc.ref, uid, data.deviceId);
    });

/**
 * Claim License By Email
 * Finds a paid license for the signed-in user's verified email and activates it.
 */
exports.claimLicenseByEmail = functions
    .region(REGION)
    .runWith({ secrets: ['RAZORPAY_KEY_SECRET'] })
    .https.onCall(async (data, context) => {
        const { uid, token } = requireAuth(context);
        const email = (token.email || '').toLowerCase();

        if (!email) {
            throw new functions.https.HttpsError('failed-precondition', 'Account has no email');
        }
        if (!token.email_verified) {
            throw new functions.https.HttpsError('failed-precondition', 'EMAIL_NOT_VERIFIED');
        }

        const [byEmail, byLegacyEmail] = await Promise.all([
            db.collection('licenses').where('email', '==', email).get(),
            db.collection('licenses').where('purchaserEmail', '==', email).get()
        ]);
        const candidates = [...byEmail.docs, ...byLegacyEmail.docs]
            .filter((doc) => !doc.data().usedBy || doc.data().usedBy === uid);

        // Prefer a license already bound to this user, then an unused one
        candidates.sort((a, b) => (b.data().usedBy === uid) - (a.data().usedBy === uid));

        for (const licenseDoc of candidates) {
            if (await ensureLicenseVerified(licenseDoc)) {
                return bindLicenseToUser(licenseDoc.ref, uid, data.deviceId);
            }
        }
        return { success: false, error: 'No payment found for this email. Please complete payment first.' };
    });

/**
 * Translate Text
 * Premium feature: Real-time caption translation using Google Cloud Translate
 */
exports.translateText = functions
    .region(REGION)
    .https.onCall(async (data, context) => {
        const { uid } = requireAuth(context);
        const { text, targetLang } = data;

        if (!text || typeof text !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'Text is required');
        }

        if (!targetLang || typeof targetLang !== 'string') {
            throw new functions.https.HttpsError('invalid-argument', 'Target language is required');
        }

        try {
            const userDoc = await db.collection('users').doc(uid).get();

            if (!userDoc.exists || !userDoc.data().isPremium) {
                throw new functions.https.HttpsError('permission-denied', 'Premium subscription required');
            }

            const { Translate } = require('@google-cloud/translate').v2;
            const translate = new Translate();
            const [translation] = await translate.translate(text, targetLang);

            return {
                success: true,
                translation: translation,
                sourceText: text,
                targetLang: targetLang
            };

        } catch (error) {
            console.error('Translation error:', error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError('internal', 'Translation failed');
        }
    });
