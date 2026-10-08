// Feedback from the page shown after SubPIP is uninstalled: anonymous, stored,
// and emailed to the owner, with caps so a flood cannot fill the database or
// use up the Gmail allowance that license emails depend on
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendFeedback, siteName } from '../../web/api/_lib/feedback.js';
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

// ---- problems reported from the popup ("Not working on this site?") ----

test('a problem report is stored with the site, what went wrong, the comment and the version, and emailed', async () => {
  const d = deps();
  assert.deepEqual(await sendFeedback({ kind: 'problem', problem: 'captions', site: 'netflix.com', comment: '  Nothing shows  ', version: '4.5' }, {}, d), { ok: true });
  assert.deepEqual(stored(d), [{ kind: 'problem', problem: 'captions', site: 'netflix.com', comment: 'Nothing shows', version: '4.5', createdAt: 'SERVER_TIMESTAMP' }]);
  const [mail] = d.mailer.sent;
  assert.equal(mail.to, 'owner@example.com');
  assert.equal(mail.subject, "[SubPIP problem] netflix.com: Captions don't show in the window");
  assert.match(mail.text, /Nothing shows/);
  assert.match(mail.text, /4\.5/);
});

test('only the name of the site is kept, whatever was typed in the box', () => {
  const kept = {
    'netflix.com': 'netflix.com',
    '  Player.Example.co.uk ': 'player.example.co.uk',
    'www.hotstar.com': 'hotstar.com',
    // A pasted link loses everything but the site
    'https://www.Netflix.com/watch/8123?trackId=1#t=20': 'netflix.com',
    'netflix.com/watch/8123': 'netflix.com',
    'localhost:3000/player': 'localhost',
    '127.0.0.1': '127.0.0.1'
  };
  for (const [typed, site] of Object.entries(kept)) assert.equal(siteName(typed), site, typed);
  for (const typed of ['', 'not a site', '<script>alert(1)</script>', 'user:secret@example.com', `${'a'.repeat(120)}.com`, '-bad-.com', 42, null, undefined, { $gt: '' }]) {
    assert.equal(siteName(typed), null, String(typed));
  }
});

test('a report without a usable site still goes through, and says so', async () => {
  const d = deps();
  await sendFeedback({ kind: 'problem', problem: 'other', site: '<script>alert(1)</script>' }, {}, d);
  await sendFeedback({ kind: 'problem', problem: 'window' }, {}, d);
  assert.deepEqual(stored(d).map((doc) => doc.site), [null, null]);
  assert.equal(d.mailer.sent[0].subject, '[SubPIP problem] no site given: Something else');
  assert.doesNotMatch(d.mailer.sent[0].text, /script/);
});

test('a problem that is not one of the choices is refused and nothing is kept', async () => {
  const d = deps();
  for (const problem of [undefined, '', 'site', 'because', { $gt: '' }]) {
    await assert.rejects(sendFeedback({ kind: 'problem', problem, site: 'example.com' }, {}, d), (e) => e instanceof HttpsError && e.status === 'invalid-argument');
  }
  assert.deepEqual(stored(d), []);
  assert.equal(d.mailer.sent.length, 0);
});

test('reports and uninstall answers share the day\'s limits', async () => {
  const d = deps();
  for (let i = 0; i < 15; i++) await sendFeedback({ reason: 'other' }, {}, d);
  for (let i = 0; i < 15; i++) await sendFeedback({ kind: 'problem', problem: 'other', site: 'example.com' }, {}, d);
  assert.equal(d.mailer.sent.length, 20);
  assert.equal(stored(d).length, 30);
});

// ---- an address to answer, if the reporter leaves one ----

test('an email left with a report is kept and shown to the owner, so the fix can be announced', async () => {
  const d = deps();
  await sendFeedback({ kind: 'problem', problem: 'captions', site: 'goplay.su', email: '  Viewer@Example.com ', version: '4.7' }, {}, d);
  assert.equal(stored(d)[0].email, 'viewer@example.com');
  assert.match(d.mailer.sent[0].text, /Reply to: viewer@example\.com/);
});

test('without an email a report stays anonymous, and what is not an address is dropped', async () => {
  const d = deps();
  for (const email of [undefined, '', 'not an address', 'a@b', { $gt: '' }, `${'x'.repeat(250)}@example.com`]) {
    await sendFeedback({ kind: 'problem', problem: 'other', site: 'example.com', email }, {}, d);
  }
  for (const record of stored(d)) assert.equal('email' in record, false);
  assert.doesNotMatch(d.mailer.sent[0].text, /Reply to/);
});

test('an uninstall answer never carries an email', async () => {
  const d = deps();
  await sendFeedback({ reason: 'other', email: 'viewer@example.com' }, {}, d);
  assert.equal('email' in stored(d)[0], false);
});
