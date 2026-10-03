import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSiteAdapter, findPlayerCaptions, PLAYER_CAPTIONS } from '../../src/content/adapters.js';
import { generateSubtitleStyles } from '../../src/content/styles.js';
import { withDefaults } from '../../src/shared/settings.js';

test('Hotstar is JioHotstar now, on both of its domains', () => {
  for (const host of ['www.hotstar.com', 'www.jiohotstar.com']) {
    const adapter = getSiteAdapter(host, '/in/shows/x/123/watch');
    assert.equal(adapter.label, 'JioHotstar', host);
    assert.equal(adapter.subtitleSelector, '.shaka-text-container', host);
  }
});

test('Disney+ is not called Hotstar', () => {
  assert.equal(getSiteAdapter('www.disneyplus.com', '/play/abc').label, 'Disney+');
});

test('Prime Video is recognised on primevideo.com and on Amazon\'s video pages', () => {
  assert.equal(getSiteAdapter('www.primevideo.com', '/detail/0ABC').label, 'Prime Video');
  assert.equal(getSiteAdapter('www.amazon.com', '/gp/video/detail/B0ABC').label, 'Prime Video');
  assert.equal(getSiteAdapter('www.amazon.in', '/-/hi/gp/video/detail/B0ABC').label, 'Prime Video');
});

test('an Amazon shopping page with a product video is not Prime Video', () => {
  assert.equal(getSiteAdapter('www.amazon.com', '/dp/B0ABC').name, 'generic');
  assert.equal(getSiteAdapter('www.amazon.com').name, 'generic');
});

test('sites without an adapter use the generic one', () => {
  assert.deepEqual(getSiteAdapter('example.com', '/watch'), { name: 'generic' });
});

test('every site caption element takes the user\'s caption style', () => {
  const css = generateSubtitleStyles(withDefaults({ fontSize: 22, textColor: '#ffe14d' }));
  for (const host of ['www.youtube.com', 'www.netflix.com', 'www.hotstar.com', 'www.primevideo.com']) {
    const { subtitleSelector } = getSiteAdapter(host, '/');
    // YouTube and Netflix are styled through the elements inside their container
    const styled = { '#ytp-caption-window-container': '.ytp-caption-window-container', '.player-timedtext': '.player-timedtext-text-container' }[subtitleSelector] || subtitleSelector;
    const rule = new RegExp(`${styled.replace(/[.#-]/g, '\\$&')}[^{]*\\{[^}]*font-size: 22px[^}]*color: #ffe14d`);
    assert.match(css, rule, host);
  }
});

// ---- Players many sites embed ----

const pageWith = (...selectors) => ({ querySelector: (selector) => (selectors.includes(selector) ? {} : null) });

test('the common web players are recognised by their caption element', () => {
  assert.deepEqual(PLAYER_CAPTIONS.map((player) => player.name), ['Video.js', 'JW Player', 'Plyr', 'Bitmovin', 'Shaka Player']);
  assert.equal(findPlayerCaptions(pageWith('.jw-captions')).name, 'JW Player');
  assert.equal(findPlayerCaptions(pageWith('.vjs-text-track-display')).selector, '.vjs-text-track-display');
  assert.equal(findPlayerCaptions(pageWith('.something-else')), null);
});
