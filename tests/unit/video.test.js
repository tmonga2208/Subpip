import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipWindowSize } from '../../src/content/video.js';

// The request never depends on how big the player is on the page: Chrome
// only reuses the size the user chose while the same size keeps being asked for
test('a 16:9 video asks for a 640x360 window whatever its on-page size', () => {
  assert.deepEqual(pipWindowSize({ videoWidth: 1920, videoHeight: 1080, clientWidth: 1280, clientHeight: 720 }), { width: 640, height: 360 });
  assert.deepEqual(pipWindowSize({ videoWidth: 1920, videoHeight: 1080, clientWidth: 426, clientHeight: 240 }), { width: 640, height: 360 });
});

test('the window follows the shape of the video', () => {
  assert.deepEqual(pipWindowSize({ videoWidth: 640, videoHeight: 480, clientWidth: 777, clientHeight: 583 }), { width: 640, height: 480 });
  assert.deepEqual(pipWindowSize({ videoWidth: 2560, videoHeight: 1072, clientWidth: 1280, clientHeight: 536 }), { width: 640, height: 268 });
});

test('a vertical video gets a tall window, 640 on its long side', () => {
  assert.deepEqual(pipWindowSize({ videoWidth: 1080, videoHeight: 1920, clientWidth: 315, clientHeight: 560 }), { width: 360, height: 640 });
});

test('before the video knows its own size, the player shape is used', () => {
  assert.deepEqual(pipWindowSize({ videoWidth: 0, videoHeight: 0, clientWidth: 800, clientHeight: 600 }), { width: 640, height: 480 });
});

test('with nothing to go on it asks for 640x360', () => {
  assert.deepEqual(pipWindowSize({ videoWidth: 0, videoHeight: 0, clientWidth: 0, clientHeight: 0 }), { width: 640, height: 360 });
});
