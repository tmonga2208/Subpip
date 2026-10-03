// SubPIP page script (MAIN world) - Picture-in-Picture with subtitles.
//
// One instance per page. It is injected when the user clicks Activate, and -
// when auto-PiP is enabled - also registered as a content script so Chrome's
// automatic PiP handler exists before the user switches tabs. A repeat load
// just toggles the existing instance.

import { withDefaults } from '../shared/settings.js';
import { getSiteAdapter } from './adapters.js';
import { findVideo } from './video.js';
import { openPipWindow } from './pip-window.js';

function isRestrictedPage() {
  const href = window.location.href || '';
  return href === 'about:blank' || href === 'about:srcdoc' || href.startsWith('chrome://') ||
    href.startsWith('chrome-extension://') || href.startsWith('edge://') ||
    (href.startsWith('file://') && !document.querySelector('video'));
}

function createInstance() {
  let currentSettings = withDefaults(window.__SUBPIP_SETTINGS__);
  let activeSession = null;
  let autoPipRegistered = false;
  // A subtitle file loaded in the PiP menu, kept for the next window on this page
  const subtitleMemory = { value: null };

  const getSettings = () => currentSettings;

  // Must be called while the page has user activation (a click, or Chrome's
  // automatic PiP handler) - everything before requestWindow is synchronous.
  async function openPip() {
    if (isRestrictedPage() || !window.documentPictureInPicture) return;
    if (documentPictureInPicture.window) return;

    // The Activate button injects fresh settings right before running
    currentSettings = withDefaults(window.__SUBPIP_SETTINGS__);

    const adapter = getSiteAdapter(window.location.hostname);
    const video = findVideo(adapter);
    if (!video) {
      console.warn('[SubPIP] No video found on this page');
      return;
    }

    try {
      const session = await openPipWindow({ video, adapter, getSettings, subtitleMemory, onClose: () => { activeSession = null; } });
      if (documentPictureInPicture.window) activeSession = session;
    } catch (error) {
      console.error('[SubPIP] PiP failed:', error?.name, error?.message);
      if (video.requestPictureInPicture) {
        try {
          video.removeAttribute('disablePictureInPicture');
          await video.requestPictureInPicture();
        } catch (innerError) {
          console.error('[SubPIP] Fallback PiP also failed:', innerError?.name, innerError?.message);
        }
      }
    }
  }

  function toggle() {
    if (window.documentPictureInPicture && documentPictureInPicture.window) {
      documentPictureInPicture.window.close();
      return;
    }
    return openPip();
  }

  // Auto-PiP on tab switch (Chrome 134+). Chrome calls this handler - with
  // permission to open a PiP window - when the user switches away from a tab
  // whose top-frame media is playing and audible, after a one-time prompt.
  function updateAutoPip() {
    if (!('mediaSession' in navigator) || window.top !== window) return;
    const enabled = currentSettings.autoPip === true;
    if (enabled === autoPipRegistered) return;
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', enabled ? () => { openPip(); } : null);
      autoPipRegistered = enabled;
    } catch (e) {
      // Browser doesn't support the enterpictureinpicture action
    }
  }

  // Settings arrive from translate-relay.js (the MAIN world has no chrome.*
  // APIs): on request at load, then whenever they change in storage.
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'SUBPIP_SETTINGS_UPDATED') return;
    currentSettings = withDefaults({ ...currentSettings, ...event.data.settings });
    window.__SUBPIP_SETTINGS__ = currentSettings;
    updateAutoPip();
    if (activeSession) activeSession.onSettingsChanged();
  });
  window.postMessage({ type: 'SUBPIP_SETTINGS_REQUEST' }, '*');
  updateAutoPip();

  return { toggle, open: openPip };
}

if (!window.__SUBPIP__) {
  window.__SUBPIP__ = createInstance();
}
if (window.__SUBPIP_RUN__) {
  // Injected by the Activate button: open (or close) now
  window.__SUBPIP_RUN__ = false;
  window.__SUBPIP__.toggle();
}
