// Feedback from the page shown after SubPIP is uninstalled: anonymous, stored,
// and emailed to the owner, with caps so a flood cannot fill the database or
// use up the Gmail allowance that license emails depend on
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback } from '../../web/api/_lib/feedback.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const quiet = async (fn) => { const e = console.error; const l = console.log; console.error = () => {}; console.log = () => {}; try { return await fn(); } finally { console.error = e; console.log = l; } };
const deps = (extra = {}) => ({ db: fakeFirestore(), FieldValue, mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-10-03T10:00:00Z'), ...extra });
const stored = (d) => [...d.db.docs.entries()].filter(([key]) => key.startsWith('feedback/')).map(([, doc]) => doc);

test('feedback is stored with its reason, comment and version, and emailed to the owner', async () => {
  const d = deps();
  assert.deepEqual(await sendFeedback({ reason: 'site', comment: '  Prime Video shows no captions  ', version: '4.2' }, {}, d), { ok: true });
  assert.deepEqual(stored(d), [{ reason: 'site', comment: 'Prime Video shows no captions', version: '4.2', createdAt: 'SERVER_TIMESTAMP' }]);
  assert.equal(d.mailer.sent.length, 1);
  const [mail] = d.mailer.sent;
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.subject, /^\[SubPIP feedback\] It didn't work on the site I use$/);
  assert.match(mail.text, /Prime Video shows no captions/);
  assert.match(mail.text, /4\.2/);
});

test('a reason that is not one of the choices is refused and nothing is kept', async () => {
  const d = deps();
  for (const reason of [undefined, '', 'because', { $gt: '' }]) {
    await assert.rejects(sendFeedback({ reason, comment: 'x' }, {}, d), (e) => e instanceof HttpsError && e.status === 'invalid-argument');
  }
  assert.deepEqual(stored(d), []);
  assert.equal(d.mailer.sent.length, 0);
});

test('the comment is optional and cut at 1000 characters; an odd version is dropped', async () => {
  const d = deps();
  await sendFeedback({ reason: 'other', comment: 'x'.repeat(5000), version: '<script>alert(1)</script>' }, {}, d);
  await sendFeedback({ reason: 'done', comment: 42 }, {}, d);
  const [first, second] = stored(d);
  assert.equal(first.comment.length, 1000);
  assert.equal(first.version, null);
  assert.deepEqual({ reason: second.reason, comment: second.comment, version: second.version }, { reason: 'done', comment: '', version: null });
});

test('at most 20 emails a day reach the owner; later answers are still stored', async () => {
  const d = deps();
  for (let i = 0; i < 25; i++) await sendFeedback({ reason: 'other', comment: `answer ${i}` }, {}, d);
  assert.equal(d.mailer.sent.length, 20);
  assert.equal(stored(d).length, 25);
});

test('at most 300 answers a day are stored; the rest are still thanked', async () => {
  const d = deps({ mailer: null });
  for (let i = 0; i < 305; i++) assert.deepEqual(await sendFeedback({ reason: 'other' }, {}, d), { ok: true });
  assert.equal(stored(d).length, 300);
  // a new day starts a new count
  d.now = fixedClock('2026-10-04T00:00:01Z');
  await sendFeedback({ reason: 'other' }, {}, d);
  assert.equal(stored(d).length, 301);
});

test('a failing email does not fail the answer', async () => {
  const mailer = fakeMailer();
  mailer.failWith = 'SMTP down';
  const d = deps({ mailer });
  assert.deepEqual(await quiet(() => sendFeedback({ reason: 'captions' }, {}, d)), { ok: true });
  assert.equal(stored(d).length, 1);
});

test('the visitor is answered without waiting for the email', async () => {
  const deferred = [];
  let release;
  const d = deps({ defer: (promise) => deferred.push(promise) });
  d.mailer.send = () => new Promise((resolve) => { release = resolve; });
  const reply = await Promise.race([sendFeedback({ reason: 'premium' }, {}, d), new Promise((resolve) => setTimeout(() => resolve('TIMED OUT'), 200))]);
  assert.deepEqual(reply, { ok: true });
  assert.equal(deferred.length, 1);
  release();
  await Promise.all(deferred);
});
