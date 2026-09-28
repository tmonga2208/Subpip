import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, iconMarkup, createIcon } from '../../src/shared/icons.js';

const REQUIRED = ['play', 'pause', 'back10', 'forward10', 'volume', 'volume-muted', 'cc', 'cc-off', 'gear',
  'check', 'chevron-right', 'chevron-left', 'lock', 'fill', 'close', 'spinner'];

test('has every icon the spec lists', () => {
  for (const name of REQUIRED) assert.ok(ICON_NAMES.includes(name), `missing ${name}`);
});

test('iconMarkup produces a 24x24 hidden svg', () => {
  const svg = iconMarkup('play');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  assert.match(svg, /<path /);
});

test('createIcon builds elements through createElementNS', () => {
  const made = [];
  const fakeDoc = {
    createElementNS(ns, tag) {
      const node = { ns, tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(child) { this.children.push(child); } };
      made.push(node);
      return node;
    }
  };
  const svg = createIcon(fakeDoc, 'cc');
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attrs.viewBox, '0 0 24 24');
  assert.equal(svg.children.length, 2);
  assert.ok(made.every((node) => node.ns === 'http://www.w3.org/2000/svg'));
});

test('unknown icon names throw', () => {
  assert.throws(() => iconMarkup('nope'), /Unknown icon/);
});
