// Settings shared by the popup, background, relay and PiP script

export const DEFAULT_SETTINGS = {
  isPremium: false,
  fontSize: 18,
  textColor: '#ffffff',
  bgColor: '#000000',
  bgOpacity: 75,
  fontFamily: 'sans-serif',
  captionPosition: 'bottom',
  playbackSpeed: 1,
  translationEnabled: false,
  targetLanguage: 'en',
  externalSubtitleUrl: '',
  // Needs the optional all-sites permission, so it is opt-in
  autoPip: false
};

export function withDefaults(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// Stored settings plus the auth-derived fields (premium status, uid)
export async function readStoredSettings() {
  const { subpipSettings, subpipAuth } = await chrome.storage.sync.get(['subpipSettings', 'subpipAuth']);
  const settings = withDefaults(subpipSettings);
  settings.isPremium = !!(subpipSettings?.isPremium || subpipAuth?.isPremium);
  if (subpipAuth?.uid) settings.uid = subpipAuth.uid;
  return settings;
}

// Host access needed for auto-PiP content scripts on every site
export const ALL_SITES = { origins: ['<all_urls>'] };
