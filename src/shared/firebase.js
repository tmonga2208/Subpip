// Firebase project config shared by the popup and background

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD6kJ1fXCbpKD1z2gtXXuOwb4QWRs9orJY",
  authDomain: "subpip-premium.firebaseapp.com",
  projectId: "subpip-premium",
  storageBucket: "subpip-premium.firebasestorage.app"
};

export const AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
export const TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`;
export const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
export const FUNCTIONS_BASE_URL = `https://asia-south1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net`;

// ID tokens last an hour; refresh a little early
export const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
