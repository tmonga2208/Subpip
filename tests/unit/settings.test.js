import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, withDefaults, CAPTION_PRESETS, detectCaptionPreset,
  applyCaptionPreset, CAPTION_SIZES, LANGUAGES
} from '../../src/shared/settings.js';

test('presets match the spec exactly', () => {
  assert.deepEqual(CAPTION_PRESETS.classic, { fontSize: 18, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false });
  assert.deepEqual(CAPTION_PRESETS.large, { fontSize: 26, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false });
  assert.deepEqual(CAPTION_PRESETS.outline, { fontSize: 20, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0, captionOutline: true });
});

test('defaults are the classic preset', () => {
  assert.equal(DEFAULT_SETTINGS.captionPreset, 'classic');
  assert.equal(DEFAULT_SETTINGS.captionOutline, false);
  assert.equal(detectCaptionPreset(DEFAULT_SETTINGS), 'classic');
});

test('existing users keep their look: non-preset values become custom', () => {
  const stored = { fontSize: 22, textColor: '#ffff00', bgColor: '#000000', bgOpacity: 50 };
  assert.equal(withDefaults(stored).captionPreset, 'custom');
  assert.equal(withDefaults(stored).fontSize, 22);
});

test('stored values that equal a preset are detected as that preset', () => {
  assert.equal(withDefaults({ fontSize: 26 }).captionPreset, 'large');
});

test('an explicit stored preset is kept', () => {
  assert.equal(withDefaults({ captionPreset: 'custom', fontSize: 18 }).captionPreset, 'custom');
});

test('applyCaptionPreset returns a new object with the preset values', () => {
  const before = withDefaults({ fontSize: 30 });
  const after = applyCaptionPreset(before, 'outline');
  assert.notEqual(after, before);
  assert.equal(before.fontSize, 30);
  assert.equal(after.captionPreset, 'outline');
  assert.equal(after.bgOpacity, 0);
  assert.equal(after.captionOutline, true);
});

test('caption sizes and languages', () => {
  assert.deepEqual(CAPTION_SIZES, [{ label: 'S', px: 14 }, { label: 'M', px: 18 }, { label: 'L', px: 24 }, { label: 'XL', px: 32 }]);
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'hi', 'ar', 'ru']);
});
