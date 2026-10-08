// Anonymous usage counts: what SubPIP tells its server about being used, to
// find where it fails. A fact says that something happened, never to whom:
// no account, no device, no page address. The site is one of a handful of
// well-known names or "other". On unless switched off in the popup.
import { API_BASE_URL } from './firebase.js';

// Whether someone who updated from a version without counts has been told:
// 'pending' until the popup's note has been answered
export const USAGE_NOTICE = 'subpipUsageNotice';

const KNOWN_SITES = [
  ['youtube', /(^|\.)youtube\.com$/],
  ['netflix', /(^|\.)netflix\.com$/],
  ['hotstar', /(^|\.)(jio)?hotstar\.com$/],
  ['primevideo', /(^|\.)primevideo\.com$/],
  ['disneyplus', /(^|\.)disneyplus\.com$/],
  ['crunchyroll', /(^|\.)crunchyroll\.com$/]
];

export function siteCategory(hostname) {
  const known = KNOWN_SITES.find(([, pattern]) => pattern.test(hostname || ''));
  return known ? known[0] : 'other';
}

export function browserMajor(userAgent) {
  const found = /Chrome\/(\d+)/.exec(userAgent || '');
  return found ? Number(found[1]) : 0;
}

export const mayCount = (settings, notice) => (settings || {}).shareUsage !== false && notice !== 'pending';

// The fact to send, rebuilt from the few answers it may hold: whatever else
// came with the request is left behind. The site is read from the tab by the
// extension, not taken from the page's word.
export function countedFact(asked, { tab, plan, version, browser }) {
  const tail = { version, browser };
  if (asked.event === 'opened') {
    let host = '';
    try {
      host = new URL(tab.url).hostname;
    } catch (e) {
      // A tab without an address SubPIP may see
    }
    return { event: 'opened', site: siteCategory(host), captions: asked.captions === 'found' ? 'found' : 'none', plan: plan === 'premium' ? 'premium' : 'free', ...tail };
  }
  if (asked.event === 'premium_tap') return { event: 'premium_tap', feature: String(asked.feature), where: asked.where === 'popup' ? 'popup' : 'window', ...tail };
  if (asked.event === 'upgrade_click') return { event: 'upgrade_click', where: asked.where === 'popup' ? 'popup' : 'window', ...tail };
  return null;
}

// Background only. Never throws and never waits on the answer.
export async function sendCount(asked, tab, plan) {
  try {
    const [{ subpipSettings }, { [USAGE_NOTICE]: notice }] = await Promise.all([chrome.storage.sync.get(['subpipSettings']), chrome.storage.local.get([USAGE_NOTICE])]);
    if (!mayCount(subpipSettings, notice)) return;
    const fact = countedFact(asked, { tab, plan, version: chrome.runtime.getManifest().version, browser: browserMajor(navigator.userAgent) });
    if (!fact) return;
    await fetch(`${API_BASE_URL}/count`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: fact }) });
  } catch (e) {
    // A count that does not arrive is no loss
  }
}
