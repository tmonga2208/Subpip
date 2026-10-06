// "My style": the viewer's own caption look, kept apart from the three
// built-in ones so that trying Classic, Large or Outline does not lose it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDefaults, applyCaptionPreset, editMyStyle, applyMyStyle } from '../../src/shared/settings.js';

const MINE = { fontSize: 30, fontFamily: 'serif', textColor: '#ffe14d', bgColor: '#1e3a8a', bgOpacity: 40, captionOutline: true };

test('an edit to the look is kept as My style, whole', () => {
  const edited = editMyStyle(withDefaults(), { fontSize: 30 });
  assert.equal(edited.captionPreset, 'custom');
  assert.equal(edited.fontSize, 30);
  assert.deepEqual(edited.myStyle, { fontSize: 30, fontFamily: 'sans-serif', textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false });
});

test('a built-in look does not lose My style, which comes back as it was', () => {
  const mine = withDefaults({ ...MINE, captionPreset: 'custom', myStyle: MINE });
  const classic = applyCaptionPreset(mine, 'classic');
  assert.equal(classic.fontSize, 18);
  assert.deepEqual(classic.myStyle, MINE);
  const back = applyMyStyle(classic);
  assert.equal(back.captionPreset, 'custom');
  for (const [key, value] of Object.entries(MINE)) assert.equal(back[key], value, key);
});

test('a custom look saved before My style existed becomes My style', () => {
  assert.deepEqual(withDefaults({ ...MINE, captionPreset: 'custom' }).myStyle, MINE);
  assert.equal(withDefaults({ captionPreset: 'large', fontSize: 26 }).myStyle, undefined);
});
