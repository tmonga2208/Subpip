// Buttons a site shows over its player for a moment - Skip intro, Skip recap,
// Next episode - cannot be reached while the video is in the PiP window.
// SubPIP finds them on the page and offers them in the window; pressing one
// there presses the site's own. Ads are left alone: a relayed press on
// "Skip ad" is not accepted (YouTube ignores it).

const KNOWN = [
  { id: 'skip-intro', label: 'Skip intro', words: /^skip (the )?(intro|opening)( credits)?$/i },
  { id: 'skip-recap', label: 'Skip recap', words: /^skip (the )?recap$/i },
  { id: 'skip-credits', label: 'Skip credits', words: /^skip (the )?(credits|ending|outro)$/i },
  { id: 'next-episode', label: 'Next episode', words: /^((play|watch) )?next episode$/i }
];

// What a button is, going by what it says: { id, label } or null
export function knownSiteAction(name) {
  const said = (name || '').replace(/\s+/g, ' ').trim();
  return KNOWN.find((action) => action.words.test(said)) || null;
}

const isShown = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';

// The site buttons on screen right now: [{ id, label, press() }]. By what
// they say first, then by the names a site adapter knows them under (those
// also work where the site is not in English).
export function findSiteActions(adapter, doc = document) {
  const found = [];
  const taken = new Set();
  const add = (id, label, element) => {
    if (taken.has(element) || found.some((action) => action.id === id) || !isShown(element)) return;
    taken.add(element);
    found.push({ id, label, press: () => element.click() });
  };
  for (const element of doc.querySelectorAll('button, [role="button"]')) {
    const known = knownSiteAction(element.getAttribute('aria-label') || element.textContent);
    if (known) add(known.id, known.label, element);
  }
  for (const { id, label, selector } of adapter.actions || []) {
    const element = doc.querySelector(selector);
    if (element) add(id, label, element);
  }
  return found;
}
