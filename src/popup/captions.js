// Caption style in the popup: live previews, preset chips and the Custom page

import { applyCaptionPreset } from '../shared/settings.js';
import { captionTextShadow, hexToRgba } from '../content/styles.js';

export const TEXT_COLORS = ['#ffffff', '#ffe14d', '#7cf0ff', '#9dff7a', '#ff9ad5', '#000000'];
export const BG_COLORS = ['#000000', '#1f2937', '#1e3a8a', '#3f1d5c', '#5c1d1d', '#ffffff'];

export function captionStyle(settings) {
  return {
    fontSize: `${settings.fontSize}px`,
    fontFamily: settings.fontFamily,
    color: settings.textColor,
    background: hexToRgba(settings.bgColor, settings.bgOpacity),
    textShadow: captionTextShadow(settings)
  };
}

export function initCaptions({ doc, store, router, auth }) {
  const $ = (id) => doc.getElementById(id);
  const previews = [$('home-preview'), $('custom-preview')];
  const chips = [...doc.querySelectorAll('.chip[data-preset]')];
  const positionButtons = [...doc.querySelectorAll('[data-position]')];
  const size = $('size');
  const opacity = $('opacity');
  const font = $('font');
  const outline = $('outline');
  const subsUrl = $('subs-url');

  // Any caption-style edit makes the look "custom"
  const custom = (patch, options) => store.update({ ...patch, captionPreset: 'custom' }, options);

  chips.forEach((chip) => chip.addEventListener('click', () => {
    const name = chip.dataset.preset;
    if (name === 'custom') router.go('custom');
    else store.update(applyCaptionPreset(store.get(), name));
  }));

  function buildSwatches(container, colors, key) {
    for (const color of colors) {
      const swatch = doc.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-label', color);
      swatch.addEventListener('click', () => custom({ [key]: color }));
      container.append(swatch);
    }
    const picker = doc.createElement('input');
    picker.type = 'color';
    picker.className = 'swatch-custom';
    picker.setAttribute('aria-label', 'Custom color');
    picker.title = 'Custom color';
    picker.addEventListener('input', () => custom({ [key]: picker.value }, { debounce: true }));
    container.append(picker);
  }
  buildSwatches($('text-swatches'), TEXT_COLORS, 'textColor');
  buildSwatches($('bg-swatches'), BG_COLORS, 'bgColor');

  size.addEventListener('input', () => custom({ fontSize: Number(size.value) }, { debounce: true }));
  opacity.addEventListener('input', () => custom({ bgOpacity: Number(opacity.value) }, { debounce: true }));
  font.addEventListener('change', () => custom({ fontFamily: font.value }));
  outline.addEventListener('change', () => custom({ captionOutline: outline.checked }));
  // Position is not part of a preset, so it doesn't switch to custom
  positionButtons.forEach((button) => button.addEventListener('click', () => store.update({ captionPosition: button.dataset.position })));
  subsUrl.addEventListener('input', () => store.update({ externalSubtitleUrl: subsUrl.value.trim() }, { debounce: true }));

  function render(settings) {
    for (const preview of previews) {
      Object.assign(preview.querySelector('.preview-caption').style, captionStyle(settings));
      preview.dataset.position = settings.captionPosition;
    }
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.preset === settings.captionPreset)));
    size.value = settings.fontSize;
    $('size-out').textContent = `${settings.fontSize}px`;
    opacity.value = settings.bgOpacity;
    $('opacity-out').textContent = `${settings.bgOpacity}%`;
    font.value = settings.fontFamily;
    outline.checked = !!settings.captionOutline;
    positionButtons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.position === settings.captionPosition)));
    for (const [id, key] of [['text-swatches', 'textColor'], ['bg-swatches', 'bgColor']]) {
      $(id).querySelectorAll('.swatch').forEach((swatch) => swatch.setAttribute('aria-checked', String(swatch.dataset.color === settings[key])));
      $(id).querySelector('.swatch-custom').value = settings[key];
    }
    if (doc.activeElement !== subsUrl) subsUrl.value = settings.externalSubtitleUrl || '';
  }

  function renderPremium() {
    const premium = auth.isPremium();
    subsUrl.disabled = !premium;
    $('subs-tag').hidden = premium;
  }

  store.subscribe(render);
  auth.onChange(renderPremium);
  render(store.get());
  renderPremium();
}
