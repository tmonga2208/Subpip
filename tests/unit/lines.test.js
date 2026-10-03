// Caption lines over time, for the study tools: replaying a line, stepping to
// the one before or after, and noting lines as a site shows them
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineAt, lineBefore, lineAfter, createLineLog, wordAt } from '../../src/content/lines.js';

const LINES = [{ start: 0, end: 4, text: 'one' }, { start: 5, end: 9, text: 'two' }, { start: 9, end: 12, text: 'three' }];

test('the line to replay is the one on screen, or the last one that was', () => {
  assert.equal(lineAt(LINES, 6).text, 'two');
  assert.equal(lineAt(LINES, 5).text, 'two');
  // Between two lines: the one just heard
  assert.equal(lineAt(LINES, 4.5).text, 'one');
  assert.equal(lineAt(LINES, 30).text, 'three');
  assert.equal(lineAt([], 3), null);
  assert.equal(lineAt([{ start: 5, end: 9, text: 'two' }], 1), null);
});

test('previous and next go by line, from wherever the video is', () => {
  assert.equal(lineBefore(LINES, 6).text, 'one');
  assert.equal(lineBefore(LINES, 2), null);
  assert.equal(lineAfter(LINES, 6).text, 'three');
  assert.equal(lineAfter(LINES, 4.5).text, 'two');
  assert.equal(lineAfter(LINES, 10), null);
  // Stepping back twice in a row keeps going back
  assert.equal(lineBefore(LINES, lineBefore(LINES, 10).start).text, 'one');
});

test('a site\'s captions are noted as they appear, with the time they started', () => {
  const log = createLineLog();
  log.note(3, 'hello there');
  log.note(6, '');
  log.note(8, 'second line');
  assert.deepEqual(log.lines, [{ start: 3, end: 6, text: 'hello there' }, { start: 8, text: 'second line' }]);
});

test('a line that grows word by word stays one line', () => {
  const log = createLineLog();
  log.note(1, 'so');
  log.note(1.4, 'so this');
  log.note(1.9, 'so this is');
  log.note(4, 'another one');
  assert.deepEqual(log.lines.map((line) => [line.start, line.text]), [[1, 'so this is'], [4, 'another one']]);
  assert.equal(log.lines[0].end, 4);
});

test('a line seen again on a replay is not noted twice, and lines stay in order', () => {
  const log = createLineLog();
  log.note(10, 'later line');
  log.note(2, 'earlier line');
  log.note(10.4, 'later line');
  log.note(2.2, 'earlier line');
  assert.deepEqual(log.lines.map((line) => line.text), ['earlier line', 'later line']);
});

test('the log keeps only the most recent lines', () => {
  const log = createLineLog(3);
  for (let i = 0; i < 5; i++) log.note(i * 10, `line ${i}`);
  assert.deepEqual(log.lines.map((line) => line.text), ['line 2', 'line 3', 'line 4']);
});

test('the word under a click is found; spaces and punctuation are not words', () => {
  assert.equal(wordAt('Hello, world', 1), 'Hello');
  assert.equal(wordAt('Hello, world', 5), null);
  assert.equal(wordAt('Hello, world', 6), null);
  assert.equal(wordAt('Hello, world', 9), 'world');
  assert.equal(wordAt("I can't stop", 4), "can't");
  assert.equal(wordAt('Hello', 99), null);
  // Languages written without spaces are split into words too
  const japanese = wordAt('今日は天気がいいですね', 0);
  assert.ok(japanese && japanese.length < 6, `got ${japanese}`);
});
