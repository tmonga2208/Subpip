// Where the popup keeps "who is signed in and are they Premium". It must sit
// in local storage with the sign-in tokens: sync storage is shared by every
// browser on the Chrome profile, signed in to SubPIP or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../../src/popup/auth.js';
import { readStoredSettings } from '../../src/shared/settings.js';

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) { return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const key of [].concat(keys)) delete data[key]; }
  };
}

function useChrome({ sync = {}, local = {} } = {}) {
  const storage = { sync: storageArea(sync), local: storageArea(local) };
  globalThis.chrome = { storage };
  return storage;
}

const signedOut = { init: async () => {}, isLoggedIn: () => false, getCurrentUser: () => null };
const signedInAs = (user, isPremium) => ({
  init: async () => {},
  isLoggedIn: () => true,
  getCurrentUser: () => user,
  getUserStatus: async () => ({ success: true, data: { isPremium } })
});

test('opening the popup signed out leaves another browser\'s Premium alone', async () => {
  const otherBrowser = { uid: 'u1', email: 'a@b.c', isPremium: true };
  const storage = useChrome({ sync: { subpipAuth: otherBrowser } });
  const auth = createAuth(signedOut);
  await auth.init();
  assert.equal(auth.isPremium(), false);
  assert.deepEqual(storage.sync.data.subpipAuth, otherBrowser);
});

test('signing in records the plan on this browser only', async () => {
  const storage = useChrome();
  await createAuth(signedInAs({ uid: 'u1', email: 'a@b.c' }, true)).init();
  assert.deepEqual(storage.local.data.subpipAuth, { uid: 'u1', email: 'a@b.c', isPremium: true });
  assert.equal('subpipAuth' in storage.sync.data, false);
});

test('signing out forgets the plan on this browser', async () => {
  const storage = useChrome({ local: { subpipAuth: { uid: 'u1', email: 'a@b.c', isPremium: true } } });
  const manager = { ...signedInAs({ uid: 'u1', email: 'a@b.c' }, true), signOut: async () => {} };
  const auth = createAuth(manager);
  await auth.init();
  await auth.signOut();
  assert.equal('subpipAuth' in storage.local.data, false);
  assert.equal(auth.isPremium(), false);
});

test('the last known plan shows at once, before the network answers', async () => {
  useChrome({ local: { subpipAuth: { uid: 'u1', email: 'a@b.c', isPremium: true } } });
  let answer;
  const manager = { ...signedInAs({ uid: 'u1', email: 'a@b.c' }, true), getUserStatus: () => new Promise((resolve) => { answer = resolve; }) };
  const auth = createAuth(manager);
  const seen = [];
  auth.onChange(() => seen.push(auth.isPremium()));
  const ready = auth.init();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, [true]);
  answer({ success: true, data: { isPremium: true } });
  await ready;
});

test('pages get Premium from this browser\'s sign-in', async () => {
  useChrome({ local: { subpipAuth: { uid: 'u1', email: 'a@b.c', isPremium: true } } });
  const settings = await readStoredSettings();
  assert.equal(settings.isPremium, true);
  assert.equal(settings.uid, 'u1');
});

test('a Premium flag synced from another browser unlocks nothing here', async () => {
  useChrome({ sync: { subpipSettings: { fontSize: 22 }, subpipAuth: { uid: 'u1', email: 'a@b.c', isPremium: true } } });
  const settings = await readStoredSettings();
  assert.equal(settings.isPremium, false);
  assert.equal('uid' in settings, false);
  assert.equal(settings.fontSize, 22);
});

test('updating from 4.1 keeps Premium for the account signed in on this browser', async () => {
  const synced = { subpipAuth: { uid: 'u1', email: 'a@b.c', isPremium: true } };
  useChrome({ sync: synced, local: { firebaseAuth: { idToken: 't', refreshToken: 'r', user: { uid: 'u1', email: 'a@b.c' }, timestamp: 1 } } });
  assert.equal((await readStoredSettings()).isPremium, true);
  // ...but not when this browser is signed in as somebody else
  useChrome({ sync: synced, local: { firebaseAuth: { idToken: 't', refreshToken: 'r', user: { uid: 'u2', email: 'x@y.z' }, timestamp: 1 } } });
  assert.equal((await readStoredSettings()).isPremium, false);
});
