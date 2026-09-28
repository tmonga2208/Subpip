# UI Redesign, Part 2: Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long single-column popup with the Cinema-style home screen (page status, one primary button, live caption preview + presets, option rows) and drill-in sub-pages, with settings that save instantly.

**Architecture:** `src/popup.html` holds static markup for every view; small modules in `src/popup/` own one concern each (router, settings store, auth state, account page, captions, home/status, option pages) and `index.js` wires them. Settings live in one in-memory store that writes to `chrome.storage.sync` (sliders debounced 300 ms); open PiP windows already update through the relay (`storage.onChanged`). Auth logic moves out of the view into `auth.js`, which wraps the unchanged `license-manager.js`.

**Tech Stack:** Vanilla JS modules bundled by esbuild into `dist/popup.js`; `node:test` unit tests; puppeteer-core e2e tests that load the built extension in a headed Chrome/Brave and open `popup.html` in a popup window, with Firebase network calls stubbed by request interception.

**Spec:** `docs/superpowers/specs/2026-09-28-ui-redesign-design.md` (§3 Popup, §4 settings data, popup part of §6). Part 1 (`docs/superpowers/plans/2026-09-28-ui-redesign-1-foundation-and-pip.md`) is complete on branch `ui-redesign`; this plan builds on its icons, settings presets and test harness.

## Global Constraints

- Tokens: `--bg #0b0b0c`, `--surface #111214`, `--card #17181b`, `--border #25262a`, `--text #f2f2f2`, `--text-2 #8b8d93`, `--accent #ff4d5e`, `--accent-soft rgba(255,77,94,0.15)`, `--accent-text #ff7a86`, `--success #3ecf8e`, `--danger-text #ff8a8a`; radius 8px / 12px; no gradients on buttons (the caption preview's scene gradient is content, not a button).
- System font stack, sizes 11 / 12 / 13 / 15 px. No web fonts.
- Popup is **340px** wide and at most **600px** tall; content scrolls vertically inside, never horizontally.
- Settings save as they change; sliders and color pickers are debounced **300 ms**; there is no Save button; pending writes flush when the popup closes.
- Errors appear inline under the control that failed, in `--danger-text`; a pressed button shows a spinner while it works.
- Escape goes back one level on a sub-page.
- Status copy exactly as spec §3.2 (titles and subtitles below in Task 4).
- Premium URL: `https://subpip.vercel.app/premium.html`.
- The Open/Close flow keeps its injection order: settings + run flag → `script.js` → save → `translate-relay.js`, then `window.close()`.
- Icon-only buttons have `aria-label` and `title`; focus ring `2px solid #ff4d5e`.
- No version text in the header.

## Review Focus

- **Very long account email:** the header and account page must not scroll sideways; the email truncates with an ellipsis. Pinned in Task 2.
- **Signing in while offline:** a readable "Can't reach SubPIP…" message under the form, and the button works again. Pinned in Task 2.
- **Dragging a slider fast, or closing the popup mid-drag:** the final value is what gets saved. Pinned in Task 3.
- **Opening the popup on a browser error page or `chrome://` page:** "SubPIP can't run on this page", no crash. Pinned in Task 4.
- **Settings saved by older versions** (an `isPremium` copy inside settings, no `captionPreset`): shown as Custom, and the stale `isPremium` is dropped on the next save. Pinned in Task 3.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/popup.html` | rewrite | Markup for home + all sub-pages |
| `src/popup.css` | rewrite | Cinema styles on the tokens |
| `src/popup/index.js` | rewrite | Wire modules, render icons, `data-ready` flag |
| `src/popup/router.js` | create | Home ↔ sub-page navigation, back bar, Escape |
| `src/popup/auth.js` | create | Signed-in user + premium state over `LicenseManager` |
| `src/popup/account.js` | create | Account & license page, header badge + avatar |
| `src/popup/settings-store.js` | create | In-memory settings, instant/debounced save |
| `src/popup/captions.js` | create | Preview, presets, Custom page |
| `src/popup/status.js` | create | Find target tab, probe it, describe the status |
| `src/popup/home.js` | create | Status card + Open/Close button |
| `src/popup/options.js` | create | Option rows, Translate / Speed / Auto PiP pages, Premium gating |
| `src/popup/license-manager.js` | unchanged | Firebase REST calls |
| `src/shared/icons.js` | modify | Add `person` icon |
| `src/shared/settings.js` | modify | Add `SPEEDS` |
| `src/content/styles.js` | modify | Export `hexToRgba`, `captionTextShadow` |
| `src/content/adapters.js` | modify | Add display `label` per site |
| `src/content/settings-menu.js` | modify | Use shared `SPEEDS` |
| `tests/helpers/browser.js` | modify | Extract `openFixture()` |
| `tests/helpers/extension.js` | create | Browser with the extension, `openPopup()`, Firebase stubs |
| `tests/fixtures/novideo.html` | create | Page without a video |
| `tests/unit/*.test.js` | create/modify | Store, status copy, caption style, icons, speeds |
| `tests/e2e/popup-*.test.js` | create | Shell, account, captions, status, options |

Between Tasks 1 and 5 the popup is only partly wired (for example, option rows do nothing until Task 5). That is expected on this branch; the popup is complete after Task 5.

---

### Task 1: Popup shell, router and extension test harness

**Files:**
- Modify: `tests/helpers/browser.js`, `src/shared/icons.js`, `tests/unit/icons.test.js`
- Create: `tests/helpers/extension.js`, `src/popup/router.js`, `tests/e2e/popup-shell.test.js`
- Rewrite: `src/popup.html`, `src/popup.css`, `src/popup/index.js`

**Interfaces:**
- Consumes: `iconMarkup(name)` (Part 1), `startServer` (Part 1).
- Produces:
  - `openFixture(browser, port, pagePath, host = '127.0.0.1') → Promise<Page>` with `page.errors`
  - `useExtension() → ctx` with `ctx.worker`, `ctx.extensionId`, `ctx.newPage(path, host?)`, `ctx.openPopup({ stub }?) → Promise<Page>` (resolves when `body[data-ready="true"]`; `popup.errors: string[]`), `ctx.storage() → Promise<object>` (all of `chrome.storage.sync`), `ctx.setSettings(obj)`, `ctx.signInAs({ uid, email }?)`, `ctx.tabIdFor(url) → Promise<number>`; storage is cleared before each test
  - `firebaseStub({ uid = 'u1', email = 'tester@example.com', premium = false, signIn = 'ok' | 'bad' | 'network' }?) → (request) => boolean` and `json(status, body)`
  - `createRouter(doc) → { current() → string, go(name), back() → boolean, onChange(fn) }`
  - DOM ids used by later tasks (all present in the markup below).

- [ ] **Step 1: Extract `openFixture`** — in `tests/helpers/browser.js`, replace the body of `ctx.newPage = async (pagePath, host = '127.0.0.1') => { ... };` with a call to a new exported function, and add that function above `useBrowser`:

```js
// Opens a fixture page and waits for its video (if any) to have metadata
export async function openFixture(browser, port, pagePath, host = '127.0.0.1') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`http://${host}:${port}/${pagePath}`);
  await page.evaluate(() => new Promise((resolve) => {
    const video = document.querySelector('video');
    if (!video || video.readyState >= 1) resolve();
    else video.addEventListener('loadedmetadata', resolve, { once: true });
  }));
  page.errors = errors;
  return page;
}
```

and inside `useBrowser`:

```js
  ctx.newPage = (pagePath, host) => openFixture(ctx.browser, ctx.server.port, pagePath, host);
```

- [ ] **Step 2: Extension harness** — create `tests/helpers/extension.js`:

```js
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
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: false,
    userDataDir,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
      `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`
    ]
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
  const worker = await swTarget.worker();
  const extensionId = new URL(swTarget.url()).host;
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(extDir, { recursive: true, force: true });
  };
  return { browser, worker, extensionId };
}

export function json(status, body) {
  return { status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) };
}

// Answers the Firebase calls the popup makes. Returns true when it handled
// the request; everything else goes to the network untouched.
export function firebaseStub({ uid = 'u1', email = 'tester@example.com', premium = false, signIn = 'ok' } = {}) {
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
      request.respond(json(200, { fields: { email: { stringValue: email }, isPremium: { booleanValue: premium } } }));
      return true;
    }
    if (url.includes('cloudfunctions.net/activateLicense')) {
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
  ctx.tabIdFor = (url) => ctx.worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);

  // Opens popup.html in its own popup window. The popup then targets the
  // active tab of the normal window (see status.js getTargetTab).
  ctx.openPopup = async ({ stub } = {}) => {
    const known = new Set(ctx.browser.targets());
    await ctx.worker.evaluate(() => chrome.windows.create({ url: 'about:blank', type: 'popup', width: 360, height: 640 }));
    const target = await ctx.browser.waitForTarget((t) => t.type() === 'page' && !known.has(t));
    const popup = await target.page();
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
    await popup.waitForSelector('body[data-ready="true"]', { timeout: 10000 });
    popup.errors = errors;
    return popup;
  };
  return ctx;
}
```

- [ ] **Step 3: Write the failing tests**

Add `'person'` to the `REQUIRED` array in `tests/unit/icons.test.js` (after `'spinner'`).

Create `tests/e2e/popup-shell.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension();

const viewState = (popup) => popup.evaluate(() => ({
  view: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view).join(','),
  title: document.getElementById('page-title').textContent,
  topbarHidden: document.getElementById('topbar').hidden,
  pagebarHidden: document.getElementById('pagebar').hidden
}));

test('home shows the brand, Free badge and main button', async () => {
  const popup = await ctx.openPopup();
  const home = await popup.evaluate(() => ({
    brand: document.querySelector('.brand').textContent,
    badge: document.getElementById('plan-badge').textContent,
    button: document.getElementById('pip-btn').textContent.trim(),
    width: document.body.getBoundingClientRect().width,
    hasSave: !!document.getElementById('save-btn')
  }));
  assert.deepEqual(home, { brand: 'SubPIP', badge: 'Free', button: 'Open Picture-in-Picture', width: 340, hasSave: false });
  assert.deepEqual(await viewState(popup), { view: 'home', title: '', topbarHidden: false, pagebarHidden: true });
  assert.deepEqual(popup.errors, []);
  await popup.close();
});

test('every [data-icon] placeholder renders an svg', async () => {
  const popup = await ctx.openPopup();
  const missing = await popup.evaluate(() => [...document.querySelectorAll('[data-icon]')].filter((el) => !el.querySelector('svg')).length);
  assert.equal(missing, 0);
  await popup.close();
});

test('sub-pages show a back bar with a title; Back and Escape return home', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  assert.deepEqual(await viewState(popup), { view: 'account', title: 'Account & license', topbarHidden: true, pagebarHidden: false });
  await popup.click('#back-btn');
  assert.equal((await viewState(popup)).view, 'home');
  await popup.click('#account-btn');
  await popup.keyboard.press('Escape');
  assert.equal((await viewState(popup)).view, 'home');
  await popup.close();
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `npm run test:unit` → FAIL: `missing person`.
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-shell.test.js` → FAIL: `body[data-ready="true"]` never appears (old popup).

- [ ] **Step 5: `person` icon** — in `src/shared/icons.js`, add to `ICONS` after `spinner`:

```js
  person: [['circle', { cx: '12', cy: '8', r: '4', ...STROKE }], ['path', { d: 'M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6', ...STROKE }]]
```

(add a comma after the `spinner` entry).

- [ ] **Step 6: Popup markup** — replace all of `src/popup.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SubPIP</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="app">
    <header class="bar" id="topbar">
      <img class="logo" src="assets/icon-32.png" alt="" width="20" height="20">
      <span class="brand">SubPIP</span>
      <span class="badge" id="plan-badge">Free</span>
      <button class="icon-btn avatar" id="account-btn" type="button" aria-label="Account &amp; license" title="Account &amp; license">
        <span id="account-initial" hidden></span>
        <span id="account-icon" data-icon="person"></span>
      </button>
    </header>
    <header class="bar" id="pagebar" hidden>
      <button class="icon-btn" id="back-btn" type="button" aria-label="Back" title="Back (Esc)"><span data-icon="chevron-left"></span></button>
      <h1 class="page-title" id="page-title"></h1>
    </header>

    <main class="views">
      <section class="view" data-view="home">
        <div class="status" id="status" data-state="loading">
          <span class="dot"></span>
          <div class="status-text">
            <div class="status-title" id="status-title">Checking this page…</div>
            <div class="status-sub" id="status-sub"></div>
          </div>
          <kbd class="kbd">Alt+P</kbd>
        </div>
        <button class="primary" id="pip-btn" type="button" disabled>Open Picture-in-Picture</button>

        <h2 class="section-label">Captions</h2>
        <div class="preview" id="home-preview"><span class="preview-caption">This is how captions look</span></div>
        <div class="chips" role="group" aria-label="Caption style">
          <button class="chip" type="button" data-preset="classic">Classic</button>
          <button class="chip" type="button" data-preset="large">Large</button>
          <button class="chip" type="button" data-preset="outline">Outline</button>
          <button class="chip" type="button" data-preset="custom">Custom <span data-icon="chevron-right"></span></button>
        </div>

        <h2 class="section-label">Options</h2>
        <div class="rows">
          <button class="row" type="button" data-go="translate" data-premium><span class="row-label">Translate captions</span><span class="row-value" id="translate-value"></span><span data-icon="chevron-right"></span></button>
          <button class="row" type="button" data-go="speed" data-premium><span class="row-label">Playback speed</span><span class="row-value" id="speed-value"></span><span data-icon="chevron-right"></span></button>
          <button class="row" type="button" data-go="autopip"><span class="row-label">Auto PiP on tab switch</span><span class="row-value" id="autopip-value"></span><span data-icon="chevron-right"></span></button>
          <button class="row" type="button" data-go="account"><span class="row-label">Account &amp; license</span><span class="row-value" id="account-value"></span><span data-icon="chevron-right"></span></button>
        </div>
      </section>

      <section class="view" data-view="custom" data-title="Custom style" hidden>
        <div class="preview sticky" id="custom-preview"><span class="preview-caption">This is how captions look</span></div>
        <label class="field"><span class="field-label">Size <output id="size-out"></output></span><input type="range" id="size" min="12" max="40" step="1"></label>
        <div class="field"><span class="field-label">Text color</span><div class="swatches" id="text-swatches" role="radiogroup" aria-label="Text color"></div></div>
        <div class="field"><span class="field-label">Background</span><div class="swatches" id="bg-swatches" role="radiogroup" aria-label="Background color"></div></div>
        <label class="field"><span class="field-label">Background opacity <output id="opacity-out"></output></span><input type="range" id="opacity" min="0" max="100" step="5"></label>
        <label class="field"><span class="field-label">Font</span>
          <select id="font">
            <option value="sans-serif">Sans</option>
            <option value="serif">Serif</option>
            <option value="monospace">Mono</option>
            <option value="'Arial', sans-serif">Arial</option>
            <option value="'Verdana', sans-serif">Verdana</option>
          </select>
        </label>
        <div class="field"><span class="field-label">Position</span>
          <div class="segmented" role="radiogroup" aria-label="Position">
            <button type="button" role="radio" data-position="bottom">Bottom</button>
            <button type="button" role="radio" data-position="top">Top</button>
          </div>
        </div>
        <label class="field toggle-field"><span class="field-label">Outline</span><input type="checkbox" class="switch" id="outline"></label>
        <label class="field"><span class="field-label">Subtitle file URL <span class="tag" id="subs-tag" hidden>Premium</span></span>
          <input type="url" id="subs-url" placeholder="https://…/subtitles.vtt">
          <span class="hint">VTT or SRT link</span>
        </label>
      </section>

      <section class="view" data-view="translate" data-title="Translate captions" hidden>
        <label class="field toggle-field"><span class="field-label">Translate captions</span><input type="checkbox" class="switch" id="translate-on"></label>
        <div class="radio-list" id="language-list" role="radiogroup" aria-label="Language"></div>
      </section>

      <section class="view" data-view="speed" data-title="Playback speed" hidden>
        <p class="hint">Used when Picture-in-Picture opens.</p>
        <div class="radio-list" id="speed-list" role="radiogroup" aria-label="Default playback speed"></div>
      </section>

      <section class="view" data-view="autopip" data-title="Auto PiP" hidden>
        <p class="paragraph">Opens Picture-in-Picture automatically when you switch away from a tab playing video. Chrome will ask once for access to all sites so SubPIP can be ready on every page.</p>
        <label class="field toggle-field"><span class="field-label">Auto PiP on tab switch</span><input type="checkbox" class="switch" id="autopip-on"></label>
        <p class="error" id="autopip-error" role="alert" hidden></p>
      </section>

      <section class="view" data-view="account" data-title="Account &amp; license" hidden>
        <div id="signed-out">
          <div class="segmented" role="tablist" aria-label="Account">
            <button type="button" role="tab" data-mode="signin" aria-selected="true">Sign in</button>
            <button type="button" role="tab" data-mode="signup" aria-selected="false">Create account</button>
          </div>
          <form id="auth-form" novalidate>
            <label class="field"><span class="field-label">Email</span><input type="email" id="auth-email" autocomplete="email"></label>
            <label class="field"><span class="field-label">Password</span><input type="password" id="auth-password" autocomplete="current-password"></label>
            <p class="error" id="auth-error" role="alert" hidden></p>
            <button class="primary spaced" type="submit" id="auth-submit">Sign in</button>
          </form>
          <p class="hint">Have a license key? Sign in first to activate it.</p>
        </div>
        <div id="signed-in" hidden>
          <div class="account-card"><div class="account-email" id="account-email"></div><span class="badge" id="account-plan">Free</span></div>
          <div id="free-actions">
            <form id="license-form" novalidate>
              <label class="field"><span class="field-label">License key</span>
                <span class="input-row"><input type="text" id="license-key" placeholder="SUBPIP-XXXXXXXX-XXXX" autocomplete="off" spellcheck="false"><button class="secondary" type="submit" id="license-submit">Activate</button></span>
              </label>
              <p class="error" id="license-error" role="alert" hidden></p>
              <p class="success" id="license-success" role="status" hidden></p>
            </form>
            <button class="link" type="button" id="check-payment">Already paid? Check payment</button>
            <button class="primary spaced" type="button" data-action="get-premium">Get Premium · ₹1000 lifetime</button>
          </div>
          <button class="link danger" type="button" id="sign-out">Sign out</button>
        </div>
      </section>

      <section class="view" data-view="upgrade" data-title="SubPIP Premium" hidden>
        <p class="lead">Unlock the extras with a one-time payment.</p>
        <ul class="features">
          <li><span data-icon="check"></span>Real-time caption translation</li>
          <li><span data-icon="check"></span>Playback speed control (0.5×–3×)</li>
          <li><span data-icon="check"></span>Load subtitle files (VTT / SRT)</li>
        </ul>
        <div class="price">₹1000 <span>lifetime</span></div>
        <button class="primary" type="button" data-action="get-premium">Get Premium</button>
        <button class="link" type="button" id="upgrade-check-payment">Already paid? Check payment</button>
      </section>
    </main>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 7: Popup styles** — replace all of `src/popup.css` with:

```css
:root {
  --bg: #0b0b0c;
  --surface: #111214;
  --card: #17181b;
  --border: #25262a;
  --text: #f2f2f2;
  --text-2: #8b8d93;
  --accent: #ff4d5e;
  --accent-hover: #ff6574;
  --accent-soft: rgba(255, 77, 94, 0.15);
  --accent-text: #ff7a86;
  --success: #3ecf8e;
  --danger-text: #ff8a8a;
  --radius-sm: 8px;
  --radius-lg: 12px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--surface); }
body {
  width: 340px; max-height: 600px; overflow: hidden;
  font: 12px/1.4 var(--font); color: var(--text); -webkit-font-smoothing: antialiased;
}
button, input, select { font: inherit; color: inherit; }
[hidden] { display: none !important; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.app { display: flex; flex-direction: column; max-height: 600px; }

/* Header bars */
.bar { flex: none; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 12px 0 14px; border-bottom: 1px solid var(--border); }
.logo { display: block; border-radius: 5px; }
.brand { font-size: 13px; font-weight: 600; }
.badge { margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 99px; background: var(--card); color: var(--text-2); font-size: 10px; font-weight: 600; }
.badge.premium { border-color: transparent; background: var(--accent-soft); color: var(--accent-text); }
.icon-btn { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); cursor: pointer; }
.icon-btn:hover { background: rgba(255, 255, 255, 0.07); }
.avatar { border-radius: 50%; background: var(--card); color: #c8c9cd; font-size: 11px; font-weight: 600; }
.icon { display: inline-grid; place-items: center; }
.icon svg { display: block; width: 16px; height: 16px; }
.page-title { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }

/* Views */
.views { overflow-x: hidden; overflow-y: auto; max-height: 552px; }
.view { padding: 12px 14px 16px; }
.view.enter-forward { animation: in-forward 0.18s ease-out; }
.view.enter-back { animation: in-back 0.18s ease-out; }
@keyframes in-forward { from { transform: translateX(16px); opacity: 0; } }
@keyframes in-back { from { transform: translateX(-16px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .view.enter-forward, .view.enter-back { animation: none; }
}
.section-label { margin: 16px 0 6px; color: var(--text-2); font-size: 10px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; }

/* Status card */
.status { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #4a4c52; }
.status[data-state="video"] .dot, .status[data-state="pip"] .dot { background: var(--success); }
.status-text { flex: 1; min-width: 0; }
.status-title, .status-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-title { font-weight: 600; }
.status-sub { margin-top: 1px; color: var(--text-2); font-size: 11px; }
.kbd { flex: none; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-2); font: 10px var(--font); }

/* Buttons */
.primary { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; padding: 11px 12px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
.primary:hover:not(:disabled) { background: var(--accent-hover); }
.primary:disabled { background: var(--card); color: var(--text-2); cursor: default; }
.spaced { margin-top: 12px; }
.secondary { position: relative; flex: none; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card); font-weight: 600; cursor: pointer; }
.secondary:hover:not(:disabled) { border-color: #3a3b40; }
.link { position: relative; display: block; width: 100%; margin-top: 10px; padding: 4px; border: 0; background: none; color: var(--text-2); text-align: center; cursor: pointer; }
.link:hover { color: var(--text); }
.link.danger:hover { color: var(--danger-text); }
.busy { color: transparent !important; pointer-events: none; }
.busy::after {
  content: ""; position: absolute; top: 50%; left: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Caption preview + preset chips */
.preview { position: relative; height: 72px; margin-bottom: 8px; overflow: hidden; border-radius: var(--radius-lg); background: linear-gradient(160deg, #3b4a5c, #1f2a36 45%, #0e1319); }
.preview.sticky { position: sticky; top: -12px; z-index: 1; }
.preview-caption {
  position: absolute; bottom: 10px; left: 50%; max-width: 92%; padding: 2px 8px; overflow: hidden; transform: translateX(-50%);
  border-radius: 4px; font-weight: bold; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap;
}
.preview[data-position="top"] .preview-caption { top: 10px; bottom: auto; }
.chips { display: flex; gap: 6px; }
.chip { flex: 1; display: flex; align-items: center; justify-content: center; gap: 2px; padding: 7px 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: transparent; color: #c8c9cd; font-size: 11px; cursor: pointer; }
.chip:hover { border-color: #3a3b40; }
.chip[aria-pressed="true"] { border-color: var(--accent); background: rgba(255, 77, 94, 0.1); color: #fff; }
.chip .icon svg { width: 12px; height: 12px; }

/* Option rows and radio lists */
.rows, .radio-list { overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-lg); }
.radio-list { margin-top: 12px; }
.row, .radio { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; border-bottom: 1px solid var(--border); background: transparent; text-align: left; cursor: pointer; }
.row { padding: 10px 12px; }
.radio { padding: 9px 12px; }
.row:last-child, .radio:last-child { border-bottom: 0; }
.row:hover, .radio:hover { background: rgba(255, 255, 255, 0.04); }
.row-label { flex: 1; min-width: 0; }
.row-value { min-width: 0; max-width: 150px; overflow: hidden; color: var(--text-2); text-overflow: ellipsis; white-space: nowrap; }
.row > .icon { color: var(--text-2); }
.radio .icon { margin-left: auto; color: var(--accent); visibility: hidden; }
.radio[aria-checked="true"] .icon { visibility: visible; }
.radio-list[aria-disabled="true"] { opacity: 0.45; }
.tag { display: inline-block; padding: 2px 7px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-text); font-size: 10px; font-weight: 600; }

/* Forms */
.field { display: block; margin-top: 12px; }
.field-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-weight: 600; }
.field-label output { color: var(--text-2); font-weight: 400; }
input[type="email"], input[type="password"], input[type="text"], input[type="url"], select {
  width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card); outline: none;
}
input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
input:disabled { opacity: 0.5; }
input[type="range"] { width: 100%; accent-color: var(--accent); }
.input-row { display: flex; gap: 6px; }
.toggle-field { display: flex; align-items: center; justify-content: space-between; }
.toggle-field .field-label { margin: 0; }
.switch { position: relative; flex: none; width: 32px; height: 18px; border-radius: 99px; background: #3a3b40; cursor: pointer; appearance: none; transition: background 0.15s; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
.switch:checked { background: var(--accent); }
.switch:checked::after { transform: translateX(14px); }
.swatches { display: flex; align-items: center; gap: 6px; }
.swatch { width: 24px; height: 24px; padding: 0; border: 2px solid var(--border); border-radius: 50%; cursor: pointer; }
.swatch[aria-checked="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 2px var(--surface); }
.swatch-custom { width: 24px; height: 24px; padding: 0; border: 2px dashed var(--border); border-radius: 50%; background: none; cursor: pointer; appearance: none; }
.swatch-custom::-webkit-color-swatch-wrapper { padding: 2px; }
.swatch-custom::-webkit-color-swatch { border: 0; border-radius: 50%; }
.segmented { display: flex; padding: 2px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--card); }
.segmented button { flex: 1; padding: 6px 0; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); font-weight: 600; cursor: pointer; }
.segmented [aria-checked="true"], .segmented [aria-selected="true"] { background: #2a2b30; color: var(--text); }
.hint { margin-top: 6px; color: var(--text-2); font-size: 11px; }
.error { margin-top: 8px; color: var(--danger-text); font-size: 11px; }
.success { margin-top: 8px; color: var(--success); font-size: 11px; }
.paragraph { color: var(--text-2); line-height: 1.5; }

/* Account */
.account-card { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.account-email { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.account-card .badge { margin-left: 0; }

/* Upgrade */
.lead { color: var(--text-2); font-size: 13px; }
.features { margin: 12px 0; list-style: none; }
.features li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.features .icon { color: var(--accent); }
.price { margin: 4px 0 12px; font-size: 22px; font-weight: 700; }
.price span { color: var(--text-2); font-size: 12px; font-weight: 400; }
```

- [ ] **Step 8: Router** — create `src/popup/router.js`:

```js
// Home + drill-in pages: exactly one .view is visible. Sub-pages swap the
// top bar for a back bar with the page title; Escape goes back one level.

export function createRouter(doc) {
  const views = new Map([...doc.querySelectorAll('.view')].map((view) => [view.dataset.view, view]));
  const topbar = doc.getElementById('topbar');
  const pagebar = doc.getElementById('pagebar');
  const title = doc.getElementById('page-title');
  const scroller = doc.querySelector('.views');
  const stack = ['home'];
  const listeners = [];

  function render(direction) {
    const name = stack[stack.length - 1];
    for (const [key, view] of views) view.hidden = key !== name;
    const view = views.get(name);
    const isHome = name === 'home';
    topbar.hidden = !isHome;
    pagebar.hidden = isHome;
    title.textContent = isHome ? '' : view.dataset.title || '';
    view.classList.remove('enter-forward', 'enter-back');
    if (direction) {
      void view.offsetWidth; // restart the animation
      view.classList.add(direction === 'back' ? 'enter-back' : 'enter-forward');
    }
    scroller.scrollTop = 0;
    listeners.forEach((fn) => fn(name));
  }

  const router = {
    current: () => stack[stack.length - 1],
    go(name) {
      if (!views.has(name)) throw new Error(`Unknown view: ${name}`);
      if (router.current() === name) return;
      stack.push(name);
      render('forward');
    },
    back() {
      if (stack.length === 1) return false;
      stack.pop();
      render('back');
      return true;
    },
    onChange(fn) {
      listeners.push(fn);
    }
  };

  doc.getElementById('back-btn').addEventListener('click', () => router.back());
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && router.back()) event.preventDefault();
  });
  render(null);
  return router;
}
```

- [ ] **Step 9: Entry point** — replace all of `src/popup/index.js` with:

```js
// SubPIP popup: wires the pages together

import { iconMarkup } from '../shared/icons.js';
import { createRouter } from './router.js';

// Extension page, so icon markup strings are fine here (unlike page scripts)
function renderIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.classList.add('icon');
    el.innerHTML = iconMarkup(el.dataset.icon);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  const router = createRouter(document);
  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));
  document.body.dataset.ready = 'true';
});
```

- [ ] **Step 10: Run the tests**

Run: `npm run test:unit` → PASS (the icons test now also checks `person`).
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-shell.test.js` → PASS (3 tests).

- [ ] **Step 11: Full suite, lint, commit**

```bash
npm run lint && npm run test
git add src/popup.html src/popup.css src/popup/index.js src/popup/router.js src/shared/icons.js tests
git commit -m "feat(popup): Cinema shell with home and drill-in pages"
```

---

### Task 2: Auth state, account page and header

**Files:**
- Create: `src/popup/auth.js`, `src/popup/account.js`, `tests/e2e/popup-account.test.js`
- Modify: `src/popup/index.js`

**Interfaces:**
- Consumes: `LicenseManager` (unchanged: `init`, `isLoggedIn`, `getCurrentUser`, `signIn`, `signUp`, `signOut`, `getUserStatus`, `validateSession`, `activateLicense(key)`, `claimLicenseByEmail()`, `sendEmailVerification()`); `createRouter` (Task 1); `firebaseStub`, `ctx.signInAs` (Task 1).
- Produces:
  - `createAuth(manager = new LicenseManager()) → auth` with `init()`, `user() → { uid, email } | null`, `isPremium() → boolean`, `notice() → string`, `onChange(fn)`, `signIn(email, password)`, `signUp(email, password)` (both `→ { success, error? }`), `signOut()`, `activateLicense(key) → { success, error? }`, `checkPayment() → { success, message }`
  - `initAccount({ doc, auth }) → { checkPayment() }`; renders `#plan-badge`, `#account-plan`, `#account-initial` / `#account-icon`, `#signed-in` / `#signed-out`
  - `setBusy(button, busy)` (exported; reused by later tasks)
  - `NETWORK_ERROR = "Can't reach SubPIP. Check your connection and try again."`

- [ ] **Step 1: Write the failing tests** — create `tests/e2e/popup-account.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();

const account = (popup) => popup.evaluate(() => ({
  signedIn: !document.getElementById('signed-in').hidden,
  email: document.getElementById('account-email').textContent,
  plan: document.getElementById('account-plan').textContent,
  badge: document.getElementById('plan-badge').textContent,
  badgePremium: document.getElementById('plan-badge').classList.contains('premium'),
  initial: document.getElementById('account-initial').hidden ? null : document.getElementById('account-initial').textContent,
  freeActions: !document.getElementById('free-actions').hidden
}));

async function signIn(popup, email = 'tester@example.com', password = 'secret123') {
  await popup.click('#account-btn');
  await popup.type('#auth-email', email);
  await popup.type('#auth-password', password);
  await popup.click('#auth-submit');
}

test('signed out: sign-in form, mode switch renames the button', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  assert.equal((await account(popup)).signedIn, false);
  assert.equal(await popup.$eval('#auth-submit', (b) => b.textContent), 'Sign in');
  await popup.click('[data-mode="signup"]');
  assert.equal(await popup.$eval('#auth-submit', (b) => b.textContent), 'Create account');
  await popup.close();
});

test('signing in shows the account, Free plan and header initial', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await signIn(popup);
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.deepEqual(await account(popup), {
    signedIn: true, email: 'tester@example.com', plan: 'Free', badge: 'Free', badgePremium: false, initial: 'T', freeActions: true
  });
  assert.deepEqual((await ctx.storage()).subpipAuth, { uid: 'u1', email: 'tester@example.com', isPremium: false });
  await popup.close();
});

test('a premium account shows the Premium badge and hides purchase actions', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  const state = await account(popup);
  assert.equal(state.badgePremium, true);
  assert.equal(state.freeActions, false);
  await popup.close();
});

test('wrong password shows an inline error and re-enables the button', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub({ signIn: 'bad' }) });
  await signIn(popup);
  await popup.waitForSelector('#auth-error:not([hidden])');
  const state = await popup.evaluate(() => ({
    error: document.getElementById('auth-error').textContent,
    disabled: document.getElementById('auth-submit').disabled,
    busy: document.getElementById('auth-submit').classList.contains('busy')
  }));
  assert.deepEqual(state, { error: 'Invalid email or password', disabled: false, busy: false });
  await popup.close();
});

test('signing in offline shows a connection message', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub({ signIn: 'network' }) });
  await signIn(popup);
  await popup.waitForSelector('#auth-error:not([hidden])');
  assert.equal(await popup.$eval('#auth-error', (e) => e.textContent), "Can't reach SubPIP. Check your connection and try again.");
  assert.equal(await popup.$eval('#auth-submit', (b) => b.disabled), false);
  await popup.close();
});

test('empty fields are caught before any request', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  await popup.click('#auth-submit');
  assert.equal(await popup.$eval('#auth-error', (e) => e.textContent), 'Enter your email and password.');
  await popup.close();
});

test('a very long email never makes the popup scroll sideways', async () => {
  const email = `${'a'.repeat(60)}@example-company-with-a-long-name.com`;
  await ctx.signInAs({ email });
  const popup = await ctx.openPopup({ stub: firebaseStub({ email }) });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  const layout = await popup.evaluate(() => {
    const el = document.getElementById('account-email');
    const scroller = document.querySelector('.views');
    return { pageOverflow: document.documentElement.scrollWidth > 340, viewOverflow: scroller.scrollWidth > scroller.clientWidth, truncated: el.scrollWidth > el.clientWidth };
  });
  assert.deepEqual(layout, { pageOverflow: false, viewOverflow: false, truncated: true });
  await popup.close();
});

test('license activation reports success inline', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  await popup.type('#license-key', 'SUBPIP-ABCDEFGH-1234');
  await popup.click('#license-submit');
  await popup.waitForSelector('#license-success:not([hidden])');
  assert.equal(await popup.$eval('#license-success', (e) => e.textContent), 'Premium activated.');
  await popup.close();
});

test('sign out returns to the sign-in form and clears stored auth', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  await popup.click('#sign-out');
  await popup.waitForSelector('#signed-out:not([hidden])');
  assert.equal((await ctx.storage()).subpipAuth, undefined);
  await popup.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-account.test.js`
Expected: FAIL (signed-in section never shows; no error text).

- [ ] **Step 3: Auth state** — create `src/popup/auth.js`:

```js
// Who is signed in and whether they have Premium. Wraps LicenseManager and
// mirrors the result to chrome.storage.sync (subpipAuth) for the background
// and page scripts.

import { LicenseManager } from './license-manager.js';

export function createAuth(manager = new LicenseManager()) {
  let user = null;
  let premium = false;
  let notice = '';
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  async function refreshStatus() {
    premium = false;
    notice = '';
    if (user) {
      const status = await manager.getUserStatus(user.uid);
      if (status.success && status.data.isPremium) {
        const session = await manager.validateSession(user.uid);
        premium = session.valid;
        if (!session.valid) notice = session.error;
      }
      await chrome.storage.sync.set({ subpipAuth: { uid: user.uid, email: user.email, isPremium: premium } });
    } else {
      await chrome.storage.sync.remove('subpipAuth');
    }
    emit();
  }

  async function start(method, email, password) {
    const result = await manager[method](email, password);
    if (!result.success) return result;
    user = result.user;
    await refreshStatus();
    return { success: true };
  }

  return {
    user: () => user,
    isPremium: () => premium,
    notice: () => notice,
    onChange(fn) {
      listeners.add(fn);
    },
    async init() {
      await manager.init();
      user = manager.isLoggedIn() ? manager.getCurrentUser() : null;
      await refreshStatus();
    },
    signIn: (email, password) => start('signIn', email, password),
    signUp: (email, password) => start('signUp', email, password),
    async signOut() {
      await manager.signOut();
      user = null;
      await refreshStatus();
    },
    async activateLicense(key) {
      const result = await manager.activateLicense(key);
      if (result.success) await refreshStatus();
      return result;
    },
    async checkPayment() {
      const result = await manager.claimLicenseByEmail();
      if (result.emailNotVerified) {
        const sent = await manager.sendEmailVerification();
        return {
          success: false,
          message: sent.success
            ? `We sent a verification link to ${user.email}. Click it, then check again.`
            : 'Please verify your email, or paste your license key.'
        };
      }
      if (result.success) {
        await refreshStatus();
        return { success: true, message: `Premium activated. License: ${result.licenseKey}` };
      }
      return { success: false, message: result.error || 'No payment found for this email yet.' };
    }
  };
}
```

- [ ] **Step 4: Account page and header** — create `src/popup/account.js`:

```js
// Account & license page, plus the header's plan badge and account button

const PREMIUM_URL = 'https://subpip.vercel.app/premium.html';
export const NETWORK_ERROR = "Can't reach SubPIP. Check your connection and try again.";

function friendly(message) {
  if (/failed to fetch|network/i.test(message || '')) return NETWORK_ERROR;
  return message || 'Something went wrong. Please try again.';
}

export function setBusy(button, busy) {
  button.disabled = busy;
  button.classList.toggle('busy', busy);
  button.setAttribute('aria-busy', String(busy));
}

function say(el, text) {
  el.textContent = text || '';
  el.hidden = !text;
}

export function initAccount({ doc, auth }) {
  const $ = (id) => doc.getElementById(id);
  const modeTabs = [...doc.querySelectorAll('[data-mode]')];
  let mode = 'signin';

  function renderMode() {
    modeTabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)));
    $('auth-submit').textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    $('auth-password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    say($('auth-error'), '');
  }
  modeTabs.forEach((tab) => tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    renderMode();
  }));

  $('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) return say($('auth-error'), 'Enter your email and password.');
    if (mode === 'signup' && password.length < 6) return say($('auth-error'), 'Password must be at least 6 characters.');
    say($('auth-error'), '');
    setBusy($('auth-submit'), true);
    const result = mode === 'signin' ? await auth.signIn(email, password) : await auth.signUp(email, password);
    setBusy($('auth-submit'), false);
    if (result.success) $('auth-password').value = '';
    else say($('auth-error'), friendly(result.error));
  });

  $('license-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('license-key').value.trim();
    say($('license-success'), '');
    if (!key) return say($('license-error'), 'Enter your license key.');
    say($('license-error'), '');
    setBusy($('license-submit'), true);
    const result = await auth.activateLicense(key);
    setBusy($('license-submit'), false);
    if (result.success) {
      $('license-key').value = '';
      say($('license-success'), 'Premium activated.');
    } else {
      say($('license-error'), friendly(result.error));
    }
  });

  async function checkPayment() {
    say($('license-error'), '');
    say($('license-success'), '');
    setBusy($('check-payment'), true);
    const result = await auth.checkPayment();
    setBusy($('check-payment'), false);
    if (result.success) say($('license-success'), result.message);
    else say($('license-error'), friendly(result.message));
  }
  $('check-payment').addEventListener('click', checkPayment);

  $('sign-out').addEventListener('click', async () => {
    setBusy($('sign-out'), true);
    await auth.signOut();
    setBusy($('sign-out'), false);
  });

  doc.querySelectorAll('[data-action="get-premium"]').forEach((button) => {
    button.addEventListener('click', () => chrome.tabs.create({ url: PREMIUM_URL }));
  });

  function render() {
    const user = auth.user();
    const premium = auth.isPremium();
    $('signed-out').hidden = !!user;
    $('signed-in').hidden = !user;
    for (const badge of [$('plan-badge'), $('account-plan')]) {
      badge.textContent = premium ? 'Premium' : 'Free';
      badge.classList.toggle('premium', premium);
    }
    $('account-email').textContent = user ? user.email : '';
    $('account-email').title = user ? user.email : '';
    $('free-actions').hidden = premium;
    $('account-initial').textContent = user ? user.email.charAt(0).toUpperCase() : '';
    $('account-initial').hidden = !user;
    $('account-icon').hidden = !!user;
    if (auth.notice()) say($('license-error'), auth.notice());
  }

  auth.onChange(render);
  renderMode();
  render();
  return { checkPayment };
}
```

- [ ] **Step 5: Wire it** — replace the `DOMContentLoaded` handler in `src/popup/index.js` with:

```js
document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  const router = createRouter(document);
  const auth = createAuth();
  initAccount({ doc: document, auth });
  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));

  await auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error));
  document.body.dataset.ready = 'true';
});
```

and add the imports:

```js
import { createAuth } from './auth.js';
import { initAccount } from './account.js';
```

- [ ] **Step 6: Run the tests**

Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-account.test.js` → PASS (9 tests).

- [ ] **Step 7: Full suite, lint, commit**

```bash
npm run lint && npm run test
git add src/popup tests/e2e/popup-account.test.js
git commit -m "feat(popup): account page, auth state and header plan badge"
```

---

### Task 3: Settings store, caption preview, presets and Custom page

**Files:**
- Create: `src/popup/settings-store.js`, `src/popup/captions.js`, `tests/unit/settings-store.test.js`, `tests/unit/popup-captions.test.js`, `tests/e2e/popup-captions.test.js`
- Modify: `src/content/styles.js`, `src/popup/index.js`

**Interfaces:**
- Consumes: `withDefaults`, `applyCaptionPreset` (Part 1); `auth.isPremium()`, `auth.onChange` (Task 2); `router.go` (Task 1); test helpers `ctx.setSettings`, `ctx.storage`, `ctx.tabIdFor` (Task 1); `openPip` (Part 1).
- Produces:
  - `createSettingsStore(storage = chrome.storage.sync) → store` with `load()`, `get()`, `update(patch, { debounce = false }?)`, `flush()`, `subscribe(fn) → unsubscribe`. Saved object never contains `isPremium` or `uid`.
  - `SAVE_DELAY_MS = 300`
  - `captionStyle(settings) → { fontSize, fontFamily, color, background, textShadow }`
  - `TEXT_COLORS`, `BG_COLORS` (6 each)
  - `initCaptions({ doc, store, router, auth })`
  - From `src/content/styles.js`: `hexToRgba(hex, opacity)` and `captionTextShadow(settings)` are now exported.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/settings-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore, SAVE_DELAY_MS } from '../../src/popup/settings-store.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  const writes = [];
  return {
    data, writes,
    async get(keys) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); },
    async set(items) { writes.push(structuredClone(items)); Object.assign(data, items); }
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('load applies defaults and labels old settings as custom', async () => {
  const storage = fakeStorage({ subpipSettings: { fontSize: 22, isPremium: true } });
  const store = createSettingsStore(storage);
  const settings = await store.load();
  assert.equal(settings.fontSize, 22);
  assert.equal(settings.captionPreset, 'custom');
});

test('saving drops isPremium and uid', async () => {
  const storage = fakeStorage({ subpipSettings: { fontSize: 22, isPremium: true, uid: 'x' } });
  const store = createSettingsStore(storage);
  await store.load();
  await store.update({ fontSize: 24 });
  const saved = storage.data.subpipSettings;
  assert.equal(saved.fontSize, 24);
  assert.equal('isPremium' in saved, false);
  assert.equal('uid' in saved, false);
});

test('debounced updates write once with the final value', async () => {
  const storage = fakeStorage();
  const store = createSettingsStore(storage);
  await store.load();
  for (let size = 20; size <= 29; size++) store.update({ fontSize: size }, { debounce: true });
  assert.equal(storage.writes.length, 0);
  await wait(SAVE_DELAY_MS + 50);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].subpipSettings.fontSize, 29);
});

test('flush writes a pending debounced change immediately', async () => {
  const storage = fakeStorage();
  const store = createSettingsStore(storage);
  await store.load();
  store.update({ fontSize: 31 }, { debounce: true });
  await store.flush();
  assert.equal(storage.data.subpipSettings.fontSize, 31);
  await wait(SAVE_DELAY_MS + 50);
  assert.equal(storage.writes.length, 1);
});

test('subscribers see every change, including before the save', async () => {
  const store = createSettingsStore(fakeStorage());
  await store.load();
  const seen = [];
  store.subscribe((s) => seen.push(s.fontSize));
  store.update({ fontSize: 25 }, { debounce: true });
  assert.deepEqual(seen, [25]);
});
```

`tests/unit/popup-captions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionStyle, TEXT_COLORS, BG_COLORS } from '../../src/popup/captions.js';
import { withDefaults, CAPTION_PRESETS } from '../../src/shared/settings.js';

test('preview style follows the classic preset', () => {
  assert.deepEqual(captionStyle(withDefaults()), {
    fontSize: '18px', fontFamily: 'sans-serif', color: '#ffffff',
    background: 'rgba(0, 0, 0, 0.75)', textShadow: '0 0 3px black, 0 0 5px black'
  });
});

test('preview style uses the outline shadow for the outline preset', () => {
  const style = captionStyle(withDefaults(CAPTION_PRESETS.outline));
  assert.equal(style.background, 'rgba(0, 0, 0, 0)');
  assert.match(style.textShadow, /1px 1px 0 #000/);
});

test('six swatches each', () => {
  assert.equal(TEXT_COLORS.length, 6);
  assert.equal(BG_COLORS.length, 6);
});
```

- [ ] **Step 2: Write the failing e2e tests** — `tests/e2e/popup-captions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { openPip, pipEval } from '../helpers/pip.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const pressed = (popup) => popup.$$eval('.chip[aria-pressed="true"]', (chips) => chips.map((c) => c.dataset.preset));
const previewFont = (popup, id = 'home-preview') => popup.$eval(`#${id} .preview-caption`, (el) => el.style.fontSize);
const setRange = (popup, id, values) => popup.evaluate((rangeId, list) => {
  const input = document.getElementById(rangeId);
  for (const value of list) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, id, values);

test('preview and chips reflect stored settings', async () => {
  await ctx.setSettings({ fontSize: 30, captionPreset: 'custom' });
  const popup = await ctx.openPopup();
  assert.equal(await previewFont(popup), '30px');
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.close();
});

test('choosing a preset applies and saves it at once', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="large"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.equal(saved.captionPreset, 'large');
  assert.equal(saved.fontSize, 26);
  assert.deepEqual(await pressed(popup), ['large']);
  assert.equal(await previewFont(popup), '26px');
  await popup.close();
});

test('Custom opens its page; a fast slider drag saves only the final value', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'Custom style');
  await setRange(popup, 'size', [20, 22, 25, 28, 31, 33]);
  assert.equal(await previewFont(popup, 'custom-preview'), '33px');
  assert.equal((await ctx.storage()).subpipSettings, undefined);
  await sleep(500);
  const saved = (await ctx.storage()).subpipSettings;
  assert.equal(saved.fontSize, 33);
  assert.equal(saved.captionPreset, 'custom');
  await popup.keyboard.press('Escape');
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.close();
});

test('closing the popup mid-drag still saves the last value', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  await setRange(popup, 'opacity', [40, 45, 50]);
  await popup.close();
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.bgOpacity, 50);
});

test('swatches, font, outline and position save instantly', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  await popup.click('#text-swatches .swatch[data-color="#ffe14d"]');
  await popup.select('#font', 'serif');
  await popup.click('#outline');
  await popup.click('[data-position="top"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.deepEqual(
    { textColor: saved.textColor, fontFamily: saved.fontFamily, captionOutline: saved.captionOutline, captionPosition: saved.captionPosition, captionPreset: saved.captionPreset },
    { textColor: '#ffe14d', fontFamily: 'serif', captionOutline: true, captionPosition: 'top', captionPreset: 'custom' }
  );
  assert.equal(await popup.$eval('#custom-preview', (el) => el.dataset.position), 'top');
  await popup.close();
});

test('subtitle URL is a Premium field for free users', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="custom"]');
  const field = await popup.evaluate(() => ({ disabled: document.getElementById('subs-url').disabled, tag: !document.getElementById('subs-tag').hidden }));
  assert.deepEqual(field, { disabled: true, tag: true });
  await popup.close();
});

test('subtitle URL is editable for premium users', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => !document.getElementById('subs-url').disabled);
  await popup.click('.chip[data-preset="custom"]');
  await popup.type('#subs-url', 'https://example.com/a.vtt');
  await sleep(500);
  assert.equal((await ctx.storage()).subpipSettings.externalSubtitleUrl, 'https://example.com/a.vtt');
  await popup.close();
});

test('changes reach an open PiP window live', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const tabId = await ctx.tabIdFor(page.url());
  await ctx.worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['translate-relay.js'] }), tabId);
  const popup = await ctx.openPopup();
  await popup.click('.chip[data-preset="large"]');
  await page.waitForFunction(() => window.__SUBPIP_SETTINGS__?.fontSize === 26, { timeout: 3000 });
  assert.match(await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent), /font-size: 26px/);
  await popup.close();
  await page.close();
});

test('old settings show as Custom and lose their stale isPremium on save', async () => {
  await ctx.setSettings({ fontSize: 22, isPremium: true });
  const popup = await ctx.openPopup();
  assert.deepEqual(await pressed(popup), ['custom']);
  await popup.click('.chip[data-preset="classic"]');
  await sleep(100);
  assert.equal('isPremium' in (await ctx.storage()).subpipSettings, false);
  await popup.close();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:unit` → FAIL (modules missing).
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-captions.test.js` → FAIL.

- [ ] **Step 4: Export the caption helpers** — in `src/content/styles.js`:

1. Change `function hexToRgba(hex, opacity) {` to `export function hexToRgba(hex, opacity) {`.
2. Add after `hexToRgba`:

```js
// Soft glow by default; a hard four-way outline when captionOutline is on
export function captionTextShadow(settings) {
  return settings.captionOutline
    ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000'
    : '0 0 3px black, 0 0 5px black';
}
```

3. In `generateSubtitleStyles`, replace the `const textShadow = settings.captionOutline ? ... : ...;` statement (3 lines) with:

```js
  const textShadow = captionTextShadow(settings);
```

- [ ] **Step 5: Settings store** — create `src/popup/settings-store.js`:

```js
// The popup's settings: one in-memory copy that saves to chrome.storage.sync
// as it changes. Open pages pick changes up through the relay.

import { withDefaults } from '../shared/settings.js';

export const SAVE_DELAY_MS = 300;

export function createSettingsStore(storage = chrome.storage.sync) {
  let settings = withDefaults();
  let timer = null;
  const listeners = new Set();

  // Premium status and uid come from sign-in (subpipAuth), never from here
  function write() {
    clearTimeout(timer);
    timer = null;
    const { isPremium, uid, ...toSave } = settings; // eslint-disable-line no-unused-vars
    return storage.set({ subpipSettings: toSave });
  }

  return {
    async load() {
      const { subpipSettings } = await storage.get(['subpipSettings']);
      settings = withDefaults(subpipSettings);
      listeners.forEach((fn) => fn(settings));
      return settings;
    },
    get: () => settings,
    update(patch, { debounce = false } = {}) {
      settings = { ...settings, ...patch };
      listeners.forEach((fn) => fn(settings));
      clearTimeout(timer);
      if (debounce) {
        timer = setTimeout(write, SAVE_DELAY_MS);
        return Promise.resolve();
      }
      return write();
    },
    flush() {
      return timer ? write() : Promise.resolve();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}
```

- [ ] **Step 6: Captions** — create `src/popup/captions.js`:

```js
// Caption style in the popup: live previews, preset chips and the Custom page

import { applyCaptionPreset } from '../shared/settings.js';
import { captionTextShadow, hexToRgba } from '../content/styles.js';

export const TEXT_COLORS = ['#ffffff', '#ffe14d', '#7cf0ff', '#9dff7a', '#ff9ad5', '#000000'];
export const BG_COLORS = ['#000000', '#1f2937', '#1e3a8a', '#3f1d5c', '#5c1d1d', '#ffffff'];

export function captionStyle(settings) {
  return {
    fontSize: `${settings.fontSize}px`,
    fontFamily: settings.fontFamily,
    color: settings.textColor,
    background: hexToRgba(settings.bgColor, settings.bgOpacity),
    textShadow: captionTextShadow(settings)
  };
}

export function initCaptions({ doc, store, router, auth }) {
  const $ = (id) => doc.getElementById(id);
  const previews = [$('home-preview'), $('custom-preview')];
  const chips = [...doc.querySelectorAll('.chip[data-preset]')];
  const positionButtons = [...doc.querySelectorAll('[data-position]')];
  const size = $('size');
  const opacity = $('opacity');
  const font = $('font');
  const outline = $('outline');
  const subsUrl = $('subs-url');

  // Any caption-style edit makes the look "custom"
  const custom = (patch, options) => store.update({ ...patch, captionPreset: 'custom' }, options);

  chips.forEach((chip) => chip.addEventListener('click', () => {
    const name = chip.dataset.preset;
    if (name === 'custom') router.go('custom');
    else store.update(applyCaptionPreset(store.get(), name));
  }));

  function buildSwatches(container, colors, key) {
    for (const color of colors) {
      const swatch = doc.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.setAttribute('role', 'radio');
      swatch.setAttribute('aria-label', color);
      swatch.addEventListener('click', () => custom({ [key]: color }));
      container.append(swatch);
    }
    const picker = doc.createElement('input');
    picker.type = 'color';
    picker.className = 'swatch-custom';
    picker.setAttribute('aria-label', 'Custom color');
    picker.title = 'Custom color';
    picker.addEventListener('input', () => custom({ [key]: picker.value }, { debounce: true }));
    container.append(picker);
  }
  buildSwatches($('text-swatches'), TEXT_COLORS, 'textColor');
  buildSwatches($('bg-swatches'), BG_COLORS, 'bgColor');

  size.addEventListener('input', () => custom({ fontSize: Number(size.value) }, { debounce: true }));
  opacity.addEventListener('input', () => custom({ bgOpacity: Number(opacity.value) }, { debounce: true }));
  font.addEventListener('change', () => custom({ fontFamily: font.value }));
  outline.addEventListener('change', () => custom({ captionOutline: outline.checked }));
  // Position is not part of a preset, so it doesn't switch to custom
  positionButtons.forEach((button) => button.addEventListener('click', () => store.update({ captionPosition: button.dataset.position })));
  subsUrl.addEventListener('input', () => store.update({ externalSubtitleUrl: subsUrl.value.trim() }, { debounce: true }));

  function render(settings) {
    for (const preview of previews) {
      Object.assign(preview.querySelector('.preview-caption').style, captionStyle(settings));
      preview.dataset.position = settings.captionPosition;
    }
    chips.forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.preset === settings.captionPreset)));
    size.value = settings.fontSize;
    $('size-out').textContent = `${settings.fontSize}px`;
    opacity.value = settings.bgOpacity;
    $('opacity-out').textContent = `${settings.bgOpacity}%`;
    font.value = settings.fontFamily;
    outline.checked = !!settings.captionOutline;
    positionButtons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.position === settings.captionPosition)));
    for (const [id, key] of [['text-swatches', 'textColor'], ['bg-swatches', 'bgColor']]) {
      $(id).querySelectorAll('.swatch').forEach((swatch) => swatch.setAttribute('aria-checked', String(swatch.dataset.color === settings[key])));
      $(id).querySelector('.swatch-custom').value = settings[key];
    }
    if (doc.activeElement !== subsUrl) subsUrl.value = settings.externalSubtitleUrl || '';
  }

  function renderPremium() {
    const premium = auth.isPremium();
    subsUrl.disabled = !premium;
    $('subs-tag').hidden = premium;
  }

  store.subscribe(render);
  auth.onChange(renderPremium);
  render(store.get());
  renderPremium();
}
```

- [ ] **Step 7: Wire it** — in `src/popup/index.js` add the imports:

```js
import { createSettingsStore } from './settings-store.js';
import { initCaptions } from './captions.js';
```

and replace the `DOMContentLoaded` handler with:

```js
document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  const router = createRouter(document);
  const store = createSettingsStore();
  const auth = createAuth();
  initAccount({ doc: document, auth });
  initCaptions({ doc: document, store, router, auth });
  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));
  // Save anything still waiting on the slider debounce when the popup closes
  window.addEventListener('pagehide', () => { store.flush(); });

  await Promise.all([
    store.load(),
    auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error))
  ]);
  document.body.dataset.ready = 'true';
});
```

- [ ] **Step 8: Run the tests**

Run: `npm run test:unit` → PASS.
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-captions.test.js` → PASS (9 tests).

- [ ] **Step 9: Full suite, lint, commit**

```bash
npm run lint && npm run test
git add src/popup src/content/styles.js tests
git commit -m "feat(popup): live caption preview, presets and custom style page"
```

---

### Task 4: Page status card and Open/Close button

**Files:**
- Create: `src/popup/status.js`, `src/popup/home.js`, `tests/fixtures/novideo.html`, `tests/unit/popup-status.test.js`, `tests/e2e/popup-status.test.js`
- Modify: `src/content/adapters.js`, `src/popup/index.js`

**Interfaces:**
- Consumes: `getSiteAdapter(hostname)` (existing); `store.get()`, `store.flush()` (Task 3); `auth.isPremium()`, `auth.user()` (Task 2).
- Produces:
  - Each site adapter gains `label`: youtube `'YouTube'`, netflix `'Netflix'`, hotstar `'Disney+ Hotstar'`, jiocinema `'JioCinema'`, crunchyroll `'Crunchyroll'`.
  - `getTargetTab() → Promise<Tab | null>`; `detectPage(tab) → Promise<{ state: 'video' | 'pip' | 'none' | 'restricted', host?, captionSource? }>`; `describeStatus(status) → { title, sub }` (also handles `{ state: 'loading' }`).
  - `initHome({ doc, store, auth }) → { refresh() }`.

- [ ] **Step 1: Write the failing tests**

`tests/fixtures/novideo.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><link rel="icon" href="data:,"><title>no video</title></head>
<body><p>Just text.</p></body>
</html>
```

`tests/unit/popup-status.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus } from '../../src/popup/status.js';

test('status copy matches the spec', () => {
  assert.deepEqual(describeStatus({ state: 'video', host: 'youtube.com', captionSource: 'YouTube' }),
    { title: 'Video found on youtube.com', sub: 'Captions: YouTube' });
  assert.deepEqual(describeStatus({ state: 'video', host: 'example.com', captionSource: null }),
    { title: 'Video found on example.com', sub: 'No captions detected' });
  assert.deepEqual(describeStatus({ state: 'pip', host: 'netflix.com' }),
    { title: 'Playing in Picture-in-Picture', sub: 'on netflix.com' });
  assert.deepEqual(describeStatus({ state: 'none' }),
    { title: 'No video on this page', sub: 'Play a video, then open SubPIP' });
  assert.deepEqual(describeStatus({ state: 'restricted' }),
    { title: "SubPIP can't run on this page", sub: 'Chrome pages and the Web Store are off-limits' });
  assert.deepEqual(describeStatus({ state: 'loading' }), { title: 'Checking this page…', sub: '' });
});
```

`tests/e2e/popup-status.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';
import { openPip } from '../helpers/pip.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const status = (popup) => popup.evaluate(() => ({
  state: document.getElementById('status').dataset.state,
  title: document.getElementById('status-title').textContent,
  sub: document.getElementById('status-sub').textContent,
  button: document.getElementById('pip-btn').textContent,
  disabled: document.getElementById('pip-btn').disabled
}));

test('a page with a video and a text track', async () => {
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  assert.deepEqual(await status(popup), {
    state: 'video', title: 'Video found on 127.0.0.1', sub: 'Captions: page text track', button: 'Open Picture-in-Picture', disabled: false
  });
  await popup.close();
  await page.close();
});

test('a supported site names its caption source', async () => {
  const page = await ctx.newPage('youtube.html', 'youtube.localhost');
  const popup = await ctx.openPopup();
  assert.equal((await status(popup)).sub, 'Captions: YouTube');
  await popup.close();
  await page.close();
});

test('a page without a video disables the button', async () => {
  const page = await ctx.newPage('novideo.html');
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.equal(s.title, 'No video on this page');
  assert.equal(s.disabled, true);
  await popup.close();
  await page.close();
});

test('chrome:// pages are off-limits', async () => {
  const page = await ctx.newPage('novideo.html');
  await page.goto('chrome://version');
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.equal(s.title, "SubPIP can't run on this page");
  assert.equal(s.disabled, true);
  await popup.close();
  await page.close();
});

test('a browser error page is handled as off-limits', async () => {
  const page = await ctx.newPage('novideo.html');
  await page.goto('http://127.0.0.1:1/').catch(() => {});
  const popup = await ctx.openPopup();
  assert.equal((await status(popup)).state, 'restricted');
  assert.deepEqual(popup.errors, []);
  await popup.close();
  await page.close();
});

test('an open PiP window offers Close', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const popup = await ctx.openPopup();
  const s = await status(popup);
  assert.deepEqual({ title: s.title, sub: s.sub, button: s.button }, {
    title: 'Playing in Picture-in-Picture', sub: 'on 127.0.0.1', button: 'Close Picture-in-Picture'
  });
  await popup.close();
  await page.close();
});

test('Open injects SubPIP into the page with the current settings', async () => {
  await ctx.setSettings({ fontSize: 24 });
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  await popup.click('#pip-btn');
  await sleep(1000);
  const injected = await page.evaluate(() => ({ instance: !!window.__SUBPIP__, fontSize: window.__SUBPIP_SETTINGS__?.fontSize }));
  assert.deepEqual(injected, { instance: true, fontSize: 24 });
  await page.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit` → FAIL (`status.js` missing).
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-status.test.js` → FAIL (status stays "loading").

- [ ] **Step 3: Adapter labels** — in `src/content/adapters.js`, add a `label` line after each `name` line:

| name | label line to add |
|---|---|
| `'youtube'` | `label: 'YouTube',` |
| `'netflix'` | `label: 'Netflix',` |
| `'hotstar'` | `label: 'Disney+ Hotstar',` |
| `'jiocinema'` | `label: 'JioCinema',` |
| `'crunchyroll'` | `label: 'Crunchyroll',` |

Also extend the comment block above `SITE_ADAPTERS` with the line `//   label            - site name shown in the popup ("Captions: YouTube")`.

- [ ] **Step 4: Status** — create `src/popup/status.js`:

```js
// What the popup is about to act on: the target tab and whether it has a
// video, an open PiP window, or can't be scripted at all.

import { getSiteAdapter } from '../content/adapters.js';

const RESTRICTED = [
  /^chrome:/, /^chrome-extension:/, /^edge:/, /^about:/, /^view-source:/, /^devtools:/,
  /^https:\/\/chromewebstore\.google\.com\//, /^https:\/\/chrome\.google\.com\/webstore/
];

export async function getTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !(tab.url || '').startsWith(chrome.runtime.getURL(''))) return tab;
  // Popup opened in its own window: use the active tab of the last normal window
  const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

// Runs in the page (must be self-contained)
function probePage() {
  const pipOpen = !!(window.documentPictureInPicture && window.documentPictureInPicture.window);
  const videos = [...document.querySelectorAll('video')];
  const hasTextTrack = videos.some((video) => [...video.textTracks].some((track) => track.kind === 'subtitles' || track.kind === 'captions'));
  return { host: location.hostname, pipOpen, hasVideo: videos.length > 0, hasTextTrack };
}

export async function detectPage(tab) {
  if (!tab || !tab.url || RESTRICTED.some((pattern) => pattern.test(tab.url))) return { state: 'restricted' };
  let probe;
  try {
    [{ result: probe }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: probePage });
  } catch {
    return { state: 'restricted' }; // error pages, PDFs, pages we lack access to
  }
  if (!probe) return { state: 'restricted' };
  const host = probe.host.replace(/^www\./, '');
  const adapter = getSiteAdapter(probe.host);
  const captionSource = adapter.label || (probe.hasTextTrack ? 'page text track' : null);
  const state = probe.pipOpen ? 'pip' : probe.hasVideo ? 'video' : 'none';
  return { state, host, captionSource };
}

export function describeStatus(status) {
  switch (status.state) {
    case 'video':
      return { title: `Video found on ${status.host}`, sub: status.captionSource ? `Captions: ${status.captionSource}` : 'No captions detected' };
    case 'pip':
      return { title: 'Playing in Picture-in-Picture', sub: `on ${status.host}` };
    case 'none':
      return { title: 'No video on this page', sub: 'Play a video, then open SubPIP' };
    case 'restricted':
      return { title: "SubPIP can't run on this page", sub: 'Chrome pages and the Web Store are off-limits' };
    default:
      return { title: 'Checking this page…', sub: '' };
  }
}
```

- [ ] **Step 5: Home** — create `src/popup/home.js`:

```js
// Home: the page status card and the Open / Close Picture-in-Picture button

import { getTargetTab, detectPage, describeStatus } from './status.js';

export function initHome({ doc, store, auth }) {
  const $ = (id) => doc.getElementById(id);
  const button = $('pip-btn');
  let tab = null;

  function render(status) {
    $('status').dataset.state = status.state;
    const { title, sub } = describeStatus(status);
    $('status-title').textContent = title;
    $('status-sub').textContent = sub;
    button.disabled = !(status.state === 'video' || status.state === 'pip');
    button.textContent = status.state === 'pip' ? 'Close Picture-in-Picture' : 'Open Picture-in-Picture';
  }

  // Inject straight from the popup: the shorter the chain, the better the
  // page's user activation survives for requestWindow. A second run closes.
  button.addEventListener('click', async () => {
    if (!tab) return;
    const settings = { ...store.get(), isPremium: auth.isPremium(), uid: auth.user()?.uid };
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (s) => { window.__SUBPIP_SETTINGS__ = s; window.__SUBPIP_RUN__ = true; },
        args: [settings]
      });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['script.js'] });
      // Then save and add the relay (translation + live settings)
      await store.flush();
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['translate-relay.js'] });
    } catch (error) {
      console.warn('[SubPIP] Could not start Picture-in-Picture:', error);
    }
    window.close();
  });

  render({ state: 'loading' });
  return {
    async refresh() {
      tab = await getTargetTab();
      render(await detectPage(tab));
    }
  };
}
```

- [ ] **Step 6: Wire it** — in `src/popup/index.js` add `import { initHome } from './home.js';`, add this line after `initCaptions(...)`:

```js
  const home = initHome({ doc: document, store, auth });
```

and add `home.refresh(),` as the first entry of the `Promise.all([...])` list.

- [ ] **Step 7: Run the tests**

Run: `npm run test:unit` → PASS.
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-status.test.js` → PASS (7 tests).

- [ ] **Step 8: Full suite, lint, commit**

```bash
npm run lint && npm run test
git add src/popup src/content/adapters.js tests
git commit -m "feat(popup): page status card and Open/Close button"
```

---

### Task 5: Option rows, Translate / Speed / Auto PiP pages, Premium gating

**Files:**
- Create: `src/popup/options.js`, `tests/e2e/popup-options.test.js`
- Modify: `src/shared/settings.js`, `src/content/settings-menu.js`, `tests/unit/settings.test.js`, `src/popup/index.js`

**Interfaces:**
- Consumes: `LANGUAGES`, `ALL_SITES` (existing); `iconMarkup` (Part 1); `store` (Task 3); `auth` (Task 2); `router` (Task 1); `account.checkPayment()` (Task 2).
- Produces: `SPEEDS` exported from `src/shared/settings.js` (`[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]`); `initOptions({ doc, store, auth, router })`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/settings.test.js`:

```js
test('shared playback speeds', async () => {
  const { SPEEDS } = await import('../../src/shared/settings.js');
  assert.deepEqual(SPEEDS, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
});
```

Create `tests/e2e/popup-options.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';
import { sleep } from '../helpers/browser.js';

const ctx = useExtension();

const rows = (popup) => popup.evaluate(() => Object.fromEntries(
  [...document.querySelectorAll('.row')].map((row) => [row.dataset.go, row.querySelector('.row-value').textContent])
));
const view = (popup) => popup.evaluate(() => [...document.querySelectorAll('.view')].find((v) => !v.hidden).dataset.view);

async function premiumPopup() {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  return popup;
}

test('free users see Premium tags and reach the upgrade page', async () => {
  const popup = await ctx.openPopup();
  assert.deepEqual(await rows(popup), { translate: 'Premium', speed: 'Premium', autopip: 'Off', account: 'Sign in' });
  await popup.click('.row[data-go="translate"]');
  assert.equal(await view(popup), 'upgrade');
  assert.equal(await popup.$eval('#page-title', (el) => el.textContent), 'SubPIP Premium');
  await popup.close();
});

test('upgrade page: "Already paid?" while signed out goes to the account page', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="speed"]');
  await popup.click('#upgrade-check-payment');
  assert.equal(await view(popup), 'account');
  await popup.close();
});

test('premium: turning on translation and picking a language', async () => {
  const popup = await premiumPopup();
  assert.equal((await rows(popup)).translate, 'Off');
  await popup.click('.row[data-go="translate"]');
  assert.equal(await view(popup), 'translate');
  await popup.click('#language-list .radio[data-value="es"]');
  await sleep(100);
  const saved = (await ctx.storage()).subpipSettings;
  assert.deepEqual({ on: saved.translationEnabled, lang: saved.targetLanguage }, { on: true, lang: 'es' });
  assert.equal(await popup.$eval('#translate-on', (el) => el.checked), true);
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).translate, 'Spanish');
  await popup.close();
});

test('premium: default playback speed', async () => {
  const popup = await premiumPopup();
  await popup.click('.row[data-go="speed"]');
  await popup.click('#speed-list .radio[data-value="1.5"]');
  await sleep(100);
  assert.equal((await ctx.storage()).subpipSettings.playbackSpeed, 1.5);
  assert.equal(await popup.$eval('#speed-list .radio[aria-checked="true"]', (el) => el.dataset.value), '1.5');
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).speed, '1.5×');
  await popup.close();
});

test('auto PiP explains itself and turns on', async () => {
  const popup = await ctx.openPopup();
  await popup.click('.row[data-go="autopip"]');
  assert.match(await popup.$eval('[data-view="autopip"] .paragraph', (el) => el.textContent), /access to all sites/);
  await popup.click('#autopip-on');
  await sleep(300);
  assert.equal((await ctx.storage()).subpipSettings.autoPip, true);
  await popup.click('#back-btn');
  assert.equal((await rows(popup)).autopip, 'On');
  await popup.close();
});

test('the account row shows the signed-in email', async () => {
  await ctx.signInAs({ email: 'me@example.com' });
  const popup = await ctx.openPopup({ stub: firebaseStub({ email: 'me@example.com' }) });
  await popup.waitForFunction(() => document.getElementById('account-value').textContent === 'me@example.com');
  await popup.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit` → FAIL (`SPEEDS` undefined).
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-options.test.js` → FAIL (row values empty).

- [ ] **Step 3: Shared speeds** — in `src/shared/settings.js`, add after `CAPTION_SIZES`:

```js
// Playback speeds offered in the popup and the PiP menu
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
```

In `src/content/settings-menu.js`, change the import to `import { CAPTION_SIZES, LANGUAGES, SPEEDS } from '../shared/settings.js';` and delete the line `const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];`.

- [ ] **Step 4: Options** — create `src/popup/options.js`:

```js
// Home option rows and their pages: Translate, Playback speed, Auto PiP.
// Premium rows send free users to the upgrade page instead.

import { LANGUAGES, SPEEDS, ALL_SITES } from '../shared/settings.js';
import { iconMarkup } from '../shared/icons.js';

export function initOptions({ doc, store, auth, router }) {
  const $ = (id) => doc.getElementById(id);
  const languageName = (code) => (LANGUAGES.find((lang) => lang.code === code) || { name: code }).name;
  let autoPipAllowed = false;

  doc.querySelectorAll('.row[data-go]').forEach((row) => row.addEventListener('click', () => {
    router.go(row.hasAttribute('data-premium') && !auth.isPremium() ? 'upgrade' : row.dataset.go);
  }));

  function setRowValue(id, text) {
    const cell = $(id);
    if (text === null) {
      const tag = doc.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Premium';
      cell.replaceChildren(tag);
    } else {
      cell.textContent = text;
    }
  }

  function radioList(container, items, onPick) {
    container.replaceChildren(...items.map(({ value, label }) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'radio';
      button.setAttribute('role', 'radio');
      button.dataset.value = String(value);
      const text = doc.createElement('span');
      text.textContent = label;
      const check = doc.createElement('span');
      check.className = 'icon';
      check.innerHTML = iconMarkup('check');
      button.append(text, check);
      button.addEventListener('click', () => onPick(value));
      return button;
    }));
  }
  const markChecked = (container, value) => container.querySelectorAll('.radio')
    .forEach((button) => button.setAttribute('aria-checked', String(button.dataset.value === String(value))));

  radioList($('language-list'), LANGUAGES.map((lang) => ({ value: lang.code, label: lang.name })),
    (code) => store.update({ targetLanguage: code, translationEnabled: true }));
  radioList($('speed-list'), SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` })),
    (speed) => store.update({ playbackSpeed: speed }));
  $('translate-on').addEventListener('change', () => store.update({ translationEnabled: $('translate-on').checked }));

  // Auto PiP needs SubPIP on every site: ask for that access only when it is
  // turned on (the request must happen inside this click)
  $('autopip-on').addEventListener('change', async () => {
    const toggle = $('autopip-on');
    const error = $('autopip-error');
    error.hidden = true;
    if (toggle.checked) {
      autoPipAllowed = await chrome.permissions.request(ALL_SITES);
      if (!autoPipAllowed) {
        toggle.checked = false;
        error.textContent = 'SubPIP needs access to all sites for Auto PiP.';
        error.hidden = false;
        return;
      }
    } else {
      await chrome.permissions.remove(ALL_SITES);
      autoPipAllowed = false;
    }
    store.update({ autoPip: toggle.checked });
  });

  function render() {
    const settings = store.get();
    const premium = auth.isPremium();
    const autoPip = !!settings.autoPip && autoPipAllowed;
    setRowValue('translate-value', premium ? (settings.translationEnabled ? languageName(settings.targetLanguage) : 'Off') : null);
    setRowValue('speed-value', premium ? `${settings.playbackSpeed}×` : null);
    setRowValue('autopip-value', autoPip ? 'On' : 'Off');
    setRowValue('account-value', auth.user() ? auth.user().email : 'Sign in');
    $('translate-on').checked = !!settings.translationEnabled;
    $('language-list').setAttribute('aria-disabled', String(!settings.translationEnabled));
    markChecked($('language-list'), settings.targetLanguage);
    markChecked($('speed-list'), settings.playbackSpeed);
    $('autopip-on').checked = autoPip;
  }

  store.subscribe(render);
  auth.onChange(render);
  chrome.permissions.contains(ALL_SITES).then((allowed) => {
    autoPipAllowed = allowed;
    render();
  });
  render();
}
```

- [ ] **Step 5: Final wiring** — replace all of `src/popup/index.js` with:

```js
// SubPIP popup: wires the pages together

import { iconMarkup } from '../shared/icons.js';
import { createRouter } from './router.js';
import { createAuth } from './auth.js';
import { initAccount } from './account.js';
import { createSettingsStore } from './settings-store.js';
import { initCaptions } from './captions.js';
import { initHome } from './home.js';
import { initOptions } from './options.js';

// Extension page, so icon markup strings are fine here (unlike page scripts)
function renderIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.classList.add('icon');
    el.innerHTML = iconMarkup(el.dataset.icon);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  renderIcons(document);
  const router = createRouter(document);
  const store = createSettingsStore();
  const auth = createAuth();
  const account = initAccount({ doc: document, auth });
  initCaptions({ doc: document, store, router, auth });
  const home = initHome({ doc: document, store, auth });
  initOptions({ doc: document, store, auth, router });

  document.getElementById('account-btn').addEventListener('click', () => router.go('account'));
  document.getElementById('upgrade-check-payment').addEventListener('click', () => {
    router.go('account');
    if (auth.user()) account.checkPayment();
  });
  // Save anything still waiting on the slider debounce when the popup closes
  window.addEventListener('pagehide', () => { store.flush(); });

  await Promise.all([
    home.refresh(),
    store.load(),
    auth.init().catch((error) => console.warn('[SubPIP] Could not restore sign-in:', error))
  ]);
  document.body.dataset.ready = 'true';
});
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:unit` → PASS.
Run: `npm run build && node --test --test-concurrency=1 tests/e2e/popup-options.test.js` → PASS (6 tests).

- [ ] **Step 7: Full suite, lint, commit**

```bash
npm run lint && npm run test
git add src/popup src/shared/settings.js src/content/settings-menu.js tests
git commit -m "feat(popup): option rows, translate/speed/auto-PiP pages and premium gating"
```

---

### Task 6: Final verification for Part 2

**Files:** none new.

- [ ] **Step 1: Full check**

Run: `npm run lint && npm run test && npm run build`
Expected: lint clean; all unit and e2e tests pass; build prints four bundles.

- [ ] **Step 2: Screenshots for the owner** — open the popup (as the tests do) in these states and screenshot each at 340px wide: home (signed out, on `generic.html`), home (premium, PiP open), Custom style page, Account page signed in (free), Upgrade page. Compare against the approved mockup (spec §3; Cinema direction) and fix any visual defect found, with a test when behavior is involved.

- [ ] **Step 3: Manual pass in Google Chrome** — load `dist/` unpacked, click the toolbar icon on a YouTube video page: status says "Video found on youtube.com · Captions: YouTube"; Open starts PiP; reopening the popup offers Close; presets restyle the open PiP captions live; sign in, activate/check payment and sign out behave; Alt+P opens the popup.

- [ ] **Step 4: Report** — summarize visual changes, test counts, anything the manual pass could not cover, and wait for the owner's review before the website plan (spec §7).
