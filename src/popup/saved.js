// Saved lines: what the viewer kept from the study tools in the PiP window
// (Premium). Listed newest first, exported as CSV, cleared from here.

import { readSavedLines, clearSavedLines, savedLinesCsv, SAVED_LINES } from '../shared/saved-lines.js';

export function initSaved({ doc, auth }) {
  const $ = (id) => doc.getElementById(id);
  const make = (tag, cls, text) => {
    const node = doc.createElement(tag);
    node.className = cls;
    node.textContent = text;
    return node;
  };
  let lines = [];

  function render() {
    const value = $('saved-value');
    if (auth.isPremium()) {
      value.textContent = String(lines.length);
    } else {
      value.replaceChildren(make('span', 'tag', 'Premium'));
    }
    $('saved-empty').hidden = lines.length > 0;
    $('saved-export').disabled = lines.length === 0;
    $('saved-clear').hidden = lines.length === 0;
    $('saved-list').replaceChildren(...lines.map((line) => {
      const item = make('div', 'saved-item', '');
      item.append(make('div', 'saved-text', line.text), make('div', 'saved-translation', line.translation || ''));
      if (line.word) item.append(make('div', 'saved-word', line.meaning ? `${line.word}: ${line.meaning}` : line.word));
      if (line.title) item.append(make('div', 'saved-source', line.title));
      return item;
    }));
  }

  async function load() {
    lines = await readSavedLines();
    render();
  }

  // The byte-order mark has spreadsheet apps read the file as UTF-8
  $('saved-export').addEventListener('click', () => {
    const link = doc.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${savedLinesCsv(lines)}`], { type: 'text/csv;charset=utf-8' }));
    link.download = 'subpip-lines.csv';
    link.click();
  });
  $('saved-clear').addEventListener('click', async () => {
    await clearSavedLines();
    await load();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SAVED_LINES]) load();
  });
  auth.onChange(render);
  return { load };
}
