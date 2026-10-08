// Firebase Auth + license calls for the popup, over REST (the Firebase SDK's
// remote code loading is not allowed in extension pages)

import { FIREBASE_CONFIG, AUTH_BASE_URL, TOKEN_URL, FIRESTORE_BASE_URL, API_BASE_URL, TOKEN_MAX_AGE_MS } from '../shared/firebase.js';

// License Manager using Firebase REST APIs
export class LicenseManager {
    constructor() {
        this.idToken = null;
        this.refreshToken = null;
        this.user = null;
        this.tokenTimestamp = 0;
    }

    async init() {
        // Try to restore session from storage
        const stored = await chrome.storage.local.get(['firebaseAuth']);
        if (stored.firebaseAuth) {
            this.idToken = stored.firebaseAuth.idToken;
            this.refreshToken = stored.firebaseAuth.refreshToken;
            this.user = stored.firebaseAuth.user;
            this.tokenTimestamp = stored.firebaseAuth.timestamp || 0;

            // Check if token needs refresh (tokens expire in 1 hour)
            const tokenAge = Date.now() - (stored.firebaseAuth.timestamp || 0);
            if (tokenAge > TOKEN_MAX_AGE_MS) {
                await this.refreshIdToken();
            }
        }
        return this;
    }

    // Sign up with email/password
    async signUp(email, password) {
        try {
            const response = await fetch(`${AUTH_BASE_URL}/accounts:signUp?key=${FIREBASE_CONFIG.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            });

            const data = await response.json();

            if (data.error) {
                return { success: false, error: this.parseAuthError(data.error.message) };
            }

            await this.setSession(data);

            // Create user document in Firestore
            await this.createUserDocument(data.localId, email);

            return { success: true, user: this.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Sign in with email/password
    async signIn(email, password) {
        try {
            const response = await fetch(`${AUTH_BASE_URL}/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            });

            const data = await response.json();

            if (data.error) {
                return { success: false, error: this.parseAuthError(data.error.message) };
            }

            await this.setSession(data);
            return { success: true, user: this.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Sign out
    async signOut() {
        this.idToken = null;
        this.refreshToken = null;
        this.user = null;
        await chrome.storage.local.remove(['firebaseAuth']);
        return { success: true };
    }

    // Refresh ID token
    async refreshIdToken() {
        if (!this.refreshToken) return false;

        try {
            const response = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken
                })
            });

            const data = await response.json();

            if (data.error) {
                await this.signOut();
                return false;
            }

            this.idToken = data.id_token;
            this.refreshToken = data.refresh_token;
            this.tokenTimestamp = Date.now();

            await chrome.storage.local.set({
                firebaseAuth: {
                    idToken: this.idToken,
                    refreshToken: this.refreshToken,
                    user: this.user,
                    timestamp: Date.now()
                }
            });

            return true;
        } catch (error) {
            return false;
        }
    }

    // Set session after login/signup
    async setSession(authData) {
        this.idToken = authData.idToken;
        this.refreshToken = authData.refreshToken;
        this.tokenTimestamp = Date.now();
        this.user = {
            uid: authData.localId,
            email: authData.email
        };

        await chrome.storage.local.set({
            firebaseAuth: {
                idToken: this.idToken,
                refreshToken: this.refreshToken,
                user: this.user,
                timestamp: Date.now()
            }
        });
    }

    // Create user document in Firestore
    async createUserDocument(uid, email) {
        try {
            await fetch(`${FIRESTORE_BASE_URL}/users/${uid}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.idToken}`
                },
                body: JSON.stringify({
                    fields: {
                        email: { stringValue: email },
                        createdAt: { timestampValue: new Date().toISOString() },
                        isPremium: { booleanValue: false },
                        licenseKey: { nullValue: null }
                    }
                })
            });
        } catch (error) {
            console.error('Error creating user document:', error);
        }
    }

    // Get current user
    getCurrentUser() {
        return this.user;
    }

    // Check if logged in
    isLoggedIn() {
        return !!this.idToken && !!this.user;
    }

    // Get user's premium status from Firestore
    async getUserStatus(uid) {
        try {
            const response = await fetch(`${FIRESTORE_BASE_URL}/users/${uid}`, {
                headers: {
                    'Authorization': `Bearer ${this.idToken}`
                }
            });

            const data = await response.json();

            if (data.error) {
                return { success: false, error: data.error.message };
            }

            const fields = data.fields || {};
            return {
                success: true,
                data: {
                    email: fields.email?.stringValue,
                    isPremium: fields.isPremium?.booleanValue || false,
                    licenseKey: fields.licenseKey?.stringValue || null,
                    // A year of Premium: when it ends (milliseconds); null for lifetime
                    premiumUntil: Number(fields.premiumUntil?.integerValue ?? fields.premiumUntil?.doubleValue) || null
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Call an HTTPS callable Cloud Function as the signed-in user
    async callFunction(name, data = {}) {
        const tokenAge = Date.now() - (this.tokenTimestamp || 0);
        if (this.refreshToken && tokenAge > TOKEN_MAX_AGE_MS) {
            await this.refreshIdToken();
        }

        const headers = { 'Content-Type': 'application/json' };
        if (this.idToken) headers['Authorization'] = `Bearer ${this.idToken}`;

        const response = await fetch(`${API_BASE_URL}/${name}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ data })
        });
        const body = await response.json();
        if (body.error) {
            const error = new Error(body.error.message || 'Request failed');
            error.status = body.error.status;
            throw error;
        }
        return body.result;
    }

    // Activate license key (server binds it to this account)
    async activateLicense(licenseKey) {
        try {
            const result = await this.callFunction('activateLicense', { key: licenseKey });
            if (!result.success) return result;
            return { success: true, message: 'License activated successfully!' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // A code that ties a purchase on the checkout page to this account, so
    // the payment activates Premium here by itself
    async startCheckout() {
        const result = await this.callFunction('startCheckout', {});
        return result.code;
    }

    // Find and activate a paid license for this account's verified email
    async claimLicenseByEmail() {
        try {
            // Refresh first so a just-verified email shows up in the token
            await this.refreshIdToken();
            return await this.callFunction('claimLicenseByEmail', {});
        } catch (error) {
            if (error.message === 'EMAIL_NOT_VERIFIED') {
                return { success: false, emailNotVerified: true };
            }
            return { success: false, error: error.message };
        }
    }

    // Send a verification email for the signed-in account
    async sendEmailVerification() {
        try {
            const response = await fetch(`${AUTH_BASE_URL}/accounts:sendOobCode?key=${FIREBASE_CONFIG.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: this.idToken })
            });
            const data = await response.json();
            if (data.error) {
                return { success: false, error: this.parseAuthError(data.error.message) };
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Parse Firebase Auth errors
    parseAuthError(errorCode) {
        const errors = {
            'EMAIL_EXISTS': 'Email already registered',
            'INVALID_EMAIL': 'Invalid email address',
            'WEAK_PASSWORD': 'Password should be at least 6 characters',
            'EMAIL_NOT_FOUND': 'Email not found',
            'INVALID_PASSWORD': 'Incorrect password',
            'INVALID_LOGIN_CREDENTIALS': 'Invalid email or password',
            'TOO_MANY_ATTEMPTS_TRY_LATER': 'Too many attempts. Try again later',
            'USER_DISABLED': 'This account has been disabled'
        };
        return errors[errorCode] || errorCode;
    }
}
