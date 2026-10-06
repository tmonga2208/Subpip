// Home option rows and their pages: Translate, Playback speed, Auto PiP.
// Premium rows send free users to the upgrade page instead.

import { LANGUAGES, SPEEDS, ALL_SITES, siteKey, sitePattern, isSiteName } from '../shared/settings.js';
import { iconMarkup } from '../shared/icons.js';
import { getTargetTab } from './status.js';

export function initOptions({ doc, store, auth, router }) {
  const $ = (id) => doc.getElementById(id);
  const languageName = (code) => (LANGUAGES.find((lang) => lang.code === code) || { name: code }).name;
  let autoPipAllowed = false;
  // The single sites Auto PiP is chosen for that this browser has access to,
  // and the site in the current tab (null on a page that is not a site)
  let allowedSites = [];
  let site = null;
  const chosenSites = () => (store.get().autoPipSites || []).filter(isSiteName);
  const access = (name) => ({ origins: [sitePattern(name)] });

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

  // Chrome can translate on the device once it has the language pack: have
  // the background fetch it now rather than during the first video
  const prepareTranslation = (targetLang) => {
    Promise.resolve(chrome.runtime.sendMessage({ type: 'PREPARE_TRANSLATION', targetLang })).catch(() => {});
  };

  radioList($('language-list'), LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name })),
    (code) => {
      store.update({ targetLanguage: code, translationEnabled: true });
      prepareTranslation(code);
    });
  radioList($('speed-list'), SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` })),
    (speed) => store.update({ playbackSpeed: speed }));
  $('translate-on').addEventListener('change', () => {
    store.update({ translationEnabled: $('translate-on').checked });
    if ($('translate-on').checked) prepareTranslation(store.get().targetLanguage);
  });
  $('dual-on').addEventListener('change', () => store.update({ dualSubtitles: $('dual-on').checked }));

  // Auto PiP needs SubPIP on every site: ask for that access only when it is
  // turned on (the request must happen inside this click)
  $('autopip-on').addEventListener('change', async () => {
    const error = $('autopip-error');
    error.hidden = true;
    if ($('autopip-on').checked) {
      // Save the choice first: the popup can re-render (or close) while
      // Chrome's prompt is open. The background only registers the scripts
      // once the permission is actually granted.
      store.update({ autoPip: true });
      autoPipAllowed = await chrome.permissions.request(ALL_SITES);
      if (!autoPipAllowed) {
        store.update({ autoPip: false });
        error.textContent = 'SubPIP needs access to all sites for Auto PiP.';
        error.hidden = false;
      }
      render();
    } else {
      await chrome.permissions.remove(ALL_SITES);
      autoPipAllowed = false;
      store.update({ autoPip: false });
      await findAccess();
    }
  });

  // ...or on single sites: then Chrome is asked for that site alone
  async function setSite(name, on) {
    const error = $('autopip-error');
    error.hidden = true;
    const without = chosenSites().filter((chosen) => chosen !== name);
    if (on) {
      store.update({ autoPipSites: [...without, name] });
      if (!await chrome.permissions.request(access(name))) {
        store.update({ autoPipSites: without });
        error.textContent = `SubPIP needs access to ${name} for Auto PiP there.`;
        error.hidden = false;
      }
    } else {
      store.update({ autoPipSites: without });
      // Access held through "every site" is not this site's to give back
      if (!autoPipAllowed) await chrome.permissions.remove(access(name)).catch(() => {});
    }
    await findAccess();
  }
  $('autopip-site-on').addEventListener('change', () => setSite(site, $('autopip-site-on').checked));

  // What this browser has granted, for the switches to show
  async function findAccess() {
    autoPipAllowed = await chrome.permissions.contains(ALL_SITES);
    const granted = [];
    for (const name of chosenSites()) {
      if (await chrome.permissions.contains(access(name))) granted.push(name);
    }
    allowedSites = granted;
    render();
  }

  function render() {
    const settings = store.get();
    const premium = auth.isPremium();
    const autoPip = !!settings.autoPip && autoPipAllowed;
    const sites = chosenSites().filter((name) => allowedSites.includes(name));
    // Offered on the first page to whoever does not have it
    $('premium-row').hidden = premium;
    setRowValue('translate-value', premium ? (settings.translationEnabled ? languageName(settings.targetLanguage) : 'Off') : null);
    setRowValue('speed-value', premium ? `${settings.playbackSpeed}×` : null);
    setRowValue('autopip-value', autoPip ? 'On' : sites.length === 1 ? sites[0] : sites.length ? `${sites.length} sites` : 'Off');
    setRowValue('account-value', auth.user() ? auth.user().email : 'Sign in');
    $('translate-on').checked = !!settings.translationEnabled;
    $('dual-on').checked = !!settings.dualSubtitles;
    $('language-list').setAttribute('aria-disabled', String(!settings.translationEnabled));
    markChecked($('language-list'), settings.targetLanguage);
    markChecked($('speed-list'), settings.playbackSpeed);
    $('autopip-on').checked = autoPip;
    $('autopip-site-field').hidden = !site;
    $('autopip-site').textContent = site || '';
    $('autopip-site-on').checked = !!site && sites.includes(site);
    $('autopip-sites').hidden = sites.length === 0;
    $('autopip-site-list').replaceChildren(...sites.map((name) => {
      const row = doc.createElement('div');
      row.className = 'row';
      const label = doc.createElement('span');
      label.className = 'row-label';
      label.textContent = name;
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => setSite(name, false));
      row.append(label, remove);
      return row;
    }));
  }

  // The settings arrive after the popup has opened, with the chosen sites in them
  let sitesSeen = '';
  store.subscribe(() => {
    render();
    const now = chosenSites().join(' ');
    if (now === sitesSeen) return;
    sitesSeen = now;
    findAccess();
  });
  auth.onChange(render);
  findAccess();
  getTargetTab().then((tab) => {
    try {
      const url = new URL(tab.url);
      if (/^https?:$/.test(url.protocol) && isSiteName(siteKey(url.hostname))) site = siteKey(url.hostname);
    } catch (e) {
      // No tab, or a page without an address SubPIP may see
    }
    render();
  });
  render();
}
