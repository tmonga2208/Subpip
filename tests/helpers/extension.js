// Browser with the built extension loaded, plus a way to open its popup
// against a fixture tab. The test copy of the extension gets all-sites access
// so the popup can inspect and inject into test tabs without a toolbar click.
import puppeteer from 'puppeteer-core';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { before, after, beforeEach } from 'node:test';
import { findBrowser } from '../../scripts/find-browser.mjs';
import { startServer } from './server.js';
import { DIST_DIR, FIXTURES_DIR, openFixture } from './browser.js';

async function launchWithExtension() {
  const extDir = await mkdtemp(path.join(os.tmpdir(), 'subpip-ext-'));
  await cp(DIST_DIR, extDir, { recursive: true });
  const manifestPath = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions.push('<all_urls>');
  await writeFile(manifestPath, JSON.stringify(manifest));

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'subpip-test-'));
  // Google Chrome 137+ ignores --load-extension, so the extension is loaded
  // over the DevTools pipe (works in Chrome, Brave and Chromium alike)
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: false,
    userDataDir,
    pipe: true,
    enableExtensions: [extDir],
    args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required']
  });
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(extDir, { recursive: true, force: true });
  };
  try {
    const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
    const worker = await swTarget.worker();
    const extensionId = new URL(swTarget.url()).host;
    return { browser, worker, extensionId };
  } catch (error) {
    // Never leave the browser running: an open browser keeps the test run alive forever
    await browser.close();
    throw new Error(`The extension did not load in ${findBrowser()}: ${error.message}`);
  }
}

export function json(status, body) {
  return { status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

// Answers the Firebase calls the popup makes. Returns true when it handled
// the request; everything else goes to the network untouched.
// status: 'ok' | 'slow' (answers after 2s) | 'fail' (500); premiumAfterActivate
// flips the user to Premium once activateLicense has been called.
export function firebaseStub({ uid = 'u1', email = 'tester@example.com', premium = false, signIn = 'ok', status = 'ok', premiumAfterActivate = false, deviceId = null } = {}) {
  let isPremium = premium;
  return (request) => {
    const url = request.url();
    if (url.includes('accounts:signInWithPassword') || url.includes('accounts:signUp')) {
      if (signIn === 'network') {
        request.abort('internetdisconnected');
      } else if (signIn === 'bad') {
        request.respond(json(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }));
      } else {
        request.respond(json(200, { idToken: 't', refreshToken: 'r', localId: uid, email }));
      }
      return true;
    }
    if (url.includes(`/documents/users/${uid}`)) {
      const answer = () => request.respond(status === 'fail'
        ? json(500, { error: { message: 'UNAVAILABLE' } })
        : json(200, { fields: { email: { stringValue: email }, isPremium: { booleanValue: isPremium }, ...(deviceId ? { deviceId: { stringValue: deviceId } } : {}) } }));
      if (status === 'slow') setTimeout(answer, 2000);
      else answer();
      return true;
    }
    if (url.startsWith('https://subpip.vercel.app/api/activateLicense')) {
      if (premiumAfterActivate) isPremium = true;
      request.respond(json(200, { result: { success: true } }));
      return true;
    }
    return false;
  };
}

export function useExtension() {
  const ctx = {};
  before(async () => {
    ctx.server = await startServer({ fixturesDir: FIXTURES_DIR, distDir: DIST_DIR });
    Object.assign(ctx, await launchWithExtension());
  });
  after(async () => {
    await ctx.browser?.close();
    await ctx.server?.close();
  });
  beforeEach(async () => {
    await ctx.worker.evaluate(() => Promise.all([chrome.storage.sync.clear(), chrome.storage.local.clear()]));
  });

  ctx.newPage = (pagePath, host) => openFixture(ctx.browser, ctx.server.port, pagePath, host);
  ctx.storage = () => ctx.worker.evaluate(() => chrome.storage.sync.get(null));
  ctx.setSettings = (settings) => ctx.worker.evaluate((value) => chrome.storage.sync.set({ subpipSettings: value }), settings);
  ctx.signInAs = ({ uid = 'u1', email = 'tester@example.com' } = {}) => ctx.worker.evaluate(
    (u, e) => chrome.storage.local.set({ firebaseAuth: { idToken: 't', refreshToken: 'r', user: { uid: u, email: e }, timestamp: Date.now() } }),
    uid, email
  );
  ctx.setAuthCache = (auth) => ctx.worker.evaluate((value) => chrome.storage.local.set({ subpipAuth: value }), auth);
  ctx.authCache = () => ctx.worker.evaluate(async () => (await chrome.storage.local.get('subpipAuth')).subpipAuth);
  ctx.tabIdFor = (url) => ctx.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);

  // Opens popup.html in its own popup window. The popup then targets the
  // active tab of the normal window (see status.js getTargetTab).
  // ready: false returns as soon as the page has loaded, before sign-in settles
  // timezone drives the regional price (Kolkata → ₹, elsewhere → $)
  ctx.openPopup = async ({ stub, ready = true, timezone = 'Asia/Kolkata' } = {}) => {
    const known = new Set(ctx.browser.targets());
    await ctx.worker.evaluate(() => chrome.windows.create({ url: 'about:blank', type: 'popup', width: 360, height: 640 }));
    const target = await ctx.browser.waitForTarget((t) => t.type() === 'page' && !known.has(t));
    const popup = await target.page();
    await popup.emulateTimezone(timezone);
    const errors = [];
    popup.on('pageerror', (error) => errors.push(error.message));
    popup.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await popup.setRequestInterception(true);
    popup.on('request', (request) => {
      if (!(stub && stub(request))) request.continue();
    });
    await popup.goto(`chrome-extension://${ctx.extensionId}/popup.html`);
    if (ready) await popup.waitForSelector('body[data-ready="true"]', { timeout: 10000 });
    else await popup.waitForSelector('#plan-badge');
    popup.errors = errors;
    return popup;
  };
  return ctx;
}
