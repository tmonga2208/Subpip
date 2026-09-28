// PiP settings menu: Speed (Premium), Caption size, Translate (Premium),
// Fill window. Size/translation are session overrides; nothing is saved.
// Built with DOM calls only (Trusted Types pages).

import { createIcon } from '../shared/icons.js';
import { CAPTION_SIZES, LANGUAGES } from '../shared/settings.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const UPGRADE_NOTE = 'Premium feature. Open the SubPIP popup to upgrade.';

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
    return [
      backRow(),
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

  const VIEWS = { main: mainView, speed: speedView, size: sizeView, translate: translateView };

  function render() {
    panel.replaceChildren(...VIEWS[view]());
    const first = panel.querySelector('.menu-item');
    if (first && !panel.hidden && keyboardMode) first.focus({ preventScroll: true });
  }

  const open = () => {
    view = 'main';
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

  // Clicks anywhere outside the menu and gear close it
  session.listen(pipDoc, 'pointerdown', (event) => {
    if (panel.hidden) return;
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(button)) close();
  });

  return { button, panel, isOpen: () => !panel.hidden, close };
}
