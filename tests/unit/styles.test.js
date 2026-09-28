import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSubtitleStyles } from '../../src/content/styles.js';
import { withDefaults } from '../../src/shared/settings.js';

test('outline off uses the soft glow', () => {
  const css = generateSubtitleStyles(withDefaults());
  assert.match(css, /text-shadow: 0 0 3px black, 0 0 5px black/);
});

test('outline on uses a hard four-way outline', () => {
  const css = generateSubtitleStyles(withDefaults({ captionOutline: true }));
  assert.match(css, /text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000/);
  assert.doesNotMatch(css, /0 0 3px black/);
});

test('bottom captions shift with --subpip-caption-shift', () => {
  const css = generateSubtitleStyles(withDefaults({ captionPosition: 'bottom' }));
  assert.match(css, /translate: 0 calc\(-1 \* var\(--subpip-caption-shift, 0px\)\)/);
});

test('top captions do not shift', () => {
  const css = generateSubtitleStyles(withDefaults({ captionPosition: 'top' }));
  assert.doesNotMatch(css, /--subpip-caption-shift/);
});
