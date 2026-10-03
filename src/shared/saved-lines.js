// Caption lines a viewer saved from the study tools (Premium). They stay on
// this computer (local storage) until exported or cleared in the popup.

export const SAVED_LINES = 'subpipSavedLines';
export const MAX_SAVED_LINES = 500;

const short = (value, length) => (typeof value === 'string' ? value.trim().slice(0, length) : '');

export async function readSavedLines() {
  return (await chrome.storage.local.get([SAVED_LINES]))[SAVED_LINES] || [];
}

// Newest first. Takes only what a line is made of, cut to sensible lengths:
// the request comes from a web page (through the relay).
export async function saveLine(entry) {
  const line = {
    text: short(entry.text, 500),
    translation: short(entry.translation, 500),
    word: short(entry.word, 80),
    meaning: short(entry.meaning, 200),
    title: short(entry.title, 200),
    url: short(entry.url, 500),
    savedAt: Date.now()
  };
  if (!line.text) return;
  const lines = [line, ...await readSavedLines()].slice(0, MAX_SAVED_LINES);
  await chrome.storage.local.set({ [SAVED_LINES]: lines });
}

export function clearSavedLines() {
  return chrome.storage.local.remove([SAVED_LINES]);
}

const cell = (value) => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// For a spreadsheet or a flashcard app
export function savedLinesCsv(lines) {
  const rows = lines.map((line) => [
    line.text, line.translation, line.word, line.meaning, line.title, line.url,
    line.savedAt ? new Date(line.savedAt).toISOString().slice(0, 10) : ''
  ]);
  return [['Line', 'Translation', 'Word', 'Meaning', 'Title', 'Page', 'Saved'], ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
