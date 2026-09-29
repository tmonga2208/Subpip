// The deployed endpoint files load, and fail cleanly when env vars are missing
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CALLABLES = ['confirmPayment', 'activateLicense', 'claimLicenseByEmail', 'translateText', 'resendLicense', 'createOrder'];

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

test('every endpoint exports a request handler', async () => {
  for (const name of [...CALLABLES, 'razorpayWebhook']) {
    const mod = await import(`../../web/api/${name}.js`);
    assert.equal(typeof mod.default, 'function', name);
  }
});

test('without FIREBASE_SERVICE_ACCOUNT the endpoints answer with a clean error', async () => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const log = console.error;
  console.error = () => {};
  try {
    for (const name of CALLABLES) {
      const { default: handler } = await import(`../../web/api/${name}.js`);
      const res = fakeRes();
      await handler({ method: 'POST', headers: {}, body: { data: {} } }, res);
      assert.equal(res.statusCode, 500, name);
      assert.deepEqual(res.body, { error: { message: 'Internal error', status: 'INTERNAL' } }, name);
    }
    const { default: webhook } = await import('../../web/api/razorpayWebhook.js');
    const res = fakeRes();
    await webhook({ method: 'POST', headers: {} }, res);
    assert.equal(res.statusCode, 500);
  } finally {
    console.error = log;
  }
});

test('the API only depends on CommonJS-loadable jose (Vercel cannot require() ES modules)', async () => {
  const { createRequire } = await import('node:module');
  const requireFromWeb = createRequire(new URL('../../web/package.json', import.meta.url));
  // firebase-admin 14 → jwks-rsa 4 → jose 6 (ESM-only) crashed every function at load on Vercel
  const jose = requireFromWeb('jose/package.json');
  assert.notEqual(jose.type, 'module', `jose ${jose.version} is ESM-only`);
});
