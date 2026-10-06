// The same package goes to the Chrome Web Store and to Edge Add-ons. What
// differs by browser: where a rating is asked for, and which store pages
// cannot be scripted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeFor } from '../../src/shared/store.js';
import { isRestricted } from '../../src/popup/status.js';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/154.0.0.0`;

test('in Chrome a rating is asked for on the Chrome Web Store', () => {
  assert.deepEqual(storeFor(CHROME), { name: 'Chrome Web Store', reviewsUrl: 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg/reviews' });
});

test('in Edge nobody is sent to Chrome\'s store: no rating is asked for until there is an Edge listing', () => {
  assert.deepEqual(storeFor(EDGE), { name: 'Edge Add-ons', reviewsUrl: null });
});

test('neither store\'s own pages can be scripted', () => {
  assert.equal(isRestricted('https://chromewebstore.google.com/detail/x'), true);
  assert.equal(isRestricted('https://microsoftedge.microsoft.com/addons/detail/x'), true);
  assert.equal(isRestricted('edge://extensions'), true);
  assert.equal(isRestricted('https://www.microsoft.com/edge'), false);
});
