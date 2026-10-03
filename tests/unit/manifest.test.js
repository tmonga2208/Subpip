import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));

// PNG width/height live at bytes 16-23 of the IHDR chunk
function pngSize(file) {
  const buf = readFileSync(`src/${file}`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('icons exist at the declared sizes', () => {
  for (const group of [manifest.icons, manifest.action.default_icon]) {
    assert.deepEqual(Object.keys(group), ['16', '32', '48', '128']);
    for (const [size, file] of Object.entries(group)) {
      assert.deepEqual(pngSize(file), [Number(size), Number(size)], file);
    }
  }
});

test('installing asks for access to no site at all', () => {
  // Every service SubPIP calls (its API, Firebase, MyMemory) answers cross-origin
  // requests, so none needs host access - and each one listed here would add
  // "read and change your data on..." to the install prompt
  assert.deepEqual(manifest.host_permissions || [], []);
  // All-sites access stays opt-in, for Auto PiP only
  assert.deepEqual(manifest.optional_host_permissions, ['<all_urls>']);
});

test('Alt+P toggles Picture-in-Picture; the popup has its own shortcut', () => {
  const { 'toggle-pip': toggle, _execute_action: popup } = manifest.commands;
  assert.equal(toggle.suggested_key.default, 'Alt+P');
  assert.ok(toggle.description);
  // Two commands on one key: Chrome would bind only one of them
  assert.notEqual(popup.suggested_key.default, 'Alt+P');
  assert.equal(Object.values(popup.suggested_key).includes('Alt+P'), false);
});
