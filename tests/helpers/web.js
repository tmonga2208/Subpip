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
  ctx.open = async (pagePath, { width = 1440, height = 900, intercept } = {}) => {
    const page = await ctx.browser.newPage();
    await page.setViewport({ width, height });
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
  const mode = window.__rzpMode || 'success';
  setTimeout(() => {
    if (mode === 'success') this.options.handler({ razorpay_payment_id: 'pay_TEST123' });
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

// The confirmPayment Cloud Function
export function confirmStub({ ok = true } = {}) {
  return (request) => {
    if (!request.url().includes('cloudfunctions.net/confirmPayment')) return false;
    if (request.method() === 'OPTIONS') {
      request.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });
      return true;
    }
    const body = ok
      ? { result: { licenseKey: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' } }
      : { error: { message: 'Payment not completed', status: 'FAILED_PRECONDITION' } };
    request.respond({ status: ok ? 200 : 400, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    return true;
  };
}

export const both = (...stubs) => (request) => stubs.some((stub) => stub(request));
