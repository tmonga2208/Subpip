// Captions inside the PiP window. Sources, in priority order:
//   1. The user's own subtitles (Premium): a file loaded from the PiP menu,
//      or the VTT/SRT link saved in the popup
//   2. The site's own caption element (adapter.subtitleSelector), mirrored
//   3. A hidden text track the page renders itself (generic sites)
// "showing" text tracks are drawn by the video element and need nothing here.

import { translationCache, translateText } from './translation.js';
import { findHiddenTextTrack, cueText, cueAt, parseVTTOrSRT } from './subtitles.js';
import { createSession } from './session.js';

// memory.value outlives the PiP window, so a loaded file is still there when
// the window is reopened on the same page
export async function setupCaptions({ video, adapter, pipDoc, session, getSettings, isPremium, memory = { value: null } }) {
  const settings = getSettings();

  let translationOn = !!(isPremium && settings.translationEnabled);
  let captionEl = null;
  let rerender = () => { };

  // CC toggle state, re-applied whenever the caption element is replaced
  let captionsVisible = true;
  const present = () => {
    if (captionEl) captionEl.style.visibility = captionsVisible ? '' : 'hidden';
  };

  // Translation with flicker prevention: show the last translation until the
  // new one arrives, and never retry a line that already failed. With dual
  // subtitles the original is on screen anyway, so its translation simply
  // appears under it when it arrives.
  let lastTranslation = '';
  let pendingTranslation = null;
  let translationTimer = null;
  const failedTranslations = new Set();
  session.onCleanup(() => clearTimeout(translationTimer));

  // What to put on screen for a caption line: { text }, or for dual subtitles
  // { original, translation }
  function display(text) {
    const { targetLanguage: lang, dualSubtitles: dual } = getSettings();
    if (!translationOn || !text || !lang) return { text };

    const cacheKey = `${text}_${lang}`;
    if (translationCache[cacheKey]) {
      lastTranslation = translationCache[cacheKey];
      return dual ? { original: text, translation: lastTranslation } : { text: lastTranslation };
    }
    if (failedTranslations.has(cacheKey)) return { text };

    if (pendingTranslation !== cacheKey) {
      pendingTranslation = cacheKey;
      clearTimeout(translationTimer);
      translationTimer = setTimeout(async () => {
        await translateText(text, lang, getSettings().uid);
        if (!translationCache[cacheKey]) failedTranslations.add(cacheKey);
        if (pendingTranslation === cacheKey) {
          pendingTranslation = null;
          rerender();
        }
      }, 80);
    }
    // A non-breaking space holds the translation's row, so the caption does
    // not jump when it arrives
    return dual ? { original: text, translation: '\u00A0' } : { text: lastTranslation || text };
  }

  function paint(el, shown) {
    if (shown.original === undefined) {
      el.textContent = shown.text;
      return;
    }
    const original = pipDoc.createElement('span');
    original.className = 'subpip-original';
    original.textContent = shown.original;
    const translation = pipDoc.createElement('span');
    translation.className = 'subpip-translation';
    translation.textContent = shown.translation;
    el.replaceChildren(original, translation);
  }

  function limitCaptionLines(root) {
    if (!adapter.maxCaptionLines) return;
    const lines = root.querySelectorAll('.captions-text > span');
    lines.forEach((line, index) => {
      line.style.display = index < lines.length - adapter.maxCaptionLines ? 'none' : 'block';
    });
  }

  // One caption source runs at a time, in its own cleanup scope
  let retime = () => { };
  let source = null;
  session.onCleanup(() => source && source.dispose());
  function show(startSource) {
    if (source) source.dispose();
    if (captionEl) captionEl.remove();
    captionEl = null;
    rerender = () => { };
    retime = () => { };
    lastTranslation = '';
    source = createSession();
    startSource(source);
  }

  // Plain-text captions (the user's subtitles or a text track)
  function useTextCaptions() {
    captionEl = document.createElement('div');
    captionEl.className = 'subpip-caption-container';
    captionEl.style.pointerEvents = 'none';
    captionEl.style.display = 'none';
    pipDoc.body.appendChild(captionEl);
    present();

    let currentText = '';
    rerender = () => {
      paint(captionEl, display(currentText));
      captionEl.style.display = currentText ? '' : 'none';
    };
    return (text) => {
      if (text === currentText) return;
      currentText = text;
      rerender();
    };
  }

  // 1. The user's own subtitles: { name, cues, fromFile }. A positive delay
  // shows every line that much later.
  let own = null;
  let delay = 0;
  const remember = () => {
    memory.value = own && own.fromFile ? { href: location.href, own, delay } : null;
  };
  function showOwnSubtitles({ listen }) {
    const setText = useTextCaptions();
    retime = () => setText(cueAt(own.cues, video.currentTime - delay));
    listen(video, 'timeupdate', retime);
    listen(video, 'seeked', retime);
    retime();
  }

  // 2. Mirror the site's own caption element (keeps its styling). Sites often
  // re-create this element, so re-find it whenever it gets detached.
  function mirrorSiteCaptions({ onCleanup, every }) {
    captionEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(captionEl);
    present();

    let siteEl = null;
    const observer = new MutationObserver(() => rerender());
    onCleanup(() => observer.disconnect());

    rerender = () => {
      if (!siteEl) return;
      const text = siteEl.textContent?.trim() || '';
      const shown = display(text);
      captionEl.replaceChildren();

      if (shown.text !== text && siteEl.firstElementChild) {
        const line = siteEl.firstElementChild.cloneNode(false);
        paint(line, shown);
        captionEl.appendChild(line);
      } else {
        for (const node of siteEl.childNodes) captionEl.appendChild(node.cloneNode(true));
      }
      limitCaptionLines(captionEl);
    };

    const attach = () => {
      if (siteEl && siteEl.isConnected) return;
      const found = document.querySelector(adapter.subtitleSelector);
      if (!found || found === siteEl) return;

      siteEl = found;
      const fresh = siteEl.cloneNode(false);
      captionEl.replaceWith(fresh);
      captionEl = fresh;
      present();
      observer.disconnect();
      observer.observe(siteEl, { childList: true, subtree: true, characterData: true });
      rerender();
    };
    attach();
    every(1000, attach);
  }

  // 3. Generic sites: render cues from a text track the page draws itself
  function followTextTrack({ listen, onCleanup }) {
    const setText = useTextCaptions();
    let track = null;
    const onCueChange = () => setText(track ? cueText(track) : '');
    const pickTrack = () => {
      const next = findHiddenTextTrack(video);
      if (next === track) return;
      if (track) track.removeEventListener('cuechange', onCueChange);
      track = next;
      if (track) track.addEventListener('cuechange', onCueChange);
      onCueChange();
    };
    onCleanup(() => track && track.removeEventListener('cuechange', onCueChange));
    if (video.textTracks) {
      listen(video.textTracks, 'change', pickTrack);
      listen(video.textTracks, 'addtrack', pickTrack);
      listen(video.textTracks, 'removetrack', pickTrack);
    }
    pickTrack();
  }

  const showPageCaptions = adapter.subtitleSelector ? mirrorSiteCaptions : followTextTrack;

  // A file loaded earlier on this page wins over the saved link
  const remembered = memory.value && memory.value.href === location.href ? memory.value : null;
  const subtitleUrl = isPremium ? (settings.externalSubtitleUrl || '').trim() : '';
  if (isPremium && remembered) {
    own = remembered.own;
    delay = remembered.delay;
  } else if (subtitleUrl) {
    try {
      const response = await fetch(subtitleUrl, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cues = parseVTTOrSRT(await response.text());
      if (!cues.length) throw new Error('no subtitles in the file');
      own = { name: 'Link', cues, fromFile: false };
    } catch (e) {
      console.warn('[SubPIP] External subtitles failed to load:', e?.message);
    }
  }
  show(own ? showOwnSubtitles : showPageCaptions);

  return {
    get translationOn() { return translationOn; },
    setTranslationOn(on) {
      translationOn = on;
      lastTranslation = '';
      rerender();
    },
    setVisible(on) {
      captionsVisible = on;
      present();
    },
    // Re-render after settings change (e.g. target language)
    refresh() {
      lastTranslation = '';
      rerender();
    },
    // The user's own subtitles, or null while the page's captions are shown
    get subtitles() { return own ? { name: own.name, lines: own.cues.length } : null; },
    get delay() { return delay; },
    // Returns how many lines the file had; 0 leaves the current captions alone
    loadSubtitles(text, name) {
      const cues = parseVTTOrSRT(text);
      if (!cues.length) return 0;
      own = { name, cues, fromFile: true };
      delay = 0;
      remember();
      show(showOwnSubtitles);
      return cues.length;
    },
    removeSubtitles() {
      own = null;
      delay = 0;
      remember();
      show(showPageCaptions);
    },
    setDelay(seconds) {
      delay = Math.round(seconds * 100) / 100;
      remember();
      retime();
    }
  };
}
