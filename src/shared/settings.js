// Settings shared by the popup, background, relay and PiP script

export const CAPTION_PRESETS = {
  classic: { fontSize: 18, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false },
  large: { fontSize: 26, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false },
  outline: { fontSize: 20, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0, captionOutline: true }
};

export const DEFAULT_SETTINGS = {
  isPremium: false,
  ...CAPTION_PRESETS.classic,
  captionPreset: 'classic',
  fontFamily: 'sans-serif',
  captionPosition: 'bottom',
  playbackSpeed: 1,
  translationEnabled: false,
  targetLanguage: 'en',
  // Show the original line above its translation
  dualSubtitles: false,
  externalSubtitleUrl: '',
  // Needs the optional all-sites permission, so it is opt-in
  autoPip: false
};

// Caption size choices in the PiP settings menu
export const CAPTION_SIZES = [
  { label: 'S', px: 14 },
  { label: 'M', px: 18 },
  { label: 'L', px: 24 },
  { label: 'XL', px: 32 }
];

// Playback speeds offered in the popup and the PiP menu
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' }
];

// Which preset the caption values match, or 'custom'
export function detectCaptionPreset(settings) {
  for (const [name, preset] of Object.entries(CAPTION_PRESETS)) {
    if (Object.entries(preset).every(([key, value]) => settings[key] === value)) return name;
  }
  return 'custom';
}

export function applyCaptionPreset(settings, name) {
  return { ...settings, ...CAPTION_PRESETS[name], captionPreset: name };
}

export function withDefaults(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // Settings saved before presets existed: keep their look, label it
  if (!settings || settings.captionPreset === undefined) {
    merged.captionPreset = detectCaptionPreset(merged);
  }
  return merged;
}

// Who is signed in on this browser and whether they are Premium, as last
// confirmed by the popup. It lives in local storage, next to the sign-in
// tokens it comes from: sync storage is shared by every browser on the Chrome
// profile, so a signed-out one would wipe it for the others.
export async function readAuthCache() {
  const { subpipAuth, firebaseAuth } = await chrome.storage.local.get(['subpipAuth', 'firebaseAuth']);
  if (subpipAuth) return subpipAuth;
  // Versions up to 4.1 kept it in sync storage: trust that copy only for the
  // account that is signed in here
  const { subpipAuth: synced } = await chrome.storage.sync.get(['subpipAuth']);
  return synced && firebaseAuth?.user?.uid === synced.uid ? synced : null;
}

// Whether Auto PiP is in force on this browser: the user has switched it on
// AND this browser has granted access to all sites. The switch is saved with
// the other settings in sync storage, shared by every browser on the profile,
// while the permission is granted per browser - so the background works this
// out (syncAutoPip in background.js) and pages are told this, never the saved
// switch alone.
export const AUTO_PIP_ACTIVE = 'subpipAutoPipActive';

export async function autoPipActive() {
  return (await chrome.storage.local.get([AUTO_PIP_ACTIVE]))[AUTO_PIP_ACTIVE] === true;
}

// Stored settings as a page should see them: plus the auth-derived fields
// (premium status, uid), and with Auto PiP only where it is in force
export async function readStoredSettings() {
  const [{ subpipSettings }, subpipAuth, active] = await Promise.all([chrome.storage.sync.get(['subpipSettings']), readAuthCache(), autoPipActive()]);
  const settings = withDefaults(subpipSettings);
  settings.autoPip = settings.autoPip === true && active;
  // Premium comes from sign-in only (old versions also saved a copy in settings)
  settings.isPremium = !!subpipAuth?.isPremium;
  if (subpipAuth?.uid) settings.uid = subpipAuth.uid;
  return settings;
}

// Host access needed for auto-PiP content scripts on every site
export const ALL_SITES = { origins: ['<all_urls>'] };
