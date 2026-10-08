// Anonymous usage counts from the extension: the server keeps a day's totals
// and nothing about who sent them, and tells the owner once a week
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countUsage, weeklySummary, SITES } from '../../web/api/_lib/counts.js';
import { HttpsError } from '../../web/api/_lib/http.js';
import { fakeFirestore, fakeMailer, fixedClock, FieldValue } from '../helpers/fake-firestore.js';

const deps = (extra = {}) => ({ db: fakeFirestore(), FieldValue, mailer: fakeMailer(), alertTo: 'owner@example.com', now: fixedClock('2026-10-08T10:00:00Z'), ...extra });
const OPENED = { event: 'opened', site: 'youtube', captions: 'found', plan: 'free', version: '4.8', browser: 154 };
const dayOf = (d, date = '2026-10-08') => d.db.docs.get(`stats/${date}`);

test('an opened window adds one to the day\'s total for its site, captions and plan', async () => {
  const d = deps();
  assert.deepEqual(await countUsage(OPENED, {}, d), { ok: true });
  await countUsage(OPENED, {}, d);
  await countUsage({ ...OPENED, site: 'netflix', captions: 'none', plan: 'premium' }, {}, d);
  assert.deepEqual(dayOf(d), { total: 3, counts: { 'opened|youtube|found|free|4.8|154': 2, 'opened|netflix|none|premium|4.8|154': 1 } });
});

test('a Premium feature tapped by a free user, and a click on the way to Premium, are counted by what and where', async () => {
  const d = deps();
  await countUsage({ event: 'premium_tap', feature: 'translate', where: 'window', version: '4.8', browser: 154 }, {}, d);
  await countUsage({ event: 'upgrade_click', where: 'popup', version: '4.8', browser: 154 }, {}, d);
  assert.deepEqual(dayOf(d).counts, { 'premium_tap|translate|window|4.8|154': 1, 'upgrade_click|popup|4.8|154': 1 });
});

test('nothing about the sender is kept: only the totals, whatever else arrives', async () => {
  const d = deps();
  await countUsage({ ...OPENED, uid: 'u1', email: 'a@b.co', url: 'https://example.com/watch?v=1', title: 'A film', id: 'device-1' }, { auth: { uid: 'u1' } }, d);
  assert.deepEqual([...d.db.docs.keys()], ['stats/2026-10-08']);
  assert.deepEqual(dayOf(d), { total: 1, counts: { 'opened|youtube|found|free|4.8|154': 1 } });
});

test('a site that is not on the short list is counted as "other", never by name', async () => {
  const d = deps();
  assert.deepEqual(SITES, ['youtube', 'netflix', 'hotstar', 'primevideo', 'disneyplus', 'crunchyroll', 'other']);
  for (const site of ['goplay.su', 'example.com', '', undefined, { $gt: '' }]) await countUsage({ ...OPENED, site }, {}, d);
  assert.deepEqual(dayOf(d).counts, { 'opened|other|found|free|4.8|154': 5 });
});

test('what is not one of the known answers is refused and not counted', async () => {
  const d = deps();
  for (const bad of [{}, { event: 'watched' }, { ...OPENED, captions: 'maybe' }, { ...OPENED, plan: 'gold' }, { ...OPENED, version: '<b>' }, { ...OPENED, browser: 'Chrome' }, { event: 'premium_tap', feature: 'everything', where: 'window', version: '4.8', browser: 154 }, { event: 'upgrade_click', where: 'moon', version: '4.8', browser: 154 }]) {
    await assert.rejects(countUsage(bad, {}, d), (e) => e instanceof HttpsError && e.status === 'invalid-argument', JSON.stringify(bad));
  }
  assert.equal(dayOf(d), undefined);
});

test('a flood stops being counted at the day\'s limit, and is still answered', async () => {
  const d = deps();
  d.db.docs.set('stats/2026-10-08', { total: 50000, counts: { 'opened|youtube|found|free|4.8|154': 50000 } });
  assert.deepEqual(await countUsage(OPENED, {}, d), { ok: true });
  assert.equal(dayOf(d).total, 50000);
});

// ---- the weekly summary to the owner ----

function week(d) {
  d.db.docs.set('stats/2026-09-30', { total: 99, counts: { 'opened|youtube|found|free|4.7|154': 99 } });
  d.db.docs.set('stats/2026-10-02', { total: 10, counts: { 'opened|youtube|found|free|4.8|154': 6, 'opened|youtube|none|free|4.8|154': 2, 'opened|other|none|free|4.8|153': 2 } });
  d.db.docs.set('stats/2026-10-07', { total: 9, counts: { 'opened|netflix|found|premium|4.8|154': 4, 'premium_tap|translate|window|4.8|154': 3, 'premium_tap|speed|popup|4.8|154': 1, 'upgrade_click|window|4.8|154': 1 } });
}

test('the summary covers the seven days before today and says where captions were not found', async () => {
  const d = deps();
  week(d);
  assert.deepEqual(await weeklySummary({}, {}, d), { ok: true, sent: true });
  const [mail] = d.mailer.sent;
  assert.equal(mail.to, 'owner@example.com');
  assert.equal(mail.subject, '[SubPIP week] 14 windows opened, 4 without captions');
  assert.match(mail.text, /1 Oct to 7 Oct/);
  assert.match(mail.text, /youtube +8 opened, 2 without captions \(25%\)/);
  assert.match(mail.text, /other +2 opened, 2 without captions \(100%\)/);
  assert.match(mail.text, /netflix +4 opened, 0 without captions \(0%\)/);
  assert.match(mail.text, /free 10, Premium 4/);
  assert.match(mail.text, /translate +3/);
  assert.match(mail.text, /speed +1/);
  assert.match(mail.text, /On the way to Premium: 1 \(window 1\)/);
  assert.doesNotMatch(mail.text, /99/, 'the day eight days back is left out');
});

test('it is sent once a day at most, however often it is asked for', async () => {
  const d = deps();
  week(d);
  await weeklySummary({}, {}, d);
  assert.deepEqual(await weeklySummary({}, {}, d), { ok: true, sent: false });
  assert.equal(d.mailer.sent.length, 1);
});

test('a week with nothing counted still says so', async () => {
  const d = deps();
  await weeklySummary({}, {}, d);
  assert.equal(d.mailer.sent[0].subject, '[SubPIP week] 0 windows opened, 0 without captions');
  assert.match(d.mailer.sent[0].text, /Nothing was counted/);
});
