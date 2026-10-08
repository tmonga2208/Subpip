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
  // Auto PiP on every site: needs the optional all-sites permission, so it is opt-in
  autoPip: false,
  // Auto PiP on single sites instead: each needs access to that site only
  autoPipSites: [],
  // Anonymous usage counts (shared/usage.js): on unless switched off
  shareUsage: true
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

// The same languages as speech recognition knows them (captions written from
// the video's sound). Which of them Chrome can do on a device, it says itself.
export const SPEECH_TAGS = {
  en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR',
  zh: 'cmn-Hans-CN', ja: 'ja-JP', ko: 'ko-KR', hi: 'hi-IN', ar: 'ar-SA', ru: 'ru-RU'
};

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

// "My style": the viewer's own look, kept as settings.myStyle apart from the
// built-in ones, so that trying Classic, Large or Outline does not lose it
const MY_STYLE_KEYS = ['fontSize', 'fontFamily', 'textColor', 'bgColor', 'bgOpacity', 'captionOutline'];
const lookOf = (settings) => Object.fromEntries(MY_STYLE_KEYS.map((key) => [key, settings[key]]));

// A change to the look makes it My style, and is kept as such
export function editMyStyle(settings, patch) {
  const edited = { ...settings, ...patch, captionPreset: 'custom' };
  return { ...edited, myStyle: lookOf(edited) };
}

export function applyMyStyle(settings) {
  return { ...settings, ...settings.myStyle, captionPreset: 'custom' };
}

export function withDefaults(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // Settings saved before presets existed: keep their look, label it
  if (!settings || settings.captionPreset === undefined) {
    merged.captionPreset = detectCaptionPreset(merged);
  }
  // A custom look saved before My style existed is My style
  if (merged.captionPreset === 'custom' && !merged.myStyle) merged.myStyle = lookOf(merged);
  return merged;
}

// Premium as of now: bought for a year, it is over when the year is, whether
// or not anything has been heard from the server since
export const premiumNow = (account, now = Date.now()) => !!account?.isPremium && !(typeof account.premiumUntil === 'number' && account.premiumUntil <= now);

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

// A site, as settings are kept per site: its host name without "www."
export const siteKey = (hostname) => (hostname || '').replace(/^www\./, '');

// Whether Auto PiP is in force on this browser: the user has switched it on
// AND this browser has granted the access it needs - to all sites, or to the
// single sites the user chose. The switches are saved with the other settings
// in sync storage, shared by every browser on the profile, while access is
// granted per browser - so the background works this out (syncAutoPip in
// background.js) and pages are told this, never the saved switches alone.
export const AUTO_PIP_ACTIVE = 'subpipAutoPipActive';
// The single sites it is in force on: ['example.com', ...]
export const AUTO_PIP_SITES_ACTIVE = 'subpipAutoPipSitesActive';

export const isSiteName = (site) => typeof site === 'string' && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(site);

// What Chrome is asked for access to: a site and everything under it. A bare
// name or a numeric address has nothing under it.
export function sitePattern(site) {
  return /^[\d.]+$/.test(site) || !site.includes('.') ? `*://${site}/*` : `*://*.${site}/*`;
}

const isOnSite = (hostname, site) => siteKey(hostname) === site || siteKey(hostname).endsWith(`.${site}`);

// For a page of this host: on every site, or on a site the user chose
export async function autoPipInForce(settings, hostname) {
  const { [AUTO_PIP_ACTIVE]: everywhere, [AUTO_PIP_SITES_ACTIVE]: sites } = await chrome.storage.local.get([AUTO_PIP_ACTIVE, AUTO_PIP_SITES_ACTIVE]);
  if (settings.autoPip === true && everywhere === true) return true;
  if (hostname === undefined) return false;
  return (settings.autoPipSites || []).some((site) => isOnSite(hostname, site) && (sites || []).includes(site));
}

// Captions a viewer pointed at on a site SubPIP did not know (see
// content/caption-picker.js), per site: { 'example.com': 'div.captions' }.
// Synced, so a site fixed once is fixed in every browser on the profile.
export const CAPTION_SELECTORS = 'subpipCaptionSelectors';
const MAX_SELECTOR_LENGTH = 300;

export async function captionSelectorFor(hostname) {
  const { [CAPTION_SELECTORS]: selectors } = await chrome.storage.sync.get([CAPTION_SELECTORS]);
  return (selectors && selectors[siteKey(hostname)]) || '';
}

// An empty selector forgets the site
export async function saveCaptionSelector(hostname, selector) {
  if (typeof selector !== 'string' || selector.length > MAX_SELECTOR_LENGTH) return;
  const { [CAPTION_SELECTORS]: saved } = await chrome.storage.sync.get([CAPTION_SELECTORS]);
  const selectors = { ...(saved || {}) };
  if (selector) selectors[siteKey(hostname)] = selector;
  else delete selectors[siteKey(hostname)];
  await chrome.storage.sync.set({ [CAPTION_SELECTORS]: selectors });
}

// Stored settings as a page should see them: plus the auth-derived fields
// (premium status, uid), with Auto PiP only where it is in force, and - for
// the page of a known site - the caption element picked for that site
export async function readStoredSettings(hostname) {
  const [{ subpipSettings }, subpipAuth] = await Promise.all([chrome.storage.sync.get(['subpipSettings']), readAuthCache()]);
  const settings = withDefaults(subpipSettings);
  settings.autoPip = await autoPipInForce(settings, hostname);
  // A page learns about itself only, not which other sites the user chose
  delete settings.autoPipSites;
  if (hostname !== undefined) settings.captionSelector = await captionSelectorFor(hostname);
  // Premium comes from sign-in only (old versions also saved a copy in settings)
  settings.isPremium = premiumNow(subpipAuth);
  if (subpipAuth?.uid) settings.uid = subpipAuth.uid;
  return settings;
}

// Host access needed for auto-PiP content scripts on every site
export const ALL_SITES = { origins: ['<all_urls>'] };
