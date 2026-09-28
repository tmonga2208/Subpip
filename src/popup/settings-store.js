// The popup's settings: one in-memory copy that saves to chrome.storage.sync
// as it changes. Open pages pick changes up through the relay.

import { withDefaults } from '../shared/settings.js';

export const SAVE_DELAY_MS = 300;

export function createSettingsStore(storage = chrome.storage.sync) {
  let settings = withDefaults();
  let timer = null;
  const listeners = new Set();

  // Premium status and uid come from sign-in (subpipAuth), never from here
  function write() {
    clearTimeout(timer);
    timer = null;
    const { isPremium, uid, ...toSave } = settings; // eslint-disable-line no-unused-vars
    return storage.set({ subpipSettings: toSave });
  }

  return {
    async load() {
      const { subpipSettings } = await storage.get(['subpipSettings']);
      settings = withDefaults(subpipSettings);
      listeners.forEach((fn) => fn(settings));
      return settings;
    },
    get: () => settings,
    update(patch, { debounce = false } = {}) {
      settings = { ...settings, ...patch };
      listeners.forEach((fn) => fn(settings));
      clearTimeout(timer);
      if (debounce) {
        timer = setTimeout(write, SAVE_DELAY_MS);
        return Promise.resolve();
      }
      return write();
    },
    flush() {
      return timer ? write() : Promise.resolve();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
