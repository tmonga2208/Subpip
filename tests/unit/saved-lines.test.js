import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveLine, readSavedLines, clearSavedLines, savedLinesCsv, MAX_SAVED_LINES } from '../../src/shared/saved-lines.js';

function useChrome(initial = {}) {
  const data = structuredClone(initial);
  globalThis.chrome = { storage: { local: {
    async get(keys) { return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; }
  } } };
  return data;
}

test('a saved line is kept on this computer, newest first', async () => {
  useChrome();
  await saveLine({ text: 'first', translation: 'primero', title: 'A film', url: 'https://example.com/a' });
  await saveLine({ text: 'second', word: 'second', meaning: 'segundo' });
  const lines = await readSavedLines();
  assert.deepEqual(lines.map((line) => line.text), ['second', 'first']);
  assert.equal(lines[1].title, 'A film');
  assert.ok(lines[0].savedAt > 0);
});

test('only what a line is made of is kept, and nothing oversized', async () => {
  useChrome();
  await saveLine({ text: 'x'.repeat(2000), translation: 5, extra: 'dropped', title: 't'.repeat(900) });
  const [line] = await readSavedLines();
  assert.equal(line.text.length, 500);
  assert.equal(line.translation, '');
  assert.equal('extra' in line, false);
  assert.equal(line.title.length, 200);
  // A line without text is nothing to save
  await saveLine({ text: '   ' });
  assert.equal((await readSavedLines()).length, 1);
});

test('the list stops growing at its limit, dropping the oldest', async () => {
  const data = useChrome({ subpipSavedLines: Array.from({ length: MAX_SAVED_LINES }, (unused, i) => ({ text: `old ${i}` })) });
  await saveLine({ text: 'newest' });
  assert.equal(data.subpipSavedLines.length, MAX_SAVED_LINES);
  assert.equal(data.subpipSavedLines[0].text, 'newest');
  await clearSavedLines();
  assert.deepEqual(await readSavedLines(), []);
});

test('the CSV has a header and quotes what needs quoting', () => {
  const csv = savedLinesCsv([
    { text: 'He said "go", then left', translation: 'Dijo "ve"', word: 'left', meaning: 'se fue', title: 'A film, part 2', url: 'https://example.com/a', savedAt: Date.UTC(2026, 9, 4) },
    { text: 'two\nlines' }
  ]);
  assert.deepEqual(csv.split('\r\n'), [
    'Line,Translation,Word,Meaning,Title,Page,Saved',
    '"He said ""go"", then left","Dijo ""ve""",left,se fue,"A film, part 2",https://example.com/a,2026-10-04',
    '"two\nlines",,,,,,'
  ]);
});
