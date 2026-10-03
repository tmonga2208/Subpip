import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knownSiteAction } from '../../src/content/site-actions.js';

const idOf = (name) => knownSiteAction(name)?.id ?? null;

test('skip and next buttons are recognised by what they say', () => {
  assert.equal(idOf('Skip Intro'), 'skip-intro');
  assert.equal(idOf('SKIP INTRO'), 'skip-intro');
  assert.equal(idOf('Skip opening'), 'skip-intro');
  assert.equal(idOf('Skip Recap'), 'skip-recap');
  assert.equal(idOf('Skip credits'), 'skip-credits');
  assert.equal(idOf('Next Episode'), 'next-episode');
  assert.equal(idOf('Play next episode'), 'next-episode');
  assert.equal(knownSiteAction('Skip Intro').label, 'Skip intro');
});

test('anything else is not', () => {
  for (const name of ['Skip to main content', 'Skip', 'Skip Ad', 'Skip Ads', 'Next', 'Skip intro and watch credits later maybe', 'Episodes', '']) {
    assert.equal(idOf(name), null, name);
  }
});
