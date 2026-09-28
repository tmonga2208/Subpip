// SubPIP popup: account, license activation, settings and the Activate button

import { LicenseManager } from './license-manager.js';
import { withDefaults, ALL_SITES } from '../shared/settings.js';

let licenseManager = null;
let currentUser = null;
let isPremium = false;

// DOM Elements
const elements = {};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    setupEventListeners();
    await initAuth();
    loadSettings();
});

function initElements() {
    // Auth elements
    elements.authSection = document.getElementById('auth-section');
    elements.authLoggedOut = document.getElementById('auth-logged-out');
    elements.authLoggedIn = document.getElementById('auth-logged-in');
    elements.authLoading = document.getElementById('auth-loading');
    elements.authError = document.getElementById('auth-error');
    elements.authTabs = document.querySelectorAll('.auth-tab');
    elements.loginTab = document.getElementById('login-tab');
    elements.signupTab = document.getElementById('signup-tab');
    elements.loginEmail = document.getElementById('login-email');
    elements.loginPassword = document.getElementById('login-password');
    elements.loginBtn = document.getElementById('login-btn');
    elements.signupEmail = document.getElementById('signup-email');
    elements.signupPassword = document.getElementById('signup-password');
    elements.signupBtn = document.getElementById('signup-btn');
    elements.userEmail = document.getElementById('user-email');
    elements.premiumBadge = document.getElementById('premium-badge');
    elements.freeBadge = document.getElementById('free-badge');
    elements.licenseSection = document.getElementById('license-section');
    elements.licenseKey = document.getElementById('license-key');
    elements.activateLicenseBtn = document.getElementById('activate-license-btn');
    elements.licenseKeyStandalone = document.getElementById('license-key-standalone');
    elements.activateKeyBtn = document.getElementById('activate-key-btn');
    elements.getPremiumBtn = document.getElementById('get-premium-btn');
    elements.logoutBtn = document.getElementById('logout-btn');

    // Settings elements
    elements.activatePipBtn = document.getElementById('activate-pip-btn');
    elements.fontSize = document.getElementById('font-size');
    elements.fontSizeVal = document.getElementById('font-size-val');
    elements.textColor = document.getElementById('text-color');
    elements.bgColor = document.getElementById('bg-color');
    elements.bgOpacity = document.getElementById('bg-opacity');
    elements.bgOpacityVal = document.getElementById('bg-opacity-val');
    elements.fontFamily = document.getElementById('font-family');
    elements.captionPosition = document.getElementById('caption-position');
    elements.speedBtns = document.querySelectorAll('.speed-btn');
    elements.translationToggle = document.getElementById('translation-toggle');
    elements.targetLanguage = document.getElementById('target-language');
    elements.externalSubtitleUrl = document.getElementById('external-subtitle-url');
    elements.autoPipToggle = document.getElementById('auto-pip-toggle');
    elements.premiumFeaturesSection = document.getElementById('premium-features-section');
    elements.premiumOverlay = document.getElementById('premium-overlay');
    elements.saveBtn = document.getElementById('save-btn');
    elements.statusMsg = document.getElementById('status-msg');

    // Payment verification elements
    elements.verifyPaymentSection = document.getElementById('verify-payment-section');
    elements.checkPaymentBtn = document.getElementById('check-payment-btn');
}

async function initAuth() {
    showAuthLoading(true);

    try {
        licenseManager = new LicenseManager();
        await licenseManager.init();

        // Check if already logged in (from stored session)
        if (licenseManager.isLoggedIn()) {
            currentUser = licenseManager.getCurrentUser();
            await handleUserLoggedIn(currentUser);
        } else {
            handleUserLoggedOut();
        }

        showAuthLoading(false);
    } catch (error) {
        console.error('Firebase init error:', error);
        showAuthLoading(false);
        showAuthError('Failed to initialize. Check your connection.');
    }
}

async function handleUserLoggedIn(user) {
    elements.authLoggedOut.classList.add('hidden');
    elements.authLoggedIn.classList.remove('hidden');
    elements.userEmail.textContent = user.email;

    // Check premium status
    const status = await licenseManager.getUserStatus(user.uid);
    if (status.success) {
        isPremium = status.data.isPremium || false;
        updatePremiumUI(isPremium);

        // Validate session (device check)
        if (isPremium) {
            const validation = await licenseManager.validateSession(user.uid);
            if (!validation.valid) {
                showAuthError(validation.error);
                isPremium = false;
                updatePremiumUI(false);
            }
        }
    }

    // Save to Chrome storage
    await chrome.storage.sync.set({
        subpipAuth: {
            uid: user.uid,
            email: user.email,
            isPremium: isPremium
        }
    });
}

function handleUserLoggedOut() {
    elements.authLoggedOut.classList.remove('hidden');
    elements.authLoggedIn.classList.add('hidden');
    isPremium = false;
    updatePremiumUI(false);

    // Clear Chrome storage auth
    chrome.storage.sync.remove('subpipAuth');
}

function setupEventListeners() {
    // Auth tabs
    elements.authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            elements.authTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (tab.dataset.tab === 'login') {
                elements.loginTab.classList.remove('hidden');
                elements.signupTab.classList.add('hidden');
            } else {
                elements.loginTab.classList.add('hidden');
                elements.signupTab.classList.remove('hidden');
            }
        });
    });

    // Login
    elements.loginBtn.addEventListener('click', handleLogin);
    elements.loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Signup
    elements.signupBtn.addEventListener('click', handleSignup);
    elements.signupPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSignup();
    });

    // Logout
    elements.logoutBtn.addEventListener('click', handleLogout);

    // License activation (logged in)
    elements.activateLicenseBtn.addEventListener('click', () => {
        activateLicense(elements.licenseKey.value);
    });

    // License activation (standalone - not logged in)
    elements.activateKeyBtn.addEventListener('click', () => {
        showAuthError('Please login or create an account first to activate your license.');
    });

    // Get Premium - redirect to website
    elements.getPremiumBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://subpip.vercel.app/premium.html' });
    });

    // Activate PiP — inject directly from popup to preserve user activation
    // (going through background.js loses the user gesture needed by requestWindow)
    elements.activatePipBtn.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return;

            // Build settings from current form state (sync, no storage read)
            const settings = collectSettings();

            // Add auth info if available
            if (currentUser) {
                settings.uid = currentUser.uid;
            }

            // Inject settings + scripts directly (shorter chain = user activation preserved)
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: (s) => { window.__SUBPIP_SETTINGS__ = s; window.__SUBPIP_RUN__ = true; },
                args: [settings]
            });

            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                files: ["script.js"],
            });

            // After PiP is requested: save, then add the relay (translation and
            // live settings). It posts the saved settings when it starts.
            await chrome.storage.sync.set({ subpipSettings: settings });
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["translate-relay.js"],
            });
        } catch (e) {
            console.error('PiP activation error:', e);
        }

        window.close();
    });

    // Settings
    elements.fontSize.addEventListener('input', (e) => {
        elements.fontSizeVal.textContent = `${e.target.value}px`;
    });
    elements.bgOpacity.addEventListener('input', (e) => {
        elements.bgOpacityVal.textContent = `${e.target.value}%`;
    });

    elements.speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.speedBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    elements.translationToggle.addEventListener('change', (e) => {
        elements.targetLanguage.disabled = !e.target.checked;
    });

    elements.saveBtn.addEventListener('click', saveSettings);

    // Auto-PiP needs SubPIP on every site, so ask for that access only when
    // the user turns it on (must happen during this click)
    elements.autoPipToggle.addEventListener('change', async () => {
        if (elements.autoPipToggle.checked) {
            const granted = await chrome.permissions.request(ALL_SITES);
            if (!granted) {
                elements.autoPipToggle.checked = false;
                showStatus('Auto PiP needs access to all sites', 'error');
                return;
            }
        } else {
            await chrome.permissions.remove(ALL_SITES);
        }
        saveSettings();
    });

    // Payment verification - check by email
    if (elements.checkPaymentBtn) {
        elements.checkPaymentBtn.addEventListener('click', handleCheckPayment);
    }
}

async function handleLogin() {
    const email = elements.loginEmail.value.trim();
    const password = elements.loginPassword.value;

    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    showAuthLoading(true);
    hideAuthError();

    const result = await licenseManager.signIn(email, password);
    showAuthLoading(false);

    if (!result.success) {
        showAuthError(result.error);
    } else {
        currentUser = result.user;
        await handleUserLoggedIn(currentUser);
        showStatus('Logged in!', 'success');
    }
}

async function handleSignup() {
    const email = elements.signupEmail.value.trim();
    const password = elements.signupPassword.value;

    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        return;
    }

    showAuthLoading(true);
    hideAuthError();

    const result = await licenseManager.signUp(email, password);
    showAuthLoading(false);

    if (!result.success) {
        showAuthError(result.error);
    } else {
        currentUser = result.user;
        await handleUserLoggedIn(currentUser);
        showStatus('Account created!', 'success');
    }
}

async function handleLogout() {
    showAuthLoading(true);
    await licenseManager.signOut();
    currentUser = null;
    handleUserLoggedOut();
    showAuthLoading(false);
    showStatus('Logged out', 'success');
}

async function activateLicense(key) {
    if (!key || !key.trim()) {
        showAuthError('Please enter a license key');
        return;
    }

    if (!currentUser) {
        showAuthError('Please login first');
        return;
    }

    showAuthLoading(true);
    hideAuthError();

    const result = await licenseManager.activateLicense(key.trim());
    showAuthLoading(false);

    if (result.success) {
        isPremium = true;
        updatePremiumUI(true);
        showStatus(result.message || 'Premium activated!', 'success');
        elements.licenseKey.value = '';

        // Update Chrome storage
        await chrome.storage.sync.set({
            subpipAuth: {
                uid: currentUser.uid,
                email: currentUser.email,
                isPremium: true
            }
        });
    } else {
        showAuthError(result.error);
    }
}

// Handle payment check - server looks up a paid license for this account's verified email
async function handleCheckPayment() {
    if (!currentUser) {
        showAuthError('Please login first to check your payment');
        return;
    }

    showAuthLoading(true);
    hideAuthError();

    try {
        const result = await licenseManager.claimLicenseByEmail();

        if (result.success) {
            isPremium = true;
            updatePremiumUI(true);
            await chrome.storage.sync.set({
                subpipAuth: {
                    uid: currentUser.uid,
                    email: currentUser.email,
                    isPremium: true
                }
            });
            showStatus(`Premium activated! License: ${result.licenseKey}`, 'success');
        } else if (result.emailNotVerified) {
            const sent = await licenseManager.sendEmailVerification();
            showAuthError(sent.success
                ? `We sent a verification link to ${currentUser.email}. Click it, then press "Check Payment" again. Or paste your license key above.`
                : 'Please verify your email, or paste your license key above.');
        } else {
            showAuthError(result.error || 'No payment found for this email. Please complete payment first.');
        }
    } catch (error) {
        console.error('Payment check error:', error);
        showAuthError('Failed to check payment. Please try again.');
    }

    showAuthLoading(false);
}

function updatePremiumUI(premium) {
    if (premium) {
        elements.premiumBadge.classList.remove('hidden');
        elements.freeBadge.classList.add('hidden');
        elements.licenseSection.classList.add('hidden');
        elements.getPremiumBtn.classList.add('hidden');
        if (elements.verifyPaymentSection) {
            elements.verifyPaymentSection.classList.add('hidden');
        }
        elements.premiumFeaturesSection.classList.add('premium-unlocked');
    } else {
        elements.premiumBadge.classList.add('hidden');
        elements.freeBadge.classList.remove('hidden');
        elements.licenseSection.classList.remove('hidden');
        elements.getPremiumBtn.classList.remove('hidden');
        if (elements.verifyPaymentSection) {
            elements.verifyPaymentSection.classList.remove('hidden');
        }
        elements.premiumFeaturesSection.classList.remove('premium-unlocked');
    }
}

async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['subpipSettings']);
        const settings = withDefaults(result.subpipSettings);

        elements.fontSize.value = settings.fontSize;
        elements.fontSizeVal.textContent = `${settings.fontSize}px`;
        elements.textColor.value = settings.textColor;
        elements.bgColor.value = settings.bgColor;
        elements.bgOpacity.value = settings.bgOpacity;
        elements.bgOpacityVal.textContent = `${settings.bgOpacity}%`;
        elements.fontFamily.value = settings.fontFamily;
        elements.captionPosition.value = settings.captionPosition;
        elements.translationToggle.checked = settings.translationEnabled;
        elements.targetLanguage.value = settings.targetLanguage;
        elements.targetLanguage.disabled = !settings.translationEnabled;
        elements.externalSubtitleUrl.value = settings.externalSubtitleUrl;
        // Auto-PiP only counts as on while the all-sites permission is granted
        elements.autoPipToggle.checked = settings.autoPip && await chrome.permissions.contains(ALL_SITES);

        elements.speedBtns.forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === settings.playbackSpeed);
        });
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Read the settings form into a settings object
function collectSettings() {
    const activeSpeedBtn = document.querySelector('.speed-btn.active');

    return {
        isPremium: isPremium,
        fontSize: parseInt(elements.fontSize.value),
        textColor: elements.textColor.value,
        bgColor: elements.bgColor.value,
        bgOpacity: parseInt(elements.bgOpacity.value),
        fontFamily: elements.fontFamily.value,
        captionPosition: elements.captionPosition.value,
        playbackSpeed: activeSpeedBtn ? parseFloat(activeSpeedBtn.dataset.speed) : 1,
        translationEnabled: elements.translationToggle.checked,
        targetLanguage: elements.targetLanguage.value,
        externalSubtitleUrl: elements.externalSubtitleUrl.value.trim(),
        autoPip: elements.autoPipToggle.checked
    };
}

async function saveSettings() {
    const settings = collectSettings();

    try {
        // Open pages pick this up through translate-relay.js (storage.onChanged)
        await chrome.storage.sync.set({ subpipSettings: settings });

        showStatus('Settings saved!', 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('Error saving settings', 'error');
    }
}

function showAuthLoading(show) {
    elements.authLoading.classList.toggle('hidden', !show);
}

function showAuthError(message) {
    elements.authError.textContent = message;
    elements.authError.classList.remove('hidden');
}

function hideAuthError() {
    elements.authError.classList.add('hidden');
}

function showStatus(message, type) {
    elements.statusMsg.textContent = message;
    elements.statusMsg.className = `status-msg ${type}`;
    elements.statusMsg.classList.remove('hidden');

    setTimeout(() => {
        elements.statusMsg.classList.add('hidden');
    }, 3000);
}
