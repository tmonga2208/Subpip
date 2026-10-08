// The one scheduled function: every day it looks at the one-year passes, and
// on Mondays it also sends the week's summary. One function, because the
// hosting plan allows twelve in all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { runScheduled } from '../../web/api/_lib/scheduled.js';
import { fakeFirestore, fakeMailer, FieldValue } from '../helpers/fake-firestore.js';

const deps = (iso) => ({ db: fakeFirestore(), FieldValue, mailer: fakeMailer(), alertTo: 'owner@example.com', now: () => new Date(iso) });

test('the site stays within the twelve functions its hosting plan allows', () => {
  const functions = readdirSync('web/api').filter((file) => file.endsWith('.js'));
  assert.ok(functions.length <= 12, `${functions.length}: ${functions.join(', ')}`);
});

test('it is the only thing scheduled, once a day', () => {
  assert.deepEqual(JSON.parse(readFileSync('web/vercel.json', 'utf8')).crons, [{ path: '/api/scheduled', schedule: '30 3 * * *' }]);
});

test('on a Monday the passes are looked at and the week\'s summary is sent', async () => {
  const d = deps('2026-10-12T03:30:00Z');
  assert.deepEqual(await runScheduled({}, d), { ok: true, passes: { ok: true, reminded: 0, ended: 0 }, summary: { ok: true, sent: true } });
  assert.equal(d.mailer.sent.length, 1);
});

test('on other days only the passes are looked at', async () => {
  const d = deps('2026-10-13T03:30:00Z');
  assert.deepEqual(await runScheduled({}, d), { ok: true, passes: { ok: true, reminded: 0, ended: 0 } });
  assert.equal(d.mailer.sent.length, 0);
});

test('the summary can be asked for on any day', async () => {
  const d = deps('2026-10-13T03:30:00Z');
  assert.equal((await runScheduled({ summary: '1' }, d)).summary.sent, true);
});
