// PiP settings menu: Speed (Premium), Caption size, Translate (Premium),
// Subtitles (Premium), Fill window. Size/translation are session overrides;
// nothing is saved. Built with DOM calls only (Trusted Types pages).

import { createIcon } from '../shared/icons.js';
import { CAPTION_SIZES, LANGUAGES, SPEEDS } from '../shared/settings.js';
import { decodeSubtitleFile } from './subtitles.js';

const UPGRADE_NOTE = 'Premium feature. Open the SubPIP popup to upgrade.';
// Each press of Earlier / Later moves the user's subtitles this far (seconds)
const DELAY_STEP = 0.25;
// A feature film's subtitles are well under 1 MB; anything huge is not one
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;

const signed = (seconds) => `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} s`;

export function createSettingsMenu({ video, pipDoc, session, isPremium, getSessionSettings, applyOverride, captions }) {
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
    render();
  };
  const backRow = () => item({ label: 'Back', back: true, onSelect: go('main') });

  function mainView() {
    return [
      item({ label: 'Speed', value: `${video.playbackRate}×`, premium: !isPremium, chevron: true, onSelect: go('speed') }),
      item({ label: 'Caption size', value: sizeLabel(), chevron: true, onSelect: go('size') }),
      item({ label: 'Translate', value: translateLabel(), premium: !isPremium, chevron: true, onSelect: go('translate') }),
      item({ label: 'Subtitles', value: captions.subtitles ? captions.subtitles.name : 'Page', premium: !isPremium, chevron: true, onSelect: go('subtitles') }),
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

  function subtitlesView() {
    if (!isPremium) return [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];
    const rows = [backRow(), item({ label: 'Load file…', value: 'SRT or VTT', onSelect: () => fileInput.click() })];
    if (fileProblem) rows.push(el('div', 'menu-note', fileProblem));
    const loaded = captions.subtitles;
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

  const VIEWS = { main: mainView, speed: speedView, size: sizeView, translate: translateView, subtitles: subtitlesView };

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
    if (isPremium) loadFile(file);
  };

  // Clicks anywhere outside the menu and gear close it
  session.listen(pipDoc, 'pointerdown', (event) => {
    if (panel.hidden) return;
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(button)) close();
  });

  return { button, panel, extras: [fileInput], isOpen: () => !panel.hidden, close, dropFile };
}
