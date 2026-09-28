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
