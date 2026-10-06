// PiP settings menu: Speed (Premium), Caption size, Translate (Premium),
// Subtitles (the page's caption languages, and the viewer's own file with
// Premium), Fill window. Size/translation are session overrides; nothing is
// saved. Built with DOM calls only (Trusted Types pages).

import { createIcon } from '../shared/icons.js';
import { CAPTION_SIZES, LANGUAGES, SPEEDS } from '../shared/settings.js';
import { decodeSubtitleFile } from './subtitles.js';

const UPGRADE_NOTE = 'Premium feature. Open the SubPIP popup to upgrade.';
// Each press of Earlier / Later moves the user's subtitles this far (seconds)
const DELAY_STEP = 0.25;
// A feature film's subtitles are well under 1 MB; anything huge is not one
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

const signed = (seconds) => `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} s`;

// study: the study tools (study.js); null without Premium
export function createSettingsMenu({ video, pipDoc, session, isPremium, getSessionSettings, applyOverride, captions, study = null }) {
  const el = (tag, cls, text) => {
    const node = pipDoc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = el('button', 'btn gear');
  button.type = 'button';
  button.setAttribute('aria-label', 'Settings');
  button.title = 'Settings';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(createIcon(pipDoc, 'gear'));

  const panel = el('div', 'menu');
  panel.setAttribute('role', 'menu');
  panel.hidden = true;

  let view = 'main';
  // Only move focus into the menu for keyboard users (click detail 0)
  let keyboardMode = false;

  // The user's own subtitle file, picked in the chooser or dropped on the
  // window. It is read here and never leaves the browser.
  let fileProblem = '';
  async function loadFile(file) {
    let lines = 0;
    try {
      if (file.size <= MAX_SUBTITLE_BYTES) lines = captions.loadSubtitles(decodeSubtitleFile(await file.arrayBuffer()), file.name);
    } catch (e) {
      lines = 0;
    }
    fileProblem = lines ? '' : 'No subtitles found in that file.';
    view = 'subtitles';
    render();
  }

  // The chooser has to be opened from a click in this window
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.srt,.vtt,text/vtt';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (file) loadFile(file);
  });

  const sizeLabel = () => {
    const px = getSessionSettings().fontSize;
    return CAPTION_SIZES.reduce((best, size) => (Math.abs(size.px - px) < Math.abs(best.px - px) ? size : best)).label;
  };
  const languageName = (code) => (LANGUAGES.find((lang) => lang.code === code) || { name: code }).name;
  const translateLabel = () => (captions.translationOn ? languageName(getSessionSettings().targetLanguage) : 'Off');
  // The viewer's file, else the page's caption language, else just "Page"
  // where the page offers no choice SubPIP can see
  const speechLabel = () => {
    const { state, language } = captions.speech;
    if (state === 'on') return languageName(language);
    return state === 'fetching' ? 'Getting…' : 'Off';
  };
  const subtitlesLabel = () => {
    if (captions.subtitles) return captions.subtitles.name;
    if (captions.speech.state === 'on') return 'From speech';
    const tracks = captions.pageTracks();
    if (!tracks.length) return 'Page';
    return (tracks.find((track) => track.selected) || { label: 'Off' }).label;
  };

  // One row: label, then a value / Premium tag / check mark / chevron
  function item({ label, value, premium, checked, chevron, back, onSelect }) {
    const row = el('button', back ? 'menu-item head' : 'menu-item');
    row.type = 'button';
    row.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
    if (checked !== undefined) {
      const check = createIcon(pipDoc, 'check');
      check.classList.add('check');
      row.append(check);
      row.setAttribute('aria-checked', String(checked));
    }
    if (back) row.append(createIcon(pipDoc, 'chevron-left'));
    row.append(el('span', 'label', label));
    if (premium) row.append(el('span', 'tag', 'Premium'));
    else if (value !== undefined) row.append(el('span', 'value', value));
    if (chevron) row.append(createIcon(pipDoc, 'chevron-right'));
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      keyboardMode = event.detail === 0;
      onSelect();
    });
    return row;
  }

  const go = (next) => () => {
    view = next;
    fileProblem = '';
    render();
  };
  const backRow = (to = 'main') => item({ label: 'Back', back: true, onSelect: go(to) });

  function mainView() {
    return [
      item({ label: 'Speed', value: `${video.playbackRate}×`, premium: !isPremium, chevron: true, onSelect: go('speed') }),
      item({ label: 'Caption size', value: sizeLabel(), chevron: true, onSelect: go('size') }),
      item({ label: 'Translate', value: translateLabel(), premium: !isPremium, chevron: true, onSelect: go('translate') }),
      item({ label: 'Subtitles', value: subtitlesLabel(), chevron: true, onSelect: go('subtitles') }),
      item({ label: 'Study tools', value: study && study.pauseAfterLine ? 'Stops after lines' : 'Off', premium: !isPremium, chevron: true, onSelect: go('study') }),
      item({
        label: 'Fill window',
        value: video.style.objectFit === 'fill' ? 'On' : 'Off',
        onSelect: () => {
          video.style.objectFit = video.style.objectFit === 'fill' ? 'contain' : 'fill';
          render();
        }
      })
    ];
  }

  function speedView() {
    if (!isPremium) return [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];
    return [backRow(), ...SPEEDS.map((speed) => item({
      label: `${speed}×`,
      checked: video.playbackRate === speed,
      onSelect: () => {
        video.playbackRate = speed;
        go('main')();
      }
    }))];
  }

  function sizeView() {
    const current = sizeLabel();
    return [backRow(), ...CAPTION_SIZES.map((size) => item({
      label: size.label,
      value: `${size.px}px`,
      checked: size.label === current,
      onSelect: () => {
        applyOverride({ fontSize: size.px });
        go('main')();
      }
    }))];
  }

  function translateView() {
    if (!isPremium) return [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];
    const code = getSessionSettings().targetLanguage;
    const dual = !!getSessionSettings().dualSubtitles;
    return [
      backRow(),
      item({
        label: 'Show original too',
        value: dual ? 'On' : 'Off',
        onSelect: () => {
          applyOverride({ dualSubtitles: !dual });
          render();
        }
      }),
      item({
        label: 'Off',
        checked: !captions.translationOn,
        onSelect: () => {
          captions.setTranslationOn(false);
          go('main')();
        }
      }),
      ...LANGUAGES.map((lang) => item({
        label: lang.name,
        checked: captions.translationOn && lang.code === code,
        onSelect: () => {
          applyOverride({ targetLanguage: lang.code });
          captions.setTranslationOn(true);
          go('main')();
        }
      }))
    ];
  }

  // A site player may take a moment to switch language: look again shortly
  let recheck = null;
  session.onCleanup(() => clearTimeout(recheck));

  function subtitlesView() {
    const rows = [backRow()];
    const loaded = captions.subtitles;
    // The page's own captions, where there is a choice, while they are in use
    const tracks = loaded ? [] : captions.pageTracks();
    if (tracks.length) {
      const choose = (id) => () => {
        captions.selectPageTrack(id);
        render();
        clearTimeout(recheck);
        recheck = setTimeout(() => {
          if (!panel.hidden && view === 'subtitles') render();
        }, 800);
      };
      rows.push(
        ...tracks.map((track) => item({ label: track.label, checked: track.selected, onSelect: choose(track.id) })),
        item({ label: 'Off', checked: !tracks.some((track) => track.selected), onSelect: choose(null) })
      );
    }
    // Captions written from the video's sound, for videos that have none
    // (not offered for a protected video, whose sound Chrome hands to nobody)
    if (!loaded && captions.speechPossible) rows.push(item({ label: 'From speech', value: speechLabel(), premium: !isPremium, chevron: true, onSelect: go('speech') }));
    rows.push(item({
      label: 'Load file…',
      value: 'SRT or VTT',
      premium: !isPremium,
      onSelect: () => {
        if (isPremium) {
          fileInput.click();
          return;
        }
        fileProblem = UPGRADE_NOTE;
        render();
      }
    }));
    if (fileProblem) rows.push(el('div', 'menu-note', fileProblem));
    if (loaded) {
      const nudge = (seconds) => () => {
        captions.setDelay(captions.delay + seconds);
        render();
      };
      rows.push(
        el('div', 'menu-note', `${loaded.name} · Delay ${captions.delay === 0 ? '0 s' : signed(captions.delay)}`),
        item({ label: 'Earlier', value: signed(-DELAY_STEP), onSelect: nudge(-DELAY_STEP) }),
        item({ label: 'Later', value: signed(DELAY_STEP), onSelect: nudge(DELAY_STEP) }),
        item({
          label: 'Use page captions',
          onSelect: () => {
            captions.removeSubtitles();
            render();
          }
        })
      );
    }
    return rows;
  }

  // Where a Premium feature outside the menu sends a free viewer
  const premiumView = () => [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];

  const SPEECH_NOTES = {
    fetching: (name) => `Getting the speech pack for ${name}. This can take a minute.`,
    unavailable: (name) => `Your browser cannot recognise ${name} on this device.`,
    unsupported: () => 'Captions from speech need Chrome 139 or newer.',
    blocked: () => "This video's sound cannot be read: it is protected, or it comes from another site.",
    failed: () => 'Speech recognition could not start.'
  };
  function speechView() {
    if (!isPremium) return [backRow('subtitles'), el('div', 'menu-note', UPGRADE_NOTE)];
    const { state, language } = captions.speech;
    const chosen = state === 'on' || state === 'fetching' ? language : null;
    const note = SPEECH_NOTES[state]
      ? SPEECH_NOTES[state](languageName(language))
      : 'Captions written from what is said in the video, on your device. Choose the language being spoken.';
    return [
      backRow('subtitles'),
      el('div', 'menu-note', note),
      item({
        label: 'Off',
        checked: chosen === null,
        onSelect: () => {
          captions.stopSpeech();
          render();
        }
      }),
      ...LANGUAGES.map((lang) => item({ label: lang.name, checked: lang.code === chosen, onSelect: () => { captions.startSpeech(lang.code); } }))
    ];
  }
  // The speech pack arrives, or recognition fails, some time after the choice
  captions.onSpeechChange(() => {
    if (!panel.hidden) render();
  });

  function studyView() {
    if (!study) return premiumView();
    const stops = study.pauseAfterLine;
    return [
      backRow(),
      item({
        label: 'Stop after each line',
        value: stops ? 'On' : 'Off',
        onSelect: () => {
          study.setPauseAfterLine(!stops);
          render();
        }
      }),
      el('div', 'menu-note', 'Keys: A previous line, S replay, D next line, Q stop after each line. Click a word in the captions for its meaning.')
    ];
  }

  const VIEWS = { main: mainView, speed: speedView, size: sizeView, translate: translateView, subtitles: subtitlesView, speech: speechView, study: studyView, premium: premiumView };

  function render() {
    panel.replaceChildren(...VIEWS[view]());
    const first = panel.querySelector('.menu-item');
    if (first && !panel.hidden && keyboardMode) first.focus({ preventScroll: true });
  }

  const open = (startView = 'main') => {
    view = startView;
    fileProblem = '';
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    keyboardMode = event.detail === 0;
    if (panel.hidden) open();
    else close();
  });

  // A file dropped on the window: the menu opens on Subtitles, showing the
  // file once it is loaded, what was wrong with it, or the Premium note
  const dropFile = (file) => {
    keyboardMode = false;
    open('subtitles');
    if (isPremium) {
      loadFile(file);
      return;
    }
    fileProblem = UPGRADE_NOTE;
    render();
  };

  // Clicks anywhere outside the menu and gear close it
  session.listen(pipDoc, 'pointerdown', (event) => {
    if (panel.hidden) return;
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(button)) close();
  });

  const showUpgrade = () => {
    keyboardMode = false;
    open('premium');
  };

  // After something the menu shows was changed from outside it (a key)
  const refresh = () => {
    if (!panel.hidden) render();
  };

  return { button, panel, extras: [fileInput], isOpen: () => !panel.hidden, close, dropFile, showUpgrade, refresh };
}
