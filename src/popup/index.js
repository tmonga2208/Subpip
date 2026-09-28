// SubPIP popup: wires the pages together

import { iconMarkup } from '../shared/icons.js';
import { createRouter } from './router.js';
import { createAuth } from './auth.js';
import { initAccount } from './account.js';

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
  const auth = createAuth();
  initAccount({ doc: document, auth });
  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));

  await auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error));
  document.body.dataset.ready = 'true';
});
