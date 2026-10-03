import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechLines, speechCaption } from '../../src/content/lines.js';
import { LANGUAGES, SPEECH_TAGS } from '../../src/shared/settings.js';

const SAID = 'picture in picture keeps the subtitles on the screen the quick brown fox jumps over the lazy dog and then carries on talking for a while';

test('short speech is one line, tidied', () => {
  assert.deepEqual(speechLines('  hello   there '), ['hello there']);
  assert.deepEqual(speechLines(''), []);
  assert.equal(speechCaption('hello there'), 'hello there');
});

test('running speech is broken into short lines, every word kept', () => {
  const lines = speechLines(SAID);
  assert.ok(lines.length > 2);
  for (const line of lines) assert.ok(line.length <= 42, `"${line}" is ${line.length} long`);
  assert.equal(lines.join(' '), SAID);
});

// Like captions on live television: a line fills up, then moves up for the next
test('lines break in the same places as more is said', () => {
  const sooner = speechLines(SAID.slice(0, 80));
  const later = speechLines(SAID);
  assert.deepEqual(later.slice(0, sooner.length - 1), sooner.slice(0, -1));
});

test('the caption is the latest two lines', () => {
  const lines = speechLines(SAID);
  assert.equal(speechCaption(SAID), lines.slice(-2).join('\n'));
  // Lines taken off the screen after a silence do not come back
  assert.equal(speechCaption(SAID, lines.length - 1), lines[lines.length - 1]);
  assert.equal(speechCaption(SAID, lines.length), '');
});

test('a word longer than a line gets a line to itself', () => {
  const long = 'x'.repeat(60);
  assert.deepEqual(speechLines(`before ${long} after`), ['before', long, 'after']);
});

test('every caption language has a tag for speech recognition', () => {
  for (const { code } of LANGUAGES) assert.match(SPEECH_TAGS[code] || '', /^[a-z]{2,3}(-[A-Za-z]+)+$/, code);
});
