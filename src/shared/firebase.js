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
// SubPIP's server API (Vercel Functions in web/api/)
export const API_BASE_URL = 'https://subpip.vercel.app/api';
// The page Chrome opens after SubPIP is uninstalled: one anonymous question
export const UNINSTALL_URL = 'https://subpip.vercel.app/uninstalled.html';

// ID tokens last an hour; refresh a little early
export const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
