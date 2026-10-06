// Captions inside the PiP window. Sources, in priority order:
//   1. The user's own subtitles (Premium): a file loaded from the PiP menu,
//      or the VTT/SRT link saved in the popup
//   2. The element the viewer pointed at on this site (caption-picker.js)
//   3. The site's own caption element (adapter.subtitleSelector), mirrored
//   4. One of the video's subtitle tracks (sites without an adapter)
//   5. The caption element of one of the common web players
// And when the viewer asks for it (Premium): captions written from the
// video's own sound, by Chrome's on-device speech recognition.
// The page's captions are switched on when they are off, and the menu chooses
// between the languages the page offers.

import { translationCache, translateText } from './translation.js';
import { subtitleTracks, preferredTrack, trackLabel, trackTextAt, cueAt, parseVTTOrSRT, plainCaptionText } from './subtitles.js';
import { lineAt, createLineLog, speechCaption, speechLines } from './lines.js';
import { SPEECH_TAGS } from '../shared/settings.js';
import { createSession } from './session.js';
import { findPlayerCaptions } from './adapters.js';

// With "stop after each line", how long before a line's end the video stops
const STOP_BEFORE_END = 0.08;
// Captions from speech: taken away after this long without anything new, and
// - while they are being translated - renewed no more often than this
const SPEECH_QUIET_MS = 4000;
const TRANSLATED_SPEECH_GAP_MS = 1000;

// The lines an element shows: none while it is not displayed
function elementLines(element) {
  if (!element.getClientRects().length) return '';
  return element.innerText.split('\n').map((line) => line.trim()).filter(Boolean).join('\n').slice(0, 400);
}

// memory.value outlives the PiP window, so a loaded file is still there when
// the window is reopened on the same page
export async function setupCaptions({ video, adapter, pipDoc, session, getSettings, isPremium, memory = { value: null } }) {
  const settings = getSettings();

  let translationOn = !!(isPremium && settings.translationEnabled);
  let captionEl = null;
  let rerender = () => { };

  // CC toggle state, re-applied whenever the caption element is replaced
  let captionsVisible = true;
  // With Premium a caption can be clicked for a word's meaning (study.js);
  // otherwise clicks go through it to the picture
  const present = () => {
    if (!captionEl) return;
    captionEl.style.visibility = captionsVisible ? '' : 'hidden';
    captionEl.setAttribute('data-subpip-captions', '');
    captionEl.style.setProperty('pointer-events', isPremium ? 'auto' : 'none', 'important');
    if (isPremium) captionEl.style.cursor = 'pointer';
  };

  // The caption as the page gave it (before any translation), and the lines
  // seen so far where the page gives no timings (see lines.js)
  let rawLine = '';
  const log = createLineLog();
  let pauseAfterLine = false;
  // A file's or a track's lines come with their own times
  const timed = () => !!own || pageSource === 'track';
  function noteLine(text) {
    if (text === rawLine) return;
    const previous = rawLine;
    rawLine = text;
    if (timed()) return;
    log.note(video.currentTime, text);
    // No end time to stop at: stop when the line gives way to the next
    if (pauseAfterLine && previous && !text.startsWith(previous) && !video.paused) video.pause();
  }

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
  // Which of the page's captions are in use: 'picked', 'site', 'track',
  // 'player', or null while it is the viewer's own file (or nothing yet)
  let pageSource = null;
  function show(startSource) {
    if (source) source.dispose();
    if (captionEl) captionEl.remove();
    captionEl = null;
    rerender = () => { };
    retime = () => { };
    lastTranslation = '';
    pageSource = null;
    rawLine = '';
    // Any other captions take the place of the ones from speech
    if (startSource !== listenToSpeech && speech.state !== 'off') setSpeech('off', null);
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
      noteLine(text);
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
    pageSource = 'site';
    captionEl = pipDoc.createElement('div');
    pipDoc.body.appendChild(captionEl);
    present();

    // Where SubPIP can work the site's caption switch, captions that are off
    // are on for as long as they are mirrored
    if (siteCaptions && siteCaptions.current() === null) {
      siteCaptions.turnOn();
      onCleanup(() => siteCaptions.select(null));
    }

    let siteEl = null;
    const observer = new MutationObserver(() => rerender());
    onCleanup(() => observer.disconnect());

    rerender = () => {
      if (!siteEl) return;
      const text = siteEl.textContent?.trim() || '';
      noteLine(text);
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

  // 3. Generic sites: one of the video's subtitle tracks. A track the page
  // shows itself would also be drawn inside this window, by the video element;
  // while the window is open SubPIP draws it instead (in the viewer's caption
  // style, translated if asked) and the page gets its tracks back afterwards.
  const wasMode = new Map();
  session.onCleanup(() => {
    for (const [track, mode] of wasMode) track.mode = mode;
  });
  // The track on screen: undefined until one is picked, null once the viewer chose Off
  let pageTrack;
  let retrack = () => { };
  function followTextTrack({ listen, onCleanup, every }) {
    pageSource = 'track';
    const setText = useTextCaptions();
    let track = null;
    const onCueChange = () => setText(track ? trackTextAt(track, video.currentTime) : '');
    const pickTrack = () => {
      const tracks = subtitleTracks(video);
      for (const each of tracks) {
        if (!wasMode.has(each)) wasMode.set(each, each.mode);
        if (each.mode === 'showing') each.mode = 'hidden';
      }
      if (pageTrack !== null && !tracks.includes(pageTrack)) pageTrack = preferredTrack(tracks, wasMode) || undefined;
      const next = pageTrack || null;
      // A track that is off loads nothing and reports no lines
      if (next && next.mode === 'disabled') next.mode = 'hidden';
      if (next !== track) {
        if (track) track.removeEventListener('cuechange', onCueChange);
        track = next;
        if (track) track.addEventListener('cuechange', onCueChange);
      }
      onCueChange();
    };
    retrack = pickTrack;
    onCleanup(() => {
      retrack = () => { };
      if (track) track.removeEventListener('cuechange', onCueChange);
    });
    if (video.textTracks) {
      listen(video.textTracks, 'change', pickTrack);
      listen(video.textTracks, 'addtrack', pickTrack);
      listen(video.textTracks, 'removetrack', pickTrack);
    }
    listen(video, 'timeupdate', onCueChange);
    listen(video, 'seeked', onCueChange);
    // A track's file arrives some time after the track is switched on, with no
    // event to say so when the video is paused
    every(500, onCueChange);
    pickTrack();
  }

  // Captions the page keeps in an element of its own, read as text and drawn
  // in SubPIP's caption box. Sites re-create such elements, so it is looked up
  // again whenever it has gone.
  function followElementText({ onCleanup, every }, selector, kind) {
    pageSource = kind;
    const setText = useTextCaptions();
    let element = null;
    const read = () => setText(element && element.isConnected ? elementLines(element) : '');
    const observer = new MutationObserver(read);
    onCleanup(() => observer.disconnect());
    const attach = () => {
      if (!element || !element.isConnected) {
        observer.disconnect();
        try {
          element = document.querySelector(selector);
        } catch (e) {
          element = null;
        }
        if (element) observer.observe(element, { childList: true, subtree: true, characterData: true, attributes: true });
      }
      read();
    };
    attach();
    every(1000, attach);
  }

  const siteCaptions = adapter.captions || null;
  // What the viewer pointed at on this site comes before anything SubPIP
  // works out by itself
  let pickedSelector = (settings.captionSelector || '').trim();

  function showPageCaptions(scope) {
    if (pickedSelector) return followElementText(scope, pickedSelector, 'picked');
    if (adapter.subtitleSelector) return mirrorSiteCaptions(scope);
    // A site without an adapter: the video's subtitle tracks, else the caption
    // element of a player SubPIP recognises. Either may only appear once the
    // page's captions start.
    let started = false;
    const start = () => {
      if (started) return;
      const hasTracks = subtitleTracks(video).length > 0;
      const player = hasTracks ? null : findPlayerCaptions();
      if (!hasTracks && !player) return;
      started = true;
      if (player) followElementText(scope, player.selector, 'player');
      else followTextTrack(scope);
    };
    start();
    scope.every(1000, start);
    if (video.textTracks) scope.listen(video.textTracks, 'addtrack', start);
  }

  // Captions from the video's own sound (Premium). Chrome's speech
  // recognition listens to it on this device, in the language the viewer says
  // is spoken. state: off | fetching (the speech pack) | on | unsupported
  // (browser) | unavailable (language) | blocked (the sound) | failed.
  // Listening goes on only while it is "on" or the next language is fetched.
  const speech = { state: 'off', language: null };
  let speechChanged = () => { };
  let speechRequest = 0;
  function setSpeech(state, language = speech.language) {
    speech.state = state;
    speech.language = language;
    speechChanged();
  }
  // Captions from speech that cannot run, or cannot go on: the captions they
  // took the place of come back, and the menu says why
  function refuseSpeech(state, language = speech.language) {
    if (pageSource === 'speech') show(own ? showOwnSubtitles : showPageCaptions);
    setSpeech(state, language);
  }
  // The PiP window's own: it stays in front, the page may be a background tab
  const Recognition = () => pipDoc.defaultView.SpeechRecognition || pipDoc.defaultView.webkitSpeechRecognition || null;

  // The video's sound, for the recogniser: one capture for as long as the
  // window is open. Chrome gives the sound to the latest capture alone, so a
  // second one would silence the first. A capture keeps up with the video by
  // itself: it gets a new sound track for each video loaded into the element,
  // and when one is played again after its end. Its sound tracks are never
  // stopped here: that silences any later capture of the same video as well.
  // null where Chrome keeps the sound back: a protected video, or one whose
  // sound comes from another site.
  let sound = null;
  function captureSound() {
    if (video.mediaKeys) return null;
    if (sound) return sound;
    try {
      sound = video.captureStream();
    } catch (e) {
      return null;
    }
    // Only the sound is wanted
    const dropPicture = () => sound.getVideoTracks().forEach((track) => track.stop());
    sound.addEventListener('addtrack', dropPicture);
    dropPicture();
    return sound;
  }

  function listenToSpeech({ listen, onCleanup }) {
    pageSource = 'speech';
    const setText = useTextCaptions();
    // The language it began in, whichever is being fetched meanwhile
    const lang = SPEECH_TAGS[speech.language];
    let recognition = null;
    // The sound track it listens to
    let heard = null;
    let followed = null;
    let over = false;
    let restartTimer = null;
    let quietTimer = null;
    let showTimer = null;
    // Lines already taken off the screen after a silence
    let hidden = 0;
    let lastShown = 0;
    let latest = '';
    const showNow = () => {
      lastShown = Date.now();
      setText(latest);
    };
    const showSoon = (text) => {
      latest = text;
      const wait = (translationOn ? TRANSLATED_SPEECH_GAP_MS : 0) - (Date.now() - lastShown);
      clearTimeout(showTimer);
      if (wait <= 0) showNow();
      else showTimer = setTimeout(showNow, wait);
    };
    const onResult = (event) => {
      let said = '';
      for (let i = 0; i < event.results.length; i++) said += ` ${event.results[i][0].transcript}`;
      showSoon(speechCaption(said, hidden));
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        hidden = speechLines(said).length;
        showSoon('');
      }, SPEECH_QUIET_MS);
    };
    const drop = () => {
      const old = recognition;
      recognition = null;
      if (!old) return;
      try {
        old.abort();
      } catch (e) {
        // Already stopped
      }
    };
    // Listens to the video's sound as it is now, in place of any listening so far
    const start = () => {
      clearTimeout(restartTimer);
      if (over) return;
      drop();
      const stream = captureSound();
      if (!stream) {
        refuseSpeech('blocked');
        return;
      }
      if (stream !== followed) {
        followed = stream;
        listen(stream, 'addtrack', onTrack);
      }
      // The latest: a video that was in the element before leaves its track
      // behind, live and silent
      heard = stream.getAudioTracks().filter((track) => track.readyState === 'live').pop() || null;
      // Nothing to hear yet: the video is still loading, or has reached its end
      if (!heard) return;
      hidden = 0;
      const mine = new (Recognition())();
      recognition = mine;
      Object.assign(mine, { lang, continuous: true, interimResults: true, processLocally: true });
      mine.addEventListener('result', (event) => {
        if (recognition === mine) onResult(event);
      });
      // Should it stop by itself
      mine.addEventListener('end', () => {
        if (recognition !== mine) return;
        recognition = null;
        restartTimer = setTimeout(start, 300);
      });
      mine.addEventListener('error', (event) => {
        if (recognition !== mine || !['not-allowed', 'service-not-allowed', 'language-not-supported'].includes(event.error)) return;
        refuseSpeech('failed');
      });
      try {
        mine.start(heard);
      } catch (e) {
        refuseSpeech('failed');
      }
    };
    // Nothing tells the recogniser that the sound it listens to is over (the
    // next episode or an ad has begun, the video has ended): it goes on
    // waiting. The capture's next sound track is the one to listen to.
    function onTrack(event) {
      if (event.track.kind === 'audio' && event.track !== heard) start();
    }
    onCleanup(() => {
      over = true;
      clearTimeout(restartTimer);
      clearTimeout(quietTimer);
      clearTimeout(showTimer);
      drop();
    });
    start();
  }

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

  // Every line with its times, for stepping through them
  const lines = () => {
    if (own) return own.cues.map((cue) => ({ start: cue.start + delay, end: cue.end + delay, text: cue.text }));
    if (pageSource === 'track') {
      return [...((pageTrack && pageTrack.cues) || [])].map((cue) => ({ start: cue.startTime, end: cue.endTime, text: plainCaptionText(cue.text) }));
    }
    return log.lines;
  };

  // "Stop after each line" for lines with a known end: stop just before it,
  // once per line, so carrying on plays the next line through
  let armedFor = null;
  let armedEnd = 0;
  let stopTimer = null;
  const disarm = () => {
    armedFor = null;
    clearTimeout(stopTimer);
  };
  const armStop = () => {
    if (!pauseAfterLine || video.paused || !timed()) return;
    const line = lineAt(lines(), video.currentTime);
    if (!line || line.end === undefined || video.currentTime >= line.end || armedFor === line.start) return;
    disarm();
    armedFor = line.start;
    armedEnd = line.end;
    const wait = (line.end - STOP_BEFORE_END - video.currentTime) / (video.playbackRate || 1);
    stopTimer = setTimeout(() => {
      if (pauseAfterLine && !video.paused && armedFor === line.start) video.pause();
    }, Math.max(0, wait * 1000));
  };
  session.onCleanup(disarm);
  session.listen(video, 'timeupdate', armStop);
  session.listen(video, 'play', armStop);
  session.listen(video, 'seeking', disarm);
  session.listen(video, 'ratechange', disarm);
  // Paused by the viewer before the line was over: stop at its end after all
  session.listen(video, 'pause', () => {
    if (armedFor !== null && video.currentTime < armedEnd - STOP_BEFORE_END - 0.15) disarm();
  });

  return {
    get rawLine() { return rawLine; },
    lines,
    get pauseAfterLine() { return pauseAfterLine; },
    setPauseAfterLine(on) {
      pauseAfterLine = on;
      disarm();
      armStop();
    },
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
    // Re-render after settings change (e.g. target language). Captions the
    // viewer has just pointed at take over from the page's other captions.
    refresh() {
      const picked = (getSettings().captionSelector || '').trim();
      if (picked !== pickedSelector) {
        pickedSelector = picked;
        if (!own) show(showPageCaptions);
      }
      lastTranslation = '';
      rerender();
    },
    // The page's own caption choices, for the menu: [{ id, label, selected }].
    // Empty where there is nothing to choose between.
    pageTracks() {
      if (pageSource === 'site' && siteCaptions) {
        const current = siteCaptions.current();
        return siteCaptions.tracks().map((track) => ({ ...track, selected: track.id === current }));
      }
      if (pageSource !== 'track') return [];
      return subtitleTracks(video).map((track, index) => ({ id: index, label: trackLabel(track, index), selected: track === pageTrack }));
    },
    // id from pageTracks(), or null for Off
    selectPageTrack(id) {
      if (pageSource === 'site' && siteCaptions) {
        siteCaptions.select(id);
      } else if (pageSource === 'track') {
        pageTrack = id === null ? null : subtitleTracks(video)[id] || null;
        retrack();
      }
    },
    // Captions from the video's sound: { state, language } (see listenToSpeech)
    get speech() { return { ...speech }; },
    // false for a protected video. Sound from another site only shows when it
    // is captured, so that case is still offered and then explained.
    get speechPossible() { return !video.mediaKeys; },
    onSpeechChange(fn) { speechChanged = fn; },
    async startSpeech(language) {
      const request = ++speechRequest;
      const SpeechRecognition = Recognition();
      if (!SpeechRecognition || typeof SpeechRecognition.available !== 'function') {
        setSpeech('unsupported', language);
        return;
      }
      // Before anything is fetched: a speech pack is no use to a video that
      // cannot be heard
      if (!captureSound()) {
        refuseSpeech('blocked', language);
        return;
      }
      const wanted = { langs: [SPEECH_TAGS[language]], processLocally: true };
      try {
        let ready = await SpeechRecognition.available(wanted);
        if (ready === 'downloadable' || ready === 'downloading') {
          setSpeech('fetching', language);
          await SpeechRecognition.install(wanted);
          ready = await SpeechRecognition.available(wanted);
        }
        // The viewer chose something else meanwhile
        if (request !== speechRequest) return;
        if (ready !== 'available') {
          refuseSpeech('unavailable', language);
          return;
        }
      } catch (e) {
        if (request === speechRequest) refuseSpeech('failed', language);
        return;
      }
      setSpeech('on', language);
      show(listenToSpeech);
    },
    stopSpeech() {
      speechRequest++;
      const listening = pageSource === 'speech';
      setSpeech('off', null);
      if (listening) show(own ? showOwnSubtitles : showPageCaptions);
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
