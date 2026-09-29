// Serves web/ and opens its pages in a headed browser, with hooks to stub
// third-party requests (Razorpay, Cloud Functions).
import { before, after } from 'node:test';
import { launchBrowser, WEB_DIR } from './browser.js';
import { startServer } from './server.js';

export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg';

export function useWebsite() {
  const ctx = {};
  before(async () => {
    // No distDir: web/ has its own script.js
    ctx.server = await startServer({ fixturesDir: WEB_DIR });
    ctx.browser = await launchBrowser();
  });
  after(async () => {
    await ctx.browser?.close();
    await ctx.server?.close();
  });
  ctx.url = (pagePath) => `http://127.0.0.1:${ctx.server.port}/${pagePath}`;
  // timezone drives the regional price (Kolkata → ₹, elsewhere → $)
  ctx.open = async (pagePath, { width = 1440, height = 900, intercept, timezone = 'Asia/Kolkata' } = {}) => {
    const page = await ctx.browser.newPage();
    await page.setViewport({ width, height });
    await page.emulateTimezone(timezone);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    if (intercept) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (!intercept(request)) request.continue();
      });
    }
    await page.goto(ctx.url(pagePath), { waitUntil: 'load' });
    page.errors = errors;
    return page;
  };
  return ctx;
}

const FAKE_RAZORPAY = `
window.Razorpay = function (options) { this.options = options; this.handlers = {}; };
window.Razorpay.prototype.on = function (event, fn) { this.handlers[event] = fn; };
window.Razorpay.prototype.open = function () {
  window.__rzpOpened = true;
  window.__rzpOptions = { amount: this.options.amount, currency: this.options.currency, orderId: this.options.order_id };
  const mode = window.__rzpMode || 'success';
  setTimeout(() => {
    if (mode === 'success') this.options.handler({ razorpay_payment_id: 'pay_TEST123', razorpay_order_id: this.options.order_id, razorpay_signature: 'sig_TEST' });
    else this.handlers['payment.failed']({ error: { description: 'Card declined' } });
  }, 50);
};`;

// Razorpay checkout script: a fake that "pays" instantly, or a blocked load
export function razorpayStub({ blocked = false } = {}) {
  return (request) => {
    if (!request.url().startsWith('https://checkout.razorpay.com/')) return false;
    if (blocked) request.abort('blockedbyclient');
    else request.respond({ status: 200, contentType: 'text/javascript', body: FAKE_RAZORPAY });
    return true;
  };
}

// createOrder (server-priced: INR 100000, USD 1500) and confirmPayment
// (requires order id + signature from the fake Razorpay)
export function confirmStub({ ok = true } = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (status, body) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  return (request) => {
    const url = request.url();
    if (request.method() === 'OPTIONS' && url.includes('/api/')) {
      request.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });
      return true;
    }
    if (url.includes('/api/createOrder')) {
      const { currency } = JSON.parse(request.postData() || '{}').data || {};
      const amount = { INR: 100000, USD: 1500 }[currency];
      request.respond(amount ? json(200, { result: { orderId: `order_${currency}`, amount, currency, keyId: 'rzp_test' } }) : json(400, { error: { message: 'Unsupported currency', status: 'INVALID_ARGUMENT' } }));
      return true;
    }
    if (!url.includes('/api/confirmPayment')) return false;
    const { orderId, signature } = JSON.parse(request.postData() || '{}').data || {};
    if (!orderId || !signature) {
      request.respond(json(400, { error: { message: 'Valid payment and order IDs are required', status: 'INVALID_ARGUMENT' } }));
    } else if (ok) {
      request.respond(json(200, { result: { licenseKey: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' } }));
    } else {
      request.respond(json(400, { error: { message: 'Payment not completed', status: 'FAILED_PRECONDITION' } }));
    }
    return true;
  };
}

export const both = (...stubs) => (request) => stubs.some((stub) => stub(request));

// The resendLicense endpoint; records the email it was asked for
export function resendStub(seen = []) {
  return (request) => {
    if (!request.url().includes('/api/resendLicense')) return false;
    seen.push(JSON.parse(request.postData() || '{}').data?.email);
    request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: { message: "If a purchase exists for that email, we've sent the license to it." } }) });
    return true;
  };
}
