// Email goes out through Resend's HTTP API: what is sent, and how a failure
// surfaces. On the free plan Resend allows 100 emails a day and a couple of
// requests a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from '../../web/api/_lib/mailer.js';

// Resend stand-in: records each request and answers with the next [status, body]
function fakeResend(...replies) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    const [status, body] = replies.length > 1 ? replies.shift() : replies[0] || [200, { id: 'email_1' }];
    return { ok: status < 300, status, json: async () => { if (body === undefined) throw new SyntaxError('not JSON'); return body; } };
  };
  return { fetch, calls };
}

function mailerFor(resend, extra = {}) {
  const waits = [];
  const mailer = createMailer({ apiKey: 're_test', from: 'SubPIP <licenses@example.com>', replyTo: 'help@example.com', fetch: resend.fetch, wait: async (ms) => { waits.push(ms); }, ...extra });
  return { mailer, waits };
}

const message = { to: 'buyer@example.com', subject: 'Your key', text: 'K', html: '<p>K</p>' };
const RATE_LIMITED = [429, { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests. Please limit the number of requests per second.' }];

test('without an API key or a sender there is no mailer', () => {
  assert.equal(createMailer({ apiKey: '', from: 'SubPIP <licenses@example.com>' }), null);
  assert.equal(createMailer({ apiKey: 're_test', from: '' }), null);
});

test('a message is posted to Resend with the key, the sender and where replies go', async () => {
  const resend = fakeResend();
  const sent = await mailerFor(resend).mailer.send(message);
  assert.deepEqual(sent, { id: 'email_1' });
  const [call] = resend.calls;
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.headers.Authorization, 'Bearer re_test');
  assert.equal(call.headers['Content-Type'], 'application/json');
  const { headers, ...body } = call.body;
  assert.deepEqual(body, { from: 'SubPIP <licenses@example.com>', to: ['buyer@example.com'], reply_to: 'help@example.com', subject: 'Your key', text: 'K', html: '<p>K</p>' });
  assert.ok(headers);
});

test('a text-only message has no HTML part', async () => {
  const resend = fakeResend();
  await mailerFor(resend).mailer.send({ to: 'owner@example.com', subject: '[SubPIP alert] x', text: 'plain' });
  assert.equal('html' in resend.calls[0].body, false);
  assert.equal(resend.calls[0].body.text, 'plain');
});

test('a sender given as a bare address is shown as SubPIP', async () => {
  const resend = fakeResend();
  await mailerFor(resend, { from: 'licenses@example.com' }).mailer.send(message);
  assert.equal(resend.calls[0].body.from, 'SubPIP <licenses@example.com>');
});

// Gmail folds messages with the same subject into one thread and hides what
// repeats, which would bury the key in a second "lost my key" email
test('every message carries its own reference so repeats are not folded into a thread', async () => {
  const resend = fakeResend();
  const { mailer } = mailerFor(resend);
  await mailer.send(message);
  await mailer.send(message);
  const [first, second] = resend.calls.map((call) => call.body.headers['X-Entity-Ref-ID']);
  assert.ok(first && second);
  assert.notEqual(first, second);
});

test('a rejection says what Resend objected to', async () => {
  const resend = fakeResend([403, { statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com).' }]);
  await assert.rejects(mailerFor(resend).mailer.send(message), /403.*validation_error.*only send testing emails/);
  // ...also when the reply is not Resend's JSON (a gateway error page)
  await assert.rejects(mailerFor(fakeResend([502, undefined])).mailer.send(message), /Resend 502/);
});

test('a request over the per-second limit is tried once more after a pause', async () => {
  const resend = fakeResend(RATE_LIMITED, [200, { id: 'email_2' }]);
  const { mailer, waits } = mailerFor(resend);
  assert.deepEqual(await mailer.send(message), { id: 'email_2' });
  assert.equal(resend.calls.length, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1000);
  // ...but only once
  const busy = fakeResend(RATE_LIMITED);
  await assert.rejects(mailerFor(busy).mailer.send(message), /rate_limit_exceeded/);
  assert.equal(busy.calls.length, 2);
});

test('a used-up daily allowance is not retried', async () => {
  const resend = fakeResend([429, { statusCode: 429, name: 'daily_quota_exceeded', message: 'You have exceeded your daily email sending quota.' }]);
  await assert.rejects(mailerFor(resend).mailer.send(message), /daily_quota_exceeded/);
  assert.equal(resend.calls.length, 1);
});

test('a request that hangs is given up on instead of holding the function open', async () => {
  const hung = { fetch: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) };
  await assert.rejects(mailerFor(hung, { timeoutMs: 20 }).mailer.send(message), /timeout/i);
});
