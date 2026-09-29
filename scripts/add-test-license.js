// Add a test license key to Firestore using the Admin SDK.
// Clients can no longer write to `licenses` (see firestore.rules).
//
// Usage (needs `gcloud auth application-default login` or GOOGLE_APPLICATION_CREDENTIALS):
//   npm --prefix web install
//   node scripts/add-test-license.js [LICENSE-KEY]

const path = require('path');
const { createRequire } = require('module');
const requireFromFunctions = createRequire(path.join(__dirname, '../web/package.json'));
const { initializeApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore, FieldValue } = requireFromFunctions('firebase-admin/firestore');

initializeApp({ projectId: 'subpip-premium' });
const db = getFirestore();

async function addTestLicense() {
    const testLicenseKey = process.argv[2] || 'SUBPIP-TEST-2024';

    await db.collection('licenses').doc('test_license_001').set({
        key: testLicenseKey,
        createdAt: FieldValue.serverTimestamp(),
        paymentId: 'test_payment_001',
        email: 'test@example.com',
        usedBy: null,
        activatedAt: null,
        deviceId: null,
        verified: true
    });

    console.log('✅ Test license created:', testLicenseKey);
}

addTestLicense().catch((error) => {
    console.error(error);
    process.exit(1);
});
