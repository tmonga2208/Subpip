// Home option rows and their pages: Translate, Playback speed, Auto PiP.
// Premium rows send free users to the upgrade page instead.

import { LANGUAGES, SPEEDS, ALL_SITES } from '../shared/settings.js';
import { iconMarkup } from '../shared/icons.js';

export function initOptions({ doc, store, auth, router }) {
  const $ = (id) => doc.getElementById(id);
  const languageName = (code) => (LANGUAGES.find((lang) => lang.code === code) || { name: code }).name;
  let autoPipAllowed = false;

  doc.querySelectorAll('.row[data-go]').forEach((row) => row.addEventListener('click', () => {
    router.go(row.hasAttribute('data-premium') && !auth.isPremium() ? 'upgrade' : row.dataset.go);
  }));

  function setRowValue(id, text) {
    const cell = $(id);
    if (text === null) {
      const tag = doc.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Premium';
      cell.replaceChildren(tag);
    } else {
      cell.textContent = text;
    }
  }

  function radioList(container, items, onPick) {
    container.replaceChildren(...items.map(({ value, label }) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'radio';
      button.setAttribute('role', 'radio');
      button.dataset.value = String(value);
      const text = doc.createElement('span');
      text.textContent = label;
      const check = doc.createElement('span');
      check.className = 'icon';
      check.innerHTML = iconMarkup('check');
      button.append(text, check);
      button.addEventListener('click', () => onPick(value));
      return button;
    }));
  }
  const markChecked = (container, value) => container.querySelectorAll('.radio')
    .forEach((button) => button.setAttribute('aria-checked', String(button.dataset.value === String(value))));

  radioList($('language-list'), LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name })),
    (code) => store.update({ targetLanguage: code, translationEnabled: true }));
  radioList($('speed-list'), SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` })),
    (speed) => store.update({ playbackSpeed: speed }));
  $('translate-on').addEventListener('change', () => store.update({ translationEnabled: $('translate-on').checked }));

  // Auto PiP needs SubPIP on every site: ask for that access only when it is
  // turned on (the request must happen inside this click)
  $('autopip-on').addEventListener('change', async () => {
    const toggle = $('autopip-on');
    const error = $('autopip-error');
    error.hidden = true;
    if (toggle.checked) {
      autoPipAllowed = await chrome.permissions.request(ALL_SITES);
      if (!autoPipAllowed) {
        toggle.checked = false;
        error.textContent = 'SubPIP needs access to all sites for Auto PiP.';
        error.hidden = false;
        return;
      }
    } else {
      await chrome.permissions.remove(ALL_SITES);
      autoPipAllowed = false;
    }
    store.update({ autoPip: toggle.checked });
  });

  function render() {
    const settings = store.get();
    const premium = auth.isPremium();
    const autoPip = !!settings.autoPip && autoPipAllowed;
    setRowValue('translate-value', premium ? (settings.translationEnabled ? languageName(settings.targetLanguage) : 'Off') : null);
    setRowValue('speed-value', premium ? `${settings.playbackSpeed}×` : null);
    setRowValue('autopip-value', autoPip ? 'On' : 'Off');
    setRowValue('account-value', auth.user() ? auth.user().email : 'Sign in');
    $('translate-on').checked = !!settings.translationEnabled;
    $('language-list').setAttribute('aria-disabled', String(!settings.translationEnabled));
    markChecked($('language-list'), settings.targetLanguage);
    markChecked($('speed-list'), settings.playbackSpeed);
    $('autopip-on').checked = autoPip;
  }

  store.subscribe(render);
  auth.onChange(render);
  chrome.permissions.contains(ALL_SITES).then((allowed) => {
    autoPipAllowed = allowed;
    render();
  });
  render();
}
