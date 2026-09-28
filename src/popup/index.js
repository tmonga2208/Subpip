// SubPIP popup: wires the pages together

import { iconMarkup } from '../shared/icons.js';
import { createRouter } from './router.js';
import { createAuth } from './auth.js';
import { initAccount } from './account.js';
import { createSettingsStore } from './settings-store.js';
import { initCaptions } from './captions.js';
import { initHome } from './home.js';

// Extension page, so icon markup strings are fine here (unlike page scripts)
function renderIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.classList.add('icon');
    el.innerHTML = iconMarkup(el.dataset.icon);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  const router = createRouter(document);
  const store = createSettingsStore();
  const auth = createAuth();
  initAccount({ doc: document, auth });
  initCaptions({ doc: document, store, router, auth });
  const home = initHome({ doc: document, store, auth });
  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));
  // Save anything still waiting on the slider debounce when the popup closes
  window.addEventListener('pagehide', () => { store.flush(); });

  await Promise.all([
    home.refresh(),
    store.load(),
    auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error))
  ]);
  document.body.dataset.ready = 'true';
});
