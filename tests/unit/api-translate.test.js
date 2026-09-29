import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateForUser, DAILY_CHAR_LIMIT, DEEPL_TARGETS } from '../../web/api/_lib/translate.js';
import { translateText } from '../../web/api/_lib/licensing.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const rejects = (promise, status) => assert.rejects(promise, (e) => e instanceof HttpsError && e.status === status);

function deepl({ status = 200, text = 'hola' } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: status === 200, status, json: async () => ({ translations: [{ text }] }) };
  };
  return { fetch, calls };
}
const deps = (fetch, extra = {}) => ({ db: fakeFirestore(), FieldValue, fetch, deeplKey: 'dk', mailer: fakeMailer(), alertTo: 'o@x.y', now: fixedClock('2026-09-29T10:00:00Z'), ...extra });

test('DeepL target codes', () => {
  assert.deepEqual(DEEPL_TARGETS, { en: 'EN-US', es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT-BR', zh: 'ZH-HANS', ja: 'JA', ko: 'KO', ar: 'AR', ru: 'RU' });
});

test('first request goes to DeepL, the second comes from the cache', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  assert.deepEqual(await translateForUser(d, 'u1', 'hello', 'es'), { translation: 'hola', provider: 'deepl' });
  assert.deepEqual(await translateForUser(d, 'u2', 'hello', 'es'), { translation: 'hola', provider: 'cache' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, { text: ['hello'], target_lang: 'ES' });
  assert.equal(calls[0].auth, 'DeepL-Auth-Key dk');
});

test('cached lines do not count toward the daily cap', async () => {
  const { fetch } = deepl();
  const d = deps(fetch);
  await translateForUser(d, 'u1', 'hello', 'es');
  const before = d.db.read('usage/u1_2026-09-29').chars;
  await translateForUser(d, 'u1', 'hello', 'es');
  assert.equal(d.db.read('usage/u1_2026-09-29').chars, before);
});

test('over the daily cap the server says so (the extension then uses MyMemory)', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  d.db.docs.set('usage/u1_2026-09-29', { chars: DAILY_CHAR_LIMIT - 3 });
  await rejects(translateForUser(d, 'u1', 'hello', 'es'), 'resource-exhausted');
  assert.equal(calls.length, 0);
});

test('unsupported languages and a missing key are declined without calling DeepL', async () => {
  const { fetch, calls } = deepl();
  await rejects(translateForUser(deps(fetch), 'u1', 'hello', 'hi'), 'failed-precondition');
  await rejects(translateForUser(deps(fetch, { deeplKey: '' }), 'u1', 'hello', 'es'), 'failed-precondition');
  assert.equal(calls.length, 0);
});

test('DeepL quota exhausted (456) alerts the owner and declines', async () => {
  const { fetch } = deepl({ status: 456 });
  const d = deps(fetch);
  await quiet(() => rejects(translateForUser(d, 'u1', 'hello', 'es'), 'resource-exhausted'));
  assert.equal(d.mailer.sent.length, 1);
  assert.match(d.mailer.sent[0].subject, /deepl-quota/);
});

test('translateText rejects oversized text before counting anything', async () => {
  const { fetch, calls } = deepl();
  const d = deps(fetch);
  d.db.docs.set('users/pro', { isPremium: true });
  await rejects(translateText({ text: 'x'.repeat(1001), targetLang: 'es' }, { auth: { uid: 'pro', token: {} } }, d), 'invalid-argument');
  assert.equal(calls.length, 0);
  assert.equal(d.db.read('usage/pro_2026-09-29'), undefined);
});

test('translateText is premium-only and returns the provider', async () => {
  const { fetch } = deepl();
  const d = deps(fetch);
  d.db.docs.set('users/free', { isPremium: false });
  d.db.docs.set('users/pro', { isPremium: true });
  await rejects(translateText({ text: 'hi', targetLang: 'es' }, { auth: { uid: 'free', token: {} } }, d), 'permission-denied');
  const result = await translateText({ text: 'hello', targetLang: 'es' }, { auth: { uid: 'pro', token: {} } }, d);
  assert.deepEqual(result, { success: true, translation: 'hola', provider: 'deepl', sourceText: 'hello', targetLang: 'es' });
});
