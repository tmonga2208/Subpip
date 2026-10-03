// What the popup is about to act on: the target tab and whether it has a
// video, an open PiP window, a player embedded from another site, or can't be
// scripted at all.

import { getSiteAdapter } from '../content/adapters.js';

const RESTRICTED = [
  /^chrome:/, /^chrome-extension:/, /^edge:/, /^about:/, /^view-source:/, /^devtools:/,
  /^https:\/\/chromewebstore\.google\.com\//, /^https:\/\/chrome\.google\.com\/webstore/
];

export async function getTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // The toolbar popup acts on its own window's tab, even when its URL is
  // hidden (then it simply shows as "can't run")
  if (tab && !(tab.url || '').startsWith(chrome.runtime.getURL(''))) return tab;
  // Only when popup.html runs in its own window: use the most recent active
  // tab of a normal window. Document PiP windows also count as "normal" but
  // expose no URL, so skip URL-less tabs.
  const tabs = (await chrome.tabs.query({ active: true, windowType: 'normal' })).filter((t) => t.url);
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

// Runs in the page (must be self-contained)
function probePage() {
  const pipOpen = !!(window.documentPictureInPicture && window.documentPictureInPicture.window);
  const videos = [...document.querySelectorAll('video')];
  const hasTextTrack = videos.some((video) => [...video.textTracks].some((track) => track.kind === 'subtitles' || track.kind === 'captions'));
  // A player embedded from another site keeps its video in a frame SubPIP
  // cannot reach. Players ask for fullscreen or autoplay; ads and widgets
  // usually do not. The biggest one is the one worth opening.
  const size = (frame) => frame.getBoundingClientRect();
  const players = [...document.querySelectorAll('iframe[src]')]
    .filter((frame) => {
      const asks = `${frame.getAttribute('allow') || ''} ${frame.hasAttribute('allowfullscreen') ? 'fullscreen' : ''}`;
      return /^https?:/.test(frame.src) && size(frame).width >= 200 && size(frame).height >= 110 &&
        /fullscreen|autoplay|encrypted-media|picture-in-picture/.test(asks);
    })
    .sort((a, b) => size(b).width * size(b).height - size(a).width * size(a).height);
  return {
    host: location.hostname, path: location.pathname, pipOpen, hasVideo: videos.length > 0, hasTextTrack,
    embedUrl: players.length ? players[0].src : null
  };
}

// What is in the tab right now, or null where SubPIP cannot run (error pages,
// PDFs, pages we lack access to)
export async function probeTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: probePage });
    return result || null;
  } catch {
    return null;
  }
}

export async function detectPage(tab) {
  if (!tab || !tab.url || RESTRICTED.some((pattern) => pattern.test(tab.url))) return { state: 'restricted' };
  const probe = await probeTab(tab.id);
  if (!probe) return { state: 'restricted' };
  const host = probe.host.replace(/^www\./, '');
  const adapter = getSiteAdapter(probe.host, probe.path);
  const captionSource = adapter.label || (probe.hasTextTrack ? 'page text track' : null);
  if (!probe.pipOpen && !probe.hasVideo && probe.embedUrl) return { state: 'embedded', host, embedUrl: probe.embedUrl };
  const state = probe.pipOpen ? 'pip' : probe.hasVideo ? 'video' : 'none';
  return { state, host, captionSource };
}

export function describeStatus(status) {
  switch (status.state) {
    case 'video':
      return { title: `Video found on ${status.host}`, sub: status.captionSource ? `Captions: ${status.captionSource}` : 'No captions detected' };
    case 'pip':
      return { title: 'Playing in Picture-in-Picture', sub: `on ${status.host}` };
    case 'embedded':
      return { title: 'This video is in an embedded player', sub: 'Open the player in its own tab to use SubPIP' };
    case 'none':
      return { title: 'No video on this page', sub: 'Play a video, then open SubPIP' };
    case 'restricted':
      return { title: "SubPIP can't run on this page", sub: 'Chrome pages and the Web Store are off-limits' };
    default:
      return { title: 'Checking this page…', sub: '' };
  }
}
