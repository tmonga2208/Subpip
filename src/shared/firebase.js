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
// SubPIP's website. (It used to be on vercel.app; that address still answers,
// for the copies of older versions that are installed.)
export const SITE_URL = 'https://subpip.online';
// SubPIP's server API (Vercel Functions in web/api/)
export const API_BASE_URL = `${SITE_URL}/api`;
// The page Chrome opens after SubPIP is uninstalled: one anonymous question
export const UNINSTALL_URL = `${SITE_URL}/uninstalled.html`;
// Where Premium is bought
export const PREMIUM_URL = `${SITE_URL}/premium.html`;

// ID tokens last an hour; refresh a little early
export const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
