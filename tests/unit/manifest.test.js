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

test('the extension may call the SubPIP API on Vercel, not Cloud Functions', () => {
  assert.ok(manifest.host_permissions.includes('https://subpip.vercel.app/*'));
  assert.ok(!manifest.host_permissions.some((host) => host.includes('cloudfunctions.net')));
});

test('Alt+P toggles Picture-in-Picture; the popup has its own shortcut', () => {
  const { 'toggle-pip': toggle, _execute_action: popup } = manifest.commands;
  assert.equal(toggle.suggested_key.default, 'Alt+P');
  assert.ok(toggle.description);
  // Two commands on one key: Chrome would bind only one of them
  assert.notEqual(popup.suggested_key.default, 'Alt+P');
  assert.equal(Object.values(popup.suggested_key).includes('Alt+P'), false);
});
