// Account & license page, plus the header's plan badge and account button

import { PREMIUM_URL } from '../shared/firebase.js';

export const NETWORK_ERROR = "Can't reach SubPIP. Check your connection and try again.";

function friendly(message) {
  if (/failed to fetch|network/i.test(message || '')) return NETWORK_ERROR;
  return message || 'Something went wrong. Please try again.';
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('busy', busy);
  button.setAttribute('aria-busy', String(busy));
}

function say(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 8 October 2027, as the license email says it
const endDay = (ms) => { const date = new Date(ms); return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`; };

export function initAccount({ doc, auth }) {
  const $ = (id) => doc.getElementById(id);
  const modeTabs = [...doc.querySelectorAll('[data-mode]')];
  let mode = 'signin';

  function renderMode() {
    modeTabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)));
    $('auth-submit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    $('auth-password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    say($('auth-error'), '');
  }
  modeTabs.forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    renderMode();
  }));

  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) return say($('auth-error'), 'Enter your email and password.');
    if (mode === 'signup' && password.length < 6) return say($('auth-error'), 'Password must be at least 6 characters.');
    say($('auth-error'), '');
    setBusy($('auth-submit'), true);
    const result = mode === 'signin' ? await auth.signIn(email, password) : await auth.signUp(email, password);
    setBusy($('auth-submit'), false);
    if (result.success) $('auth-password').value = '';
    else say($('auth-error'), friendly(result.error));
  });

  $('license-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('license-key').value.trim();
    say($('license-success'), '');
    if (!key) return say($('license-error'), 'Enter your license key.');
    say($('license-error'), '');
    setBusy($('license-submit'), true);
    const result = await auth.activateLicense(key);
    setBusy($('license-submit'), false);
    if (result.success) {
      $('license-key').value = '';
      say($('license-success'), 'Premium activated.');
    } else {
      say($('license-error'), friendly(result.error));
    }
  });

  async function checkPayment() {
    say($('license-error'), '');
    say($('license-success'), '');
    setBusy($('check-payment'), true);
    const result = await auth.checkPayment();
    setBusy($('check-payment'), false);
    if (result.success) say($('license-success'), result.message);
    else say($('license-error'), friendly(result.message));
  }
  $('check-payment').addEventListener('click', checkPayment);

  $('sign-out').addEventListener('click', async () => {
    setBusy($('sign-out'), true);
    await auth.signOut();
    setBusy($('sign-out'), false);
  });

  doc.querySelectorAll('[data-action="get-premium"]').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true);
      const url = await auth.checkoutUrl(PREMIUM_URL);
      setBusy(button, false);
      chrome.tabs.create({ url });
    });
  });

  function render() {
    const user = auth.user();
    const premium = auth.isPremium();
    $('signed-out').hidden = !!user;
    $('signed-in').hidden = !user;
    for (const badge of [$('plan-badge'), $('account-plan')]) {
      badge.textContent = premium ? 'Premium' : 'Free';
      badge.classList.toggle('premium', premium);
    }
    $('account-email').textContent = user ? user.email : '';
    $('account-email').title = user ? user.email : '';
    $('free-actions').hidden = premium;
    const until = auth.premiumUntil();
    $('premium-until').hidden = !until;
    $('premium-until').textContent = until ? `Premium until ${endDay(until)}. It ends then by itself: nothing is charged again.` : '';
    $('account-initial').textContent = user ? user.email.charAt(0).toUpperCase() : '';
    $('account-initial').hidden = !user;
    $('account-icon').hidden = !!user;
  }

  auth.onChange(render);
  renderMode();
  render();
  return { checkPayment };
}
