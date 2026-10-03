// Home: the page status card and the Open / Close Picture-in-Picture button

import { getTargetTab, detectPage, describeStatus } from './status.js';
import { togglePipInTab, injectRelay } from '../shared/inject.js';

export function initHome({ doc, store, auth }) {
  const $ = (id) => doc.getElementById(id);
  const button = $('pip-btn');
  let tab = null;

  function render(status) {
    $('status').dataset.state = status.state;
    const { title, sub } = describeStatus(status);
    $('status-title').textContent = title;
    $('status-sub').textContent = sub;
    button.disabled = !(status.state === 'video' || status.state === 'pip');
    button.textContent = status.state === 'pip' ? 'Close Picture-in-Picture' : 'Open Picture-in-Picture';
  }

  // Inject straight from the popup: the shorter the chain, the better the
  // page's user activation survives for requestWindow. A second run closes.
  button.addEventListener('click', async () => {
    if (!tab) return;
    const settings = { ...store.get(), isPremium: auth.isPremium(), uid: auth.user()?.uid };
    try {
      await togglePipInTab(tab.id, settings);
      // Then save and add the relay (translation + live settings)
      await store.flush();
      await injectRelay(tab.id);
    } catch (error) {
      console.warn('[SubPIP] Could not start Picture-in-Picture:', error);
    }
    window.close();
  });

  render({ state: 'loading' });
  return {
    async refresh() {
      tab = await getTargetTab();
      render(await detectPage(tab));
    }
  };
}
