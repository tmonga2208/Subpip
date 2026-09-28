// Who is signed in and whether they have Premium. Wraps LicenseManager and
// mirrors the result to chrome.storage.sync (subpipAuth) for the background
// and page scripts.

import { LicenseManager } from './license-manager.js';

export function createAuth(manager = new LicenseManager()) {
  let user = null;
  let premium = false;
  let notice = '';
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  async function refreshStatus() {
    premium = false;
    notice = '';
    if (user) {
      const status = await manager.getUserStatus(user.uid);
      if (status.success && status.data.isPremium) {
        const session = await manager.validateSession(user.uid);
        premium = session.valid;
        if (!session.valid) notice = session.error;
      }
      await chrome.storage.sync.set({ subpipAuth: { uid: user.uid, email: user.email, isPremium: premium } });
    } else {
      await chrome.storage.sync.remove('subpipAuth');
    }
    emit();
  }

  async function start(method, email, password) {
    const result = await manager[method](email, password);
    if (!result.success) return result;
    user = result.user;
    await refreshStatus();
    return { success: true };
  }

  return {
    user: () => user,
    isPremium: () => premium,
    notice: () => notice,
    onChange(fn) {
      listeners.add(fn);
    },
    async init() {
      await manager.init();
      user = manager.isLoggedIn() ? manager.getCurrentUser() : null;
      await refreshStatus();
    },
    signIn: (email, password) => start('signIn', email, password),
    signUp: (email, password) => start('signUp', email, password),
    async signOut() {
      await manager.signOut();
      user = null;
      await refreshStatus();
    },
    async activateLicense(key) {
      const result = await manager.activateLicense(key);
      if (result.success) await refreshStatus();
      return result;
    },
    async checkPayment() {
      const result = await manager.claimLicenseByEmail();
      if (result.emailNotVerified) {
        const sent = await manager.sendEmailVerification();
        return {
          success: false,
          message: sent.success
            ? `We sent a verification link to ${user.email}. Click it, then check again.`
            : 'Please verify your email, or paste your license key.'
        };
      }
      if (result.success) {
        await refreshStatus();
        return { success: true, message: `Premium activated. License: ${result.licenseKey}` };
      }
      return { success: false, message: result.error || 'No payment found for this email yet.' };
    }
  };
}
