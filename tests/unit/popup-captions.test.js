import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionStyle, TEXT_COLORS, BG_COLORS } from '../../src/popup/captions.js';
import { withDefaults, CAPTION_PRESETS } from '../../src/shared/settings.js';

test('preview style follows the classic preset', () => {
  assert.deepEqual(captionStyle(withDefaults()), {
    fontSize: '18px', fontFamily: 'sans-serif', color: '#ffffff',
    background: 'rgba(0, 0, 0, 0.75)', textShadow: '0 0 3px black, 0 0 5px black'
  });
});

test('preview style uses the outline shadow for the outline preset', () => {
  const style = captionStyle(withDefaults(CAPTION_PRESETS.outline));
  assert.equal(style.background, 'rgba(0, 0, 0, 0)');
  assert.match(style.textShadow, /1px 1px 0 #000/);
});

test('six swatches each', () => {
  assert.equal(TEXT_COLORS.length, 6);
  assert.equal(BG_COLORS.length, 6);
});
