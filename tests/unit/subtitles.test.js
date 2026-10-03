import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVTTOrSRT, cueText, cueAt, decodeSubtitleFile } from '../../src/content/subtitles.js';

const srt = (...blocks) => blocks.map((block, i) => `${i + 1}\n${block}`).join('\n\n');

test('parses SRT cues with their times and text', () => {
  const cues = parseVTTOrSRT(srt('00:00:01,000 --> 00:00:02,500\nHello', '00:01:05,250 --> 00:01:07,000\nTwo\nlines'));
  assert.deepEqual(cues, [
    { start: 1, end: 2.5, text: 'Hello' },
    { start: 65.25, end: 67, text: 'Two\nlines' }
  ]);
});

test('parses WebVTT: header, notes, short timestamps and cue settings', () => {
  const vtt = 'WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 line:90% position:50%\nShort form\n\n01:00:00.000 --> 01:00:01.000\nAn hour in\n';
  assert.deepEqual(parseVTTOrSRT(vtt), [
    { start: 1, end: 2, text: 'Short form' },
    { start: 3600, end: 3601, text: 'An hour in' }
  ]);
});

test('formatting tags are removed, not shown', () => {
  const cues = parseVTTOrSRT(srt(
    '00:00:01,000 --> 00:00:02,000\n<i>Hello</i> <b>there</b>',
    '00:00:03,000 --> 00:00:04,000\n<font color="#ffff00">Yellow</font>',
    '00:00:05,000 --> 00:00:06,000\n<v Roger>Hi</v> <c.loud>WOW</c>',
    '00:00:07,000 --> 00:00:08,000\nOne <00:00:07.500>word <00:00:07.900>at a time',
    '00:00:09,000 --> 00:00:10,000\n{\\an8}Top of the screen{\\i1}!'
  ));
  assert.deepEqual(cues.map((cue) => cue.text), ['Hello there', 'Yellow', 'Hi WOW', 'One word at a time', 'Top of the screen!']);
});

test('text that only looks like a tag is kept', () => {
  const [cue] = parseVTTOrSRT(srt('00:00:01,000 --> 00:00:02,000\n2 < 3 and 4 > 1'));
  assert.equal(cue.text, '2 < 3 and 4 > 1');
});

test('character references are decoded', () => {
  const [cue] = parseVTTOrSRT(srt('00:00:01,000 --> 00:00:02,000\nTom &amp; Jerry &lt;3&nbsp;you &#39;now&#39;'));
  assert.equal(cue.text, "Tom & Jerry <3 you 'now'");
});

test('hours may have one digit or more than two', () => {
  const cues = parseVTTOrSRT(srt('0:00:03,000 --> 0:00:04,000\nsingle', '100:00:05.000 --> 100:00:06.000\ntriple'));
  assert.deepEqual(cues, [
    { start: 3, end: 4, text: 'single' },
    { start: 360005, end: 360006, text: 'triple' }
  ]);
});

test('a cue with an unreadable time is dropped instead of starting at zero', () => {
  const cues = parseVTTOrSRT(srt('soon --> 00:00:05,000\nbroken', '00:00:06,000 --> 00:00:07,000\nfine'));
  assert.deepEqual(cues.map((cue) => cue.text), ['fine']);
});

test('a cue left empty once its tags are gone is dropped', () => {
  assert.deepEqual(parseVTTOrSRT(srt('00:00:01,000 --> 00:00:02,000\n{\\an8}<i></i>')), []);
});

test('Windows line endings and a byte-order mark are handled', () => {
  const cues = parseVTTOrSRT('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n');
  assert.deepEqual(cues, [{ start: 1, end: 2, text: 'Hello' }]);
});

test('text-track cues are cleaned the same way', () => {
  const track = { activeCues: [{ text: '<v Roger>Tom &amp; Jerry</v>' }, { text: '<i>second</i>' }] };
  assert.equal(cueText(track), 'Tom & Jerry\nsecond');
});

test('cueAt finds the line on screen at a given time', () => {
  const cues = [{ start: 1, end: 2, text: 'one' }, { start: 2.5, end: 4, text: 'two' }];
  assert.equal(cueAt(cues, 0.99), '');
  assert.equal(cueAt(cues, 1), 'one');
  assert.equal(cueAt(cues, 2), 'one');
  assert.equal(cueAt(cues, 2.2), '');
  assert.equal(cueAt(cues, 3), 'two');
  assert.equal(cueAt(cues, 9), '');
});

const bytes = (...values) => new Uint8Array(values).buffer;

test('subtitle files in UTF-8 are read as UTF-8', () => {
  assert.equal(decodeSubtitleFile(new TextEncoder().encode('café ¿qué? 日本語').buffer), 'café ¿qué? 日本語');
  // with a byte-order mark, which must not end up in the text
  assert.equal(decodeSubtitleFile(bytes(0xEF, 0xBB, 0xBF, 0x68, 0x69)), 'hi');
});

test('older files that are not valid UTF-8 are read as Windows-1252', () => {
  // "café" saved by a Windows editor: é is the single byte 0xE9
  assert.equal(decodeSubtitleFile(bytes(0x63, 0x61, 0x66, 0xE9)), 'café');
});

test('UTF-16 files are recognised by their byte-order mark', () => {
  assert.equal(decodeSubtitleFile(bytes(0xFF, 0xFE, 0x68, 0x00, 0xE9, 0x00)), 'hé');
  assert.equal(decodeSubtitleFile(bytes(0xFE, 0xFF, 0x00, 0x68, 0x00, 0xE9)), 'hé');
});
