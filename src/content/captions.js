// Captions inside the PiP window. Sources, in priority order:
//   1. Premium external subtitle file (VTT/SRT URL)
//   2. The site's own caption element (adapter.subtitleSelector), mirrored
//   3. A hidden text track the page renders itself (generic sites)
// "showing" text tracks are drawn by the video element and need nothing here.

import { translationCache, translateText } from './translation.js';
import { findHiddenTextTrack, cueText, parseVTTOrSRT } from './subtitles.js';

export async function setupCaptions({ video, adapter, pipDoc, session, getSettings, isPremium }) {
  const { listen, onCleanup, every } = session;
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
  // new one arrives, and never retry a line that already failed.
  let lastTranslation = '';
  let pendingTranslation = null;
  let translationTimer = null;
  const failedTranslations = new Set();
  onCleanup(() => clearTimeout(translationTimer));

  function displayText(text) {
    const lang = getSettings().targetLanguage;
    if (!translationOn || !text || !lang) return text;

    const cacheKey = `${text}_${lang}`;
    if (translationCache[cacheKey]) return (lastTranslation = translationCache[cacheKey]);
    if (failedTranslations.has(cacheKey)) return text;

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
    return lastTranslation || text;
  }

  function limitCaptionLines(root) {
    if (!adapter.maxCaptionLines) return;
    const lines = root.querySelectorAll('.captions-text > span');
    lines.forEach((line, index) => {
      line.style.display = index < lines.length - adapter.maxCaptionLines ? 'none' : 'block';
    });
  }

  // Plain-text captions (external subtitle file or text track)
  function useTextCaptions() {
    captionEl = document.createElement('div');
    captionEl.className = 'subpip-caption-container';
    captionEl.style.pointerEvents = 'none';
    captionEl.style.display = 'none';
    pipDoc.body.appendChild(captionEl);
    present();

    let currentText = '';
    rerender = () => {
      const shown = displayText(currentText);
      captionEl.textContent = shown;
      captionEl.style.display = shown ? '' : 'none';
    };
    return (text) => {
      if (text === currentText) return;
      currentText = text;
      rerender();
    };
  }

  // 1. Premium: external subtitle file (e.g. OpenSubtitles VTT link)
  const externalSubtitleUrl = isPremium ? (settings.externalSubtitleUrl || '').trim() : '';
  if (externalSubtitleUrl) {
    try {
      const resp = await fetch(externalSubtitleUrl, { mode: 'cors' });
      const cues = parseVTTOrSRT(await resp.text());
      const setText = useTextCaptions();
      const update = () => {
        const t = video.currentTime;
        const cue = cues.find((c) => t >= c.start && t <= c.end);
        setText(cue ? cue.text : '');
      };
      listen(video, 'timeupdate', update);
      listen(video, 'seeked', update);
      update();
    } catch (e) {
      console.warn('[SubPIP] External subtitles failed to load:', e?.message);
      if (captionEl) captionEl.remove();
      captionEl = null;
    }
  }

  if (!captionEl && adapter.subtitleSelector) {
    // 2. Mirror the site's own caption element (keeps its styling). Sites often
    // re-create this element, so re-find it whenever it gets detached.
    captionEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(captionEl);
    present();

    let source = null;
    const sourceObserver = new MutationObserver(() => rerender());
    onCleanup(() => sourceObserver.disconnect());

    rerender = () => {
      if (!source) return;
      const text = source.textContent?.trim() || '';
      const shown = displayText(text);
      captionEl.replaceChildren();

      if (shown !== text && source.firstElementChild) {
        const line = source.firstElementChild.cloneNode(false);
        line.textContent = shown;
        captionEl.appendChild(line);
      } else {
        for (const node of source.childNodes) captionEl.appendChild(node.cloneNode(true));
      }
      limitCaptionLines(captionEl);
    };

    const attachSource = () => {
      if (source && source.isConnected) return;
      const found = document.querySelector(adapter.subtitleSelector);
      if (!found || found === source) return;

      source = found;
      const fresh = source.cloneNode(false);
      captionEl.replaceWith(fresh);
      captionEl = fresh;
      present();
      sourceObserver.disconnect();
      sourceObserver.observe(source, { childList: true, subtree: true, characterData: true });
      rerender();
    };
    attachSource();
    every(1000, attachSource);
  } else if (!captionEl) {
    // 3. Generic sites: render cues from a text track the page draws itself
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
    }
  };
}
