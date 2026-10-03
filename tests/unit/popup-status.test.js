import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus } from '../../src/popup/status.js';

test('status copy matches the spec', () => {
  assert.deepEqual(describeStatus({ state: 'video', host: 'youtube.com', captionSource: 'YouTube' }),
    { title: 'Video found on youtube.com', sub: 'Captions: YouTube' });
  assert.deepEqual(describeStatus({ state: 'video', host: 'example.com', captionSource: null }),
    { title: 'Video found on example.com', sub: 'No captions detected' });
  assert.deepEqual(describeStatus({ state: 'pip', host: 'netflix.com' }),
    { title: 'Playing in Picture-in-Picture', sub: 'on netflix.com' });
  assert.deepEqual(describeStatus({ state: 'none' }),
    { title: 'No video on this page', sub: 'Play a video, then open SubPIP' });
  assert.deepEqual(describeStatus({ state: 'restricted' }),
    { title: "SubPIP can't run on this page", sub: 'Chrome pages and the Web Store are off-limits' });
  assert.deepEqual(describeStatus({ state: 'loading' }), { title: 'Checking this page…', sub: '' });
  assert.deepEqual(describeStatus({ state: 'embedded', host: 'blog.example' }),
    { title: 'This video is in an embedded player', sub: 'Open the player in its own tab to use SubPIP' });
});
