// Home: the page status card and the Open / Close Picture-in-Picture button

import { getTargetTab, detectPage, describeStatus } from './status.js';
import { togglePipInTab, injectRelay } from '../shared/inject.js';
import { autoPipActive } from '../shared/settings.js';

export function initHome({ doc, store, auth }) {
  const $ = (id) => doc.getElementById(id);
  const button = $('pip-btn');
  const BUTTON_TEXT = { pip: 'Close Picture-in-Picture', embedded: 'Open the player in a new tab' };
  let tab = null;
  let current = { state: 'loading' };

  function render(status) {
    current = status;
    $('status').dataset.state = status.state;
    const { title, sub } = describeStatus(status);
    $('status-title').textContent = title;
    $('status-sub').textContent = sub;
    button.disabled = !['video', 'pip', 'embedded'].includes(status.state);
    button.textContent = BUTTON_TEXT[status.state] || 'Open Picture-in-Picture';
  }

  // Inject straight from the popup: the shorter the chain, the better the
  // page's user activation survives for requestWindow. A second run closes.
  button.addEventListener('click', async () => {
    if (!tab) return;
    // The video sits in a frame from another site: its own page is where SubPIP can run
    if (current.state === 'embedded') {
      await chrome.tabs.create({ url: current.embedUrl });
      window.close();
      return;
    }
    // Auto PiP as the page should see it: only where it is in force on this browser
    const autoPip = store.get().autoPip === true && await autoPipActive();
    const settings = { ...store.get(), autoPip, isPremium: auth.isPremium(), uid: auth.user()?.uid };
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
