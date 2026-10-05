// SubPIP popup: wires the pages together

import { iconMarkup } from '../shared/icons.js';
import { createRouter } from './router.js';
import { createAuth } from './auth.js';
import { initAccount } from './account.js';
import { createSettingsStore } from './settings-store.js';
import { initCaptions } from './captions.js';
import { initHome } from './home.js';
import { initOptions } from './options.js';
import { initSaved } from './saved.js';
import { initRatingAsk } from './rating.js';
import { localPrice } from '../shared/pricing.js';

// Extension page, so icon markup strings are fine here (unlike page scripts)
function renderIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.classList.add('icon');
    el.innerHTML = iconMarkup(el.dataset.icon);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  // ₹999 in India, $15 elsewhere
  document.querySelectorAll('[data-price]').forEach((el) => { el.textContent = localPrice().label; });
  const router = createRouter(document);
  const store = createSettingsStore();
  const auth = createAuth();
  const account = initAccount({ doc: document, auth });
  initCaptions({ doc: document, store, router, auth });
  const home = initHome({ doc: document, store, auth });
  initOptions({ doc: document, store, auth, router });
  const saved = initSaved({ doc: document, auth });

  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));
  document.getElementById('upgrade-check-payment').addEventListener('click', () => {
    router.go('account');
    if (auth.user()) account.checkPayment();
  });
  // Save anything still waiting on the slider debounce when the popup closes
  window.addEventListener('pagehide', () => { store.flush(); });

  await Promise.all([
    home.refresh(),
    store.load(),
    saved.load(),
    initRatingAsk({ doc: document }).catch((error) => console.warn('[SubPIP] Could not prepare the rating ask:', error)),
    auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error))
  ]);
  document.body.dataset.ready = 'true';
});
