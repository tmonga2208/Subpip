// Serves web/ and opens its pages in a headed browser, with hooks to stub
// third-party requests (Razorpay, Cloud Functions).
import { before, after } from 'node:test';
import { launchBrowser, WEB_DIR } from './browser.js';
import { startServer } from './server.js';

export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg';

// On the real site Vercel serves its visit counter at this path. This stands
// in for it. Like the real script it runs the hooks queued in window.vaq, then
// reports the address its beforeSend hook returns: the page's own address when
// the hook returns nothing, and no visit when it returns null or false. What
// it would report is kept in window.__visits.
const COUNTER_PATH = '/_vercel/insights/script.js';
const FAKE_COUNTER = `
(() => {
  let beforeSend = (event) => event;
  window.va = (name, arg) => { if (name === 'beforeSend') beforeSend = arg; };
  (window.vaq || []).forEach(([name, arg]) => window.va(name, arg));
  const event = beforeSend({ type: 'pageview', url: location.href });
  window.__visits = window.__visits || [];
  if (event !== null && event !== false) window.__visits.push(event ? event.url : location.href);
})();`;

export function useWebsite() {
  const ctx = {};
  before(async () => {
    // No distDir: web/ has its own script.js
    ctx.server = await startServer({ fixturesDir: WEB_DIR, scripts: { [COUNTER_PATH]: FAKE_COUNTER } });
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
  window.__rzpDescription = this.options.description;
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

// createOrder (server-priced: INR 99900, USD 1500) and confirmPayment
// (requires order id + signature from the fake Razorpay). With `account`, an
// order that carries a checkout code is for that account, and paying it
// activates Premium there. `seen` collects what the page sent.
export function confirmStub({ ok = true, account = null, seen = [] } = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (status, body) => ({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  return (request) => {
    const url = request.url();
    if (request.method() === 'OPTIONS' && url.includes('/api/')) {
      request.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST' } });
      return true;
    }
    if (url.includes('/api/createOrder')) {
      const data = JSON.parse(request.postData() || '{}').data || {};
      seen.push({ endpoint: 'createOrder', data });
      const { currency } = data;
      const amount = { INR: 99900, USD: 1500 }[currency];
      const forAccount = account && data.checkout ? { accountEmail: account } : {};
      request.respond(amount ? json(200, { result: { orderId: `order_${currency}`, amount, currency, keyId: 'rzp_test', ...forAccount } }) : json(400, { error: { message: 'Unsupported currency', status: 'INVALID_ARGUMENT' } }));
      return true;
    }
    if (!url.includes('/api/confirmPayment')) return false;
    const { orderId, signature } = JSON.parse(request.postData() || '{}').data || {};
    if (!orderId || !signature) {
      request.respond(json(400, { error: { message: 'Valid payment and order IDs are required', status: 'INVALID_ARGUMENT' } }));
    } else if (ok) {
      request.respond(json(200, { result: { licenseKey: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com', ...(account ? { activatedFor: account } : {}) } }));
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

// The feedback endpoint behind uninstalled.html; records what was sent
export function feedbackStub(seen = [], { ok = true } = {}) {
  return (request) => {
    if (!request.url().includes('/api/feedback')) return false;
    seen.push(JSON.parse(request.postData() || '{}').data);
    request.respond(ok
      ? { status: 200, contentType: 'application/json', body: JSON.stringify({ result: { ok: true } }) }
      : { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Internal error', status: 'INTERNAL' } }) });
    return true;
  };
}
