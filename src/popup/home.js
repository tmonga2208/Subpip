// Home: the page status card and the Open / Close Picture-in-Picture button

import { getTargetTab, detectPage, describeStatus } from './status.js';
import { togglePipInTab, injectRelay } from '../shared/inject.js';
import { autoPipInForce, captionSelectorFor, saveCaptionSelector } from '../shared/settings.js';
import { REPORT_URL } from '../shared/firebase.js';

export function initHome({ doc, store, auth }) {
  const $ = (id) => doc.getElementById(id);
  const button = $('pip-btn');
  const pick = $('pick-captions');
  const report = $('report-problem');
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
    pick.hidden = !['video', 'pip'].includes(status.state);
    pick.textContent = status.picked ? 'Forget the captions picked on this site' : 'Captions not showing? Pick them on the page';
    report.hidden = status.state === 'loading';
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
    // Auto PiP as the page should see it: only where it is in force on this
    // browser, and without the list of the other sites it is on
    const { autoPipSites, ...saved } = store.get(); // eslint-disable-line no-unused-vars
    const autoPip = await autoPipInForce(store.get(), current.host);
    const captionSelector = await captionSelectorFor(current.host);
    const settings = { ...saved, autoPip, captionSelector, isPremium: auth.isPremium(), uid: auth.user()?.uid };
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

  // On a site SubPIP does not know, the viewer points at the captions once:
  // the page takes over from here, so the popup gets out of the way
  pick.addEventListener('click', async () => {
    if (!tab) return;
    if (current.picked) {
      await saveCaptionSelector(current.host, '');
      render(await detectPage(tab));
      return;
    }
    try {
      await injectRelay(tab.id);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['script.js'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => window.__SUBPIP__.pickCaptions() });
    } catch (error) {
      console.warn('[SubPIP] Could not start picking captions:', error);
    }
    window.close();
  });

  // The report form is on the website. The site's name and the version go
  // along after the "#", which no server sees: the form shows the name, lets
  // it be changed or cleared, and sends nothing until Send is pressed. Only
  // the name ever travels, never the page's address or title.
  report.addEventListener('click', async () => {
    const given = new URLSearchParams();
    if (current.host) given.set('site', current.host);
    given.set('v', chrome.runtime.getManifest().version);
    await chrome.tabs.create({ url: `${REPORT_URL}#${given}` });
  });

  render({ state: 'loading' });
  return {
    async refresh() {
      tab = await getTargetTab();
      render(await detectPage(tab));
    }
  };
}
