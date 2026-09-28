# UI Redesign, Part 1: Foundation + PiP Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared design foundation (tokens in code, icons, logo, caption presets) and replace the PiP window's text-button controls with the Cinema-style bottom bar + settings menu, isolated in a Shadow DOM.

**Architecture:** The PiP script (`src/content/`, bundled by esbuild into `dist/script.js`) opens a Document PiP window. New controls live in a `<subpip-controls>` host with an open shadow root so site stylesheets copied into the PiP window cannot restyle them; all DOM is built with `createElement`/`createElementNS` (no `innerHTML`) because YouTube enforces Trusted Types. Captions stay outside the shadow root and are moved above the bar with a CSS variable read by the caption styles. Session-only overrides (caption size, translation language) layer over saved settings without writing them back.

**Tech Stack:** Vanilla JS (ES modules), esbuild, Node 22+ `node:test`, puppeteer-core driving a local Chrome/Brave (headed; Document PiP needs a real window), ffmpeg (one-time fixture generation).

**Spec:** `docs/superpowers/specs/2026-09-28-ui-redesign-design.md` (this plan covers §1, §2, §4 and the PiP part of §6; the popup and website get their own plans after this part is reviewed; `web/logo.svg` from §1.4 is created in the website plan).

## Global Constraints

- Colors: `--bg #0b0b0c`, `--surface #111214`, `--card #17181b`, `--border #25262a`, `--text #f2f2f2`, `--text-2 #8b8d93`, `--accent #ff4d5e`, `--accent-soft rgba(255,77,94,0.15)`, `--accent-text #ff7a86`, `--success #3ecf8e`, `--danger-text #ff8a8a`; radius 8px (controls) / 12px (cards, menus). No gradients on buttons.
- Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. No web fonts in the extension.
- Icons: 24×24 viewBox; every icon-only button has `aria-label` and `title`.
- Focus ring: `2px solid #ff4d5e`, offset 2px, on `:focus-visible`.
- Controls hide (with the cursor) after **2500 ms** idle; they stay visible while the pointer is over the bar/menu or the menu is open.
- Caption presets exactly: Classic 18px `#ffffff` on `#000000` 75%; Large 26px same colors; Outline 20px `#ffffff`, bg opacity 0, outline on.
- Caption sizes in the PiP menu: S 14, M 18, L 24, XL 32 px.
- Speeds: 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3.
- PiP menu changes (size, translation) apply to the current PiP window only; never write them to `chrome.storage`.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `DOMParser` or `document.write` anywhere in `src/content/` or code it imports.
- Premium gating stays client-side as today (server enforces translation); free users see a **Premium** tag, not greyed-out controls.

## Review Focus

- **Pages that enforce Trusted Types (YouTube):** controls must still render with no console errors. Pinned in Task 4 (`tt-generic.html` served with `require-trusted-types-for 'script'`).
- **Tiny PiP windows (users shrink them to ~260px wide):** the button row must not overflow or wrap; time and ±10s hide below 360px. Pinned in Task 4.
- **Pressing Space while a control button has focus (after clicking it):** play/pause toggles exactly once, not twice. Pinned in Task 4.
- **Video already muted, or metadata not loaded yet:** volume icon shows muted and the slider reads 0; the time shows `--:--` (not "Live") until the duration is known. Pinned in Task 4.
- **Settings menu open while the mouse sits still:** the bar must not auto-hide from under an open menu. Pinned in Task 5.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/settings.js` | modify | Add `captionPreset`, `captionOutline`, `CAPTION_PRESETS`, `detectCaptionPreset`, `applyCaptionPreset`, `CAPTION_SIZES`, `LANGUAGES` |
| `src/shared/icons.js` | create | Icon path data; `createIcon(doc, name)` (DOM) and `iconMarkup(name)` (string, for popup/site later) |
| `src/content/styles.js` | modify | Outline text-shadow; caption shift via `--subpip-caption-shift` |
| `src/content/captions.js` | modify | `setVisible(on)` for the CC toggle |
| `src/content/controls.js` | rewrite | Shadow-DOM control bar, auto-hide, CC, keyboard handler, menu mount point |
| `src/content/controls.css.js` | create | `CONTROLS_CSS` string for the shadow root |
| `src/content/settings-menu.js` | create | Gear button + menu (speed, caption size, translate, fill) |
| `src/content/pip-window.js` | modify | Mount controls/menu, session overrides, `contain` default |
| `src/assets/logo.svg` | create | New logo mark |
| `src/assets/icon-{16,32,48,128}.png` | create | Rendered extension icons |
| `src/manifest.json` | modify | Point `icons` / `action.default_icon` at new PNGs |
| `scripts/find-browser.mjs` | create | Locate Chrome/Brave for tests and icon rendering |
| `scripts/render-icons.mjs` | create | Render `logo.svg` → PNGs |
| `tests/helpers/server.js` | create | Static server with HTTP Range + optional CSP header |
| `tests/helpers/browser.js` | create | Launch headed browser with a temp profile |
| `tests/helpers/pip.js` | create | `openPip`, `togglePip`, `pipEval`, `shadowEval` |
| `tests/fixtures/*` | create | `test.mp4`, `subs.vtt`, `generic.html`, `youtube.html`, `hostile.html`, `tt-generic.html` |
| `tests/unit/*.test.js` | create | Settings, styles, icons, manifest |
| `tests/e2e/*.test.js` | create | Baseline PiP behavior, control bar, settings menu |
| `package.json`, `eslint.config.js` | modify | Scripts, `puppeteer-core`, lint globals for tests/scripts |

---

### Task 0: Branch and baseline commit

The working tree holds uncommitted work from earlier sessions (security fixes, PiP reliability, modular build). Commit it as a baseline on a feature branch so redesign commits are reviewable on their own.

**Files:** none created.

- [ ] **Step 1: Create the branch**

```bash
git switch -c ui-redesign
```

- [ ] **Step 2: Stage the baseline explicitly (never `git add .`)**

```bash
git add -A -- .gitignore README.md build.mjs eslint.config.js package.json package-lock.json \
  .firebaserc firebase.json firestore.rules firestore.indexes.json functions scripts src web docs
git rm --cached -q subpip2.zip
git status --short
```

Expected: `save_file.csv`, `src.zip`, `send_email.py`, `.DS_Store`, `.superpowers/`, `dist/`, `node_modules/` do **not** appear as staged. If `send_email.py` is listed as staged, unstage it with `git restore --staged send_email.py`.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: baseline before UI redesign

Server-side licensing, PiP reliability fixes, auto-PiP via media session,
modular esbuild build and narrowed permissions."
```

---

### Task 1: Test harness and baseline PiP tests

Pins today's PiP behavior so the redesign cannot silently break it.

**Files:**
- Create: `scripts/find-browser.mjs`, `tests/helpers/server.js`, `tests/helpers/browser.js`, `tests/helpers/pip.js`
- Create: `tests/fixtures/make-fixtures.sh`, `tests/fixtures/test.mp4` (generated), `tests/fixtures/subs.vtt`, `tests/fixtures/generic.html`, `tests/fixtures/youtube.html`
- Create: `tests/e2e/pip-baseline.test.js`
- Modify: `package.json`, `eslint.config.js`

**Interfaces:**
- Produces: `startServer({ fixturesDir, distDir }) → Promise<{ port, close() }>`; `launchBrowser() → Promise<Browser>` (closing it deletes the temp profile); `useBrowser() → ctx` with `ctx.newPage(path, host = '127.0.0.1') → Promise<Page>` where `page.errors: string[]`; `openPip(page, settings = {})` (runs the bundle with the run flag and waits for the PiP window); `togglePip(page, settings = {})` (runs it without waiting); `pipEval(page, fn, ...args)` (runs `fn(pipWindow, ...args)` in the page); `shadowEval(page, fn, ...args)` (runs `fn(shadowRoot, pipWindow, ...args)`); `sleep(ms)`.

- [ ] **Step 1: Add dependencies and scripts**

```bash
npm install --save-dev puppeteer-core@^24
```

Edit `package.json` `scripts` to:

```json
"scripts": {
  "build": "node build.mjs",
  "watch": "node build.mjs --watch",
  "lint": "eslint .",
  "icons": "node scripts/render-icons.mjs",
  "test": "npm run test:unit && npm run test:e2e",
  "test:unit": "node --test 'tests/unit/**/*.test.js'",
  "test:e2e": "npm run build && node --test --test-concurrency=1 'tests/e2e/**/*.test.js'",
  "package": "npm run build && cd dist && rm -f ../subpip.zip && zip -qr ../subpip.zip ."
}
```

- [ ] **Step 2: Lint globals for tests and scripts**

In `eslint.config.js`, add these two entries at the end of the exported array:

```js
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  }
```

- [ ] **Step 3: Browser finder** — create `scripts/find-browser.mjs`:

```js
// Locate a Chromium-based browser for tests and icon rendering.
// Set CHROME_PATH to override.
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

export function findBrowser() {
  const found = CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error('No Chrome/Chromium found. Set CHROME_PATH to a Chromium-based browser.');
  return found;
}
```

- [ ] **Step 4: Static server** — create `tests/helpers/server.js`:

```js
// Static file server for e2e fixtures. Supports HTTP Range (Chrome needs it to
// seek in an mp4). `/script.js` is served from dist/. Paths starting with
// `/tt-` get a Trusted Types CSP header, like YouTube.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.css': 'text/css'
};

export async function startServer({ fixturesDir, distDir }) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = pathname === '/script.js' ? path.join(distDir, 'script.js') : path.join(fixturesDir, safe);

    let stat;
    try {
      stat = statSync(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404).end();
      return;
    }

    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (pathname.startsWith('/tt-')) headers['Content-Security-Policy'] = "require-trusted-types-for 'script'";

    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : stat.size - 1;
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    createReadStream(file).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
```

- [ ] **Step 5: Browser launcher** — create `tests/helpers/browser.js`:

```js
// Headed browser with a throwaway profile (Document PiP needs a real window).
import puppeteer from 'puppeteer-core';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after } from 'node:test';
import { findBrowser } from '../../scripts/find-browser.mjs';
import { startServer } from './server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURES_DIR = path.join(ROOT, 'tests/fixtures');
export const DIST_DIR = path.join(ROOT, 'dist');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchBrowser() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'subpip-test-'));
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: false,
    userDataDir,
    args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required']
  });
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close();
    await rm(userDataDir, { recursive: true, force: true });
  };
  return browser;
}

// Registers before/after hooks for a test file and returns a context
export function useBrowser() {
  const ctx = {};
  before(async () => {
    ctx.server = await startServer({ fixturesDir: FIXTURES_DIR, distDir: DIST_DIR });
    ctx.browser = await launchBrowser();
  });
  after(async () => {
    await ctx.browser?.close();
    await ctx.server?.close();
  });
  ctx.newPage = async (pagePath, host = '127.0.0.1') => {
    const page = await ctx.browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`http://${host}:${ctx.server.port}/${pagePath}`);
    await page.evaluate(() => new Promise((resolve) => {
      const video = document.querySelector('video');
      if (!video || video.readyState >= 1) resolve();
      else video.addEventListener('loadedmetadata', resolve, { once: true });
    }));
    page.errors = errors;
    return page;
  };
  return ctx;
}
```

- [ ] **Step 6: PiP helpers** — create `tests/helpers/pip.js`:

```js
// Run the built page script the way the popup does: settings + run flag, then
// the bundle. page.evaluate carries a user gesture, which requestWindow needs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DIST_DIR } from './browser.js';

async function runScript(page, settings) {
  const source = await readFile(path.join(DIST_DIR, 'script.js'), 'utf8');
  await page.evaluate(`window.__SUBPIP_SETTINGS__ = ${JSON.stringify(settings)}; window.__SUBPIP_RUN__ = true;\n${source}`);
}

export async function openPip(page, settings = {}) {
  await runScript(page, settings);
  await page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('video'), { timeout: 5000 });
}

export async function togglePip(page, settings = {}) {
  await runScript(page, settings);
}

export function pipEval(page, fn, ...args) {
  return page.evaluate(
    (fnSource, fnArgs) => new Function(`return (${fnSource})`)()(window.documentPictureInPicture.window, ...fnArgs),
    fn.toString(), args
  );
}

export function shadowEval(page, fn, ...args) {
  return page.evaluate(
    (fnSource, fnArgs) => {
      const pip = window.documentPictureInPicture.window;
      const shadow = pip.document.querySelector('subpip-controls')?.shadowRoot;
      return new Function(`return (${fnSource})`)()(shadow, pip, ...fnArgs);
    },
    fn.toString(), args
  );
}
```

`pipEval`/`shadowEval` rebuild the function inside the page with `new Function`. Pages served with `require-trusted-types-for 'script'` (the `tt-` fixtures) block that, so tests on those pages call `page.evaluate` directly, as Task 4 shows.

- [ ] **Step 7: Fixtures** — create `tests/fixtures/make-fixtures.sh`:

```bash
#!/bin/sh
# Regenerates tests/fixtures/test.mp4 (2 minutes, 320x180, tone audio, ~1 MB)
set -e
cd "$(dirname "$0")"
ffmpeg -y -loglevel error \
  -f lavfi -i testsrc=duration=120:size=320x180:rate=15 \
  -f lavfi -i sine=frequency=440:duration=120 \
  -c:v libx264 -crf 35 -preset veryslow -pix_fmt yuv420p \
  -c:a aac -b:a 32k -shortest test.mp4
```

Run it:

```bash
chmod +x tests/fixtures/make-fixtures.sh && tests/fixtures/make-fixtures.sh && ls -lh tests/fixtures/test.mp4
```

Expected: `test.mp4` exists, roughly 0.5–1.5 MB.

Create `tests/fixtures/subs.vtt`:

```
WEBVTT

00:00:00.000 --> 00:00:10.000
First hidden-track cue

00:00:10.000 --> 00:01:00.000
Second <i>hidden</i> cue

00:01:00.000 --> 00:02:00.000
Third cue after seeking
```

Create `tests/fixtures/generic.html`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><link rel="icon" href="data:,"><title>generic</title></head>
<body>
  <div id="wrap"><span id="before">before</span><video id="v" src="test.mp4" width="640" height="360" muted loop><track kind="subtitles" src="subs.vtt" srclang="en" default></video><span id="after">after</span></div>
  <script>document.getElementById('v').textTracks[0].mode = 'hidden';</script>
</body>
</html>
```

Create `tests/fixtures/youtube.html` (served from `youtube.localhost`, which matches the YouTube adapter):

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><link rel="icon" href="data:,"><title>youtube fixture</title></head>
<body>
  <div id="player">
    <video id="v" src="test.mp4" width="640" height="360" muted loop></video>
    <div id="ytp-caption-window-container"><div class="caption-window"><span class="captions-text"><span>line A</span></span></div></div>
  </div>
  <script>
    window.setCaption = (lines) => {
      const target = document.querySelector('#ytp-caption-window-container .captions-text');
      target.replaceChildren(...lines.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
    };
    // Simulates the site discarding and re-creating its caption container
    window.recreate = (text) => {
      document.getElementById('ytp-caption-window-container').remove();
      const container = document.createElement('div');
      container.id = 'ytp-caption-window-container';
      const win = Object.assign(document.createElement('div'), { className: 'caption-window' });
      const captionText = Object.assign(document.createElement('span'), { className: 'captions-text' });
      captionText.append(Object.assign(document.createElement('span'), { textContent: text }));
      win.append(captionText);
      container.append(win);
      document.getElementById('player').append(container);
    };
  </script>
</body>
</html>
```

- [ ] **Step 8: Write the baseline tests** — create `tests/e2e/pip-baseline.test.js`:

```js
// Behavior that must survive the redesign unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

test('opens PiP, moves the video and leaves a placeholder', async () => {
  const page = await ctx.newPage('generic.html');
  await page.evaluate(() => document.getElementById('v').play());
  await openPip(page);
  const layout = await page.evaluate(() => [...document.getElementById('wrap').childNodes]
    .map((node) => (node.nodeType === Node.COMMENT_NODE ? '#comment' : node.id)).join(','));
  assert.equal(layout, 'before,#comment,after');
  await togglePip(page);
  await page.close();
});

test('renders cues from a hidden text track and follows seeks', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await sleep(500);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent), 'First hidden-track cue');
  await pipEval(page, (pip) => { pip.document.querySelector('video').currentTime = 70; });
  await sleep(800);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('.subpip-caption-container').textContent), 'Third cue after seeking');
  await togglePip(page);
  await page.close();
});

test('ArrowLeft in the PiP window seeks back 10 seconds', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  const delta = await pipEval(page, async (pip) => {
    const video = pip.document.querySelector('video');
    video.currentTime = 50;
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    return 50 - video.currentTime;
  });
  assert.ok(delta > 9.5 && delta < 10.5, `seeked back ${delta}s`);
  await togglePip(page);
  await page.close();
});

test('live settings update restyles captions', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await page.evaluate(() => window.postMessage({ type: 'SUBPIP_SETTINGS_UPDATED', settings: { fontSize: 40 } }, '*'));
  await sleep(300);
  const css = await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent);
  assert.match(css, /font-size: 40px/);
  await togglePip(page);
  await page.close();
});

test('running again closes PiP and restores the video in place', async () => {
  const page = await ctx.newPage('generic.html');
  await openPip(page);
  await togglePip(page);
  await sleep(800);
  const state = await page.evaluate(() => ({
    open: !!window.documentPictureInPicture.window,
    layout: [...document.getElementById('wrap').childNodes].map((node) => node.id).join(','),
    style: document.getElementById('v').style.cssText
  }));
  assert.deepEqual(state, { open: false, layout: 'before,v,after', style: '' });
  await page.close();
});

test('YouTube adapter mirrors captions, keeps 2 lines, re-attaches', async () => {
  const page = await ctx.newPage('youtube.html', 'youtube.localhost');
  await openPip(page);
  const visibleLines = () => pipEval(page, (pip) => [...pip.document.querySelectorAll('#ytp-caption-window-container .captions-text > span')]
    .filter((span) => span.style.display !== 'none').map((span) => span.textContent).join('|'));
  assert.equal(await visibleLines(), 'line A');
  await page.evaluate(() => window.setCaption(['l1', 'l2', 'l3', 'l4']));
  await sleep(300);
  assert.equal(await visibleLines(), 'l3|l4');
  await page.evaluate(() => window.recreate('after recreate'));
  await sleep(1500);
  assert.equal(await visibleLines(), 'after recreate');
  assert.deepEqual(page.errors, []);
  await togglePip(page);
  await page.close();
});
```

- [ ] **Step 9: Run the baseline tests**

Run: `npm run test:e2e`
Expected: 6 tests pass. A browser window opens and closes; that is expected.

- [ ] **Step 10: Lint and commit**

```bash
npm run lint
git add package.json package-lock.json eslint.config.js scripts/find-browser.mjs tests
git commit -m "test: e2e harness and baseline PiP tests"
```

---

### Task 2: Caption presets, languages, sizes and caption styles

**Files:**
- Modify: `src/shared/settings.js`
- Modify: `src/content/styles.js`
- Test: `tests/unit/settings.test.js`, `tests/unit/styles.test.js`

**Interfaces:**
- Produces (from `src/shared/settings.js`):
  - `CAPTION_PRESETS: { classic, large, outline }`, each `{ fontSize:number, textColor:string, bgColor:string, bgOpacity:number, captionOutline:boolean }`
  - `detectCaptionPreset(settings) → 'classic'|'large'|'outline'|'custom'`
  - `applyCaptionPreset(settings, name) → settings` (new object; sets `captionPreset`)
  - `CAPTION_SIZES: Array<{ label:'S'|'M'|'L'|'XL', px:number }>`
  - `LANGUAGES: Array<{ code:string, name:string }>` (12 entries)
  - `DEFAULT_SETTINGS` gains `captionPreset: 'classic'`, `captionOutline: false`
  - `withDefaults(settings)` fills `captionPreset` via `detectCaptionPreset` when the stored object has none
- Produces (from `src/content/styles.js`): `generateSubtitleStyles(settings)` honors `captionOutline` and, for bottom captions, `translate: 0 calc(-1 * var(--subpip-caption-shift, 0px))`.

- [ ] **Step 1: Write the failing settings tests** — create `tests/unit/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, withDefaults, CAPTION_PRESETS, detectCaptionPreset,
  applyCaptionPreset, CAPTION_SIZES, LANGUAGES
} from '../../src/shared/settings.js';

test('presets match the spec exactly', () => {
  assert.deepEqual(CAPTION_PRESETS.classic, { fontSize: 18, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false });
  assert.deepEqual(CAPTION_PRESETS.large, { fontSize: 26, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false });
  assert.deepEqual(CAPTION_PRESETS.outline, { fontSize: 20, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0, captionOutline: true });
});

test('defaults are the classic preset', () => {
  assert.equal(DEFAULT_SETTINGS.captionPreset, 'classic');
  assert.equal(DEFAULT_SETTINGS.captionOutline, false);
  assert.equal(detectCaptionPreset(DEFAULT_SETTINGS), 'classic');
});

test('existing users keep their look: non-preset values become custom', () => {
  const stored = { fontSize: 22, textColor: '#ffff00', bgColor: '#000000', bgOpacity: 50 };
  assert.equal(withDefaults(stored).captionPreset, 'custom');
  assert.equal(withDefaults(stored).fontSize, 22);
});

test('stored values that equal a preset are detected as that preset', () => {
  assert.equal(withDefaults({ fontSize: 26 }).captionPreset, 'large');
});

test('an explicit stored preset is kept', () => {
  assert.equal(withDefaults({ captionPreset: 'custom', fontSize: 18 }).captionPreset, 'custom');
});

test('applyCaptionPreset returns a new object with the preset values', () => {
  const before = withDefaults({ fontSize: 30 });
  const after = applyCaptionPreset(before, 'outline');
  assert.notEqual(after, before);
  assert.equal(before.fontSize, 30);
  assert.equal(after.captionPreset, 'outline');
  assert.equal(after.bgOpacity, 0);
  assert.equal(after.captionOutline, true);
});

test('caption sizes and languages', () => {
  assert.deepEqual(CAPTION_SIZES, [{ label: 'S', px: 14 }, { label: 'M', px: 18 }, { label: 'L', px: 24 }, { label: 'XL', px: 32 }]);
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'hi', 'ar', 'ru']);
});
```

- [ ] **Step 2: Write the failing styles tests** — create `tests/unit/styles.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSubtitleStyles } from '../../src/content/styles.js';
import { withDefaults } from '../../src/shared/settings.js';

test('outline off uses the soft glow', () => {
  const css = generateSubtitleStyles(withDefaults());
  assert.match(css, /text-shadow: 0 0 3px black, 0 0 5px black/);
});

test('outline on uses a hard four-way outline', () => {
  const css = generateSubtitleStyles(withDefaults({ captionOutline: true }));
  assert.match(css, /text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000/);
  assert.doesNotMatch(css, /0 0 3px black/);
});

test('bottom captions shift with --subpip-caption-shift', () => {
  const css = generateSubtitleStyles(withDefaults({ captionPosition: 'bottom' }));
  assert.match(css, /translate: 0 calc\(-1 \* var\(--subpip-caption-shift, 0px\)\)/);
});

test('top captions do not shift', () => {
  const css = generateSubtitleStyles(withDefaults({ captionPosition: 'top' }));
  assert.doesNotMatch(css, /--subpip-caption-shift/);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL; `CAPTION_PRESETS` (and the others) are not exported, and the outline/shift assertions fail.

- [ ] **Step 4: Implement settings** — in `src/shared/settings.js`, replace the `DEFAULT_SETTINGS` and `withDefaults` definitions with the following (keep `readStoredSettings` and `ALL_SITES` unchanged):

```js
export const CAPTION_PRESETS = {
  classic: { fontSize: 18, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false },
  large: { fontSize: 26, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 75, captionOutline: false },
  outline: { fontSize: 20, textColor: '#ffffff', bgColor: '#000000', bgOpacity: 0, captionOutline: true }
};

export const DEFAULT_SETTINGS = {
  isPremium: false,
  ...CAPTION_PRESETS.classic,
  captionPreset: 'classic',
  fontFamily: 'sans-serif',
  captionPosition: 'bottom',
  playbackSpeed: 1,
  translationEnabled: false,
  targetLanguage: 'en',
  externalSubtitleUrl: '',
  // Needs the optional all-sites permission, so it is opt-in
  autoPip: false
};

// Caption size choices in the PiP settings menu
export const CAPTION_SIZES = [
  { label: 'S', px: 14 },
  { label: 'M', px: 18 },
  { label: 'L', px: 24 },
  { label: 'XL', px: 32 }
];

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' }
];

// Which preset the caption values match, or 'custom'
export function detectCaptionPreset(settings) {
  for (const [name, preset] of Object.entries(CAPTION_PRESETS)) {
    if (Object.entries(preset).every(([key, value]) => settings[key] === value)) return name;
  }
  return 'custom';
}

export function applyCaptionPreset(settings, name) {
  return { ...settings, ...CAPTION_PRESETS[name], captionPreset: name };
}

export function withDefaults(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  // Settings saved before presets existed: keep their look, label it
  if (!settings || settings.captionPreset === undefined) {
    merged.captionPreset = detectCaptionPreset(merged);
  }
  return merged;
}
```

- [ ] **Step 5: Implement caption styles** — in `src/content/styles.js`, inside `generateSubtitleStyles`, after the line `const position = ...`, add:

```js
  const textShadow = settings.captionOutline
    ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000'
    : '0 0 3px black, 0 0 5px black';
  // Lets the PiP controls lift bottom captions above the control bar
  const shift = settings.captionPosition === 'top'
    ? ''
    : 'translate: 0 calc(-1 * var(--subpip-caption-shift, 0px)) !important; transition: translate 0.2s !important;';
```

Then in the returned template:
1. Replace every `text-shadow: 0 0 3px black, 0 0 5px black !important;` (5 occurrences) with `text-shadow: ${textShadow} !important;`.
2. Add `${shift}` as a new line inside each of these five rule blocks, right after their `${position} !important;` line: `.subpip-caption-container`, `.player-timedtext-text-container`, `.caption-window`, `.shaka-text-container`, `#subtitle-1`.

Verify with: `grep -c 'text-shadow: ${textShadow}' src/content/styles.js` → `5` and `grep -c '\${shift}' src/content/styles.js` → `5`.

- [ ] **Step 6: Run the unit tests**

Run: `npm run test:unit`
Expected: all settings and styles tests pass.

- [ ] **Step 7: Baseline still green, lint, commit**

```bash
npm run test:e2e && npm run lint
git add src/shared/settings.js src/content/styles.js tests/unit
git commit -m "feat: caption presets, outline style and caption shift support"
```

---

### Task 3: Icon set, logo and extension icons

**Files:**
- Create: `src/shared/icons.js`, `src/assets/logo.svg`, `scripts/render-icons.mjs`, `src/assets/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Modify: `src/manifest.json`
- Delete: `src/assets/logo.png`, `src/assets/icon28.png`
- Test: `tests/unit/icons.test.js`, `tests/unit/manifest.test.js`

**Interfaces:**
- Produces: `ICON_NAMES: string[]`; `createIcon(doc, name) → SVGSVGElement` (built with `createElementNS`, `aria-hidden="true"`, viewBox `0 0 24 24`, throws on unknown name); `iconMarkup(name) → string` (for extension pages and the website, never used in `src/content/`).

- [ ] **Step 1: Write the failing tests** — create `tests/unit/icons.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, iconMarkup, createIcon } from '../../src/shared/icons.js';

const REQUIRED = ['play', 'pause', 'back10', 'forward10', 'volume', 'volume-muted', 'cc', 'cc-off', 'gear',
  'check', 'chevron-right', 'chevron-left', 'lock', 'fill', 'close', 'spinner'];

test('has every icon the spec lists', () => {
  for (const name of REQUIRED) assert.ok(ICON_NAMES.includes(name), `missing ${name}`);
});

test('iconMarkup produces a 24x24 hidden svg', () => {
  const svg = iconMarkup('play');
  assert.match(svg, /^<svg [^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
  assert.match(svg, /<path /);
});

test('createIcon builds elements through createElementNS', () => {
  const made = [];
  const fakeDoc = {
    createElementNS(ns, tag) {
      const node = { ns, tag, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, append(child) { this.children.push(child); } };
      made.push(node);
      return node;
    }
  };
  const svg = createIcon(fakeDoc, 'cc');
  assert.equal(svg.tag, 'svg');
  assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
  assert.equal(svg.attrs.viewBox, '0 0 24 24');
  assert.equal(svg.children.length, 2);
  assert.ok(made.every((node) => node.ns === 'http://www.w3.org/2000/svg'));
});

test('unknown icon names throw', () => {
  assert.throws(() => iconMarkup('nope'), /Unknown icon/);
});
```

Create `tests/unit/manifest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));

// PNG width/height live at bytes 16-23 of the IHDR chunk
function pngSize(file) {
  const buf = readFileSync(`src/${file}`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('icons exist at the declared sizes', () => {
  for (const group of [manifest.icons, manifest.action.default_icon]) {
    assert.deepEqual(Object.keys(group), ['16', '32', '48', '128']);
    for (const [size, file] of Object.entries(group)) {
      assert.deepEqual(pngSize(file), [Number(size), Number(size)], file);
    }
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit`
Expected: FAIL; `src/shared/icons.js` does not exist and the manifest still lists `assets/logo.png`.

- [ ] **Step 3: Create the icon set** — `src/shared/icons.js`:

```js
// One icon set for the PiP window, popup and website (24x24, currentColor).
// createIcon() builds DOM nodes, which is safe on Trusted Types pages like
// YouTube; iconMarkup() returns a string for extension pages and the website.

const SVG_NS = 'http://www.w3.org/2000/svg';
const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const FILL = { fill: 'currentColor' };

const ICONS = {
  play: [['path', { d: 'M8 5v14l11-7z', ...FILL }]],
  pause: [['path', { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', ...FILL }]],
  back10: [['path', { d: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4', ...STROKE }]],
  forward10: [['path', { d: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4', ...STROKE }]],
  volume: [['path', { d: 'M4 9h4l5-4v14l-5-4H4z', ...FILL }], ['path', { d: 'M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12', ...STROKE }]],
  'volume-muted': [['path', { d: 'M4 9h4l5-4v14l-5-4H4z', ...FILL }], ['path', { d: 'M16 9l5 6M21 9l-5 6', ...STROKE }]],
  cc: [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3', ...STROKE }], ['path', { d: 'M10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4', ...STROKE }]],
  'cc-off': [['rect', { x: '3', y: '5', width: '18', height: '14', rx: '3', ...STROKE }], ['path', { d: 'M10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4', ...STROKE }], ['path', { d: 'M3 3l18 18', ...STROKE }]],
  gear: [['circle', { cx: '12', cy: '12', r: '3', ...STROKE }], ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1', ...STROKE }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7', ...STROKE }]],
  'chevron-right': [['path', { d: 'M9 6l6 6-6 6', ...STROKE }]],
  'chevron-left': [['path', { d: 'M15 6l-6 6 6 6', ...STROKE }]],
  lock: [['rect', { x: '5', y: '11', width: '14', height: '10', rx: '2', ...STROKE }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3', ...STROKE }]],
  fill: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', ...STROKE }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18', ...STROKE }]],
  spinner: [['path', { d: 'M12 3a9 9 0 1 0 9 9', ...STROKE }]]
};

export const ICON_NAMES = Object.keys(ICONS);

function parts(name) {
  const icon = ICONS[name];
  if (!icon) throw new Error(`Unknown icon: ${name}`);
  return icon;
}

export function createIcon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of parts(name)) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

export function iconMarkup(name) {
  const inner = parts(name)
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}
```

- [ ] **Step 4: Create the logo** — `src/assets/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#ff4d5e"/>
  <rect x="22" y="32" width="84" height="64" rx="10" fill="none" stroke="#ffffff" stroke-width="9"/>
  <rect x="38" y="70" width="52" height="10" rx="5" fill="#ffffff"/>
</svg>
```

- [ ] **Step 5: Icon renderer** — create `scripts/render-icons.mjs`:

```js
// Renders src/assets/logo.svg to the PNG sizes Chrome needs.
import puppeteer from 'puppeteer-core';
import { readFile, writeFile } from 'node:fs/promises';
import { findBrowser } from './find-browser.mjs';

const SIZES = [16, 32, 48, 128];
const svg = await readFile('src/assets/logo.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(`src/assets/icon-${size}.png`, png);
    console.log(`src/assets/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
```

Run: `npm run icons`
Expected: prints four paths; the files exist.

- [ ] **Step 6: Point the manifest at the new icons** — in `src/manifest.json` replace both the `icons` object and `action.default_icon` object with:

```json
{
  "16": "assets/icon-16.png",
  "32": "assets/icon-32.png",
  "48": "assets/icon-48.png",
  "128": "assets/icon-128.png"
}
```

Then remove the old assets (nothing else in `src/` references them; `web/` has its own copy):

```bash
grep -rn "logo.png\|icon28.png" src && echo "STILL REFERENCED" || git rm -q src/assets/logo.png src/assets/icon28.png
```

Expected: no "STILL REFERENCED" output.

- [ ] **Step 7: Run tests and look at the icon**

Run: `npm run test:unit`
Expected: all unit tests pass.

Open `src/assets/icon-128.png` and `src/assets/icon-16.png` in an image viewer and confirm: red rounded square, white window outline, white caption bar near the bottom; at 16px the window outline is still recognisable.

- [ ] **Step 8: Build, lint, commit**

```bash
npm run build && npm run lint
git add src/shared/icons.js src/assets scripts/render-icons.mjs src/manifest.json tests/unit
git commit -m "feat: icon set, new logo and extension icons"
```

---

### Task 4: Shadow-DOM control bar

Replaces the text-button controls with the Cinema bar: seek row, play/pause, ±10s, volume, time, CC. Adds auto-hide with caption lift and the new shortcuts. The gear/menu arrives in Task 5 through `controls.mountMenu()`.

**Files:**
- Create: `src/content/controls.css.js`
- Rewrite: `src/content/controls.js`
- Modify: `src/content/captions.js`, `src/content/pip-window.js`
- Create: `tests/fixtures/hostile.html`, `tests/fixtures/tt-generic.html`
- Test: `tests/e2e/pip-controls.test.js`

**Interfaces:**
- Consumes: `createIcon(doc, name)` (Task 3); `generateSubtitleStyles` reads `--subpip-caption-shift` (Task 2).
- Produces:
  - `createControls({ video, pipDoc, session, seekTo, captions }) → controls` where `controls = { host, bar, show(), isVisible() → boolean, toggleCaptions(), captionsOn() → boolean, closeMenu(), mountMenu({ button, panel, isOpen, close }) }`
  - `handlePipKeydown(event, { video, seekTo, controls })`
  - `formatTime(seconds) → string` (`'--:--'` for NaN, `'Live'` is decided by the caller)
  - `captions.setVisible(on: boolean)` in the object returned by `setupCaptions`
  - Shadow root host tag: `subpip-controls`; class names used by tests: `.root`, `.root.visible`, `.bar`, `.seek-input`, `.tip`, `.btn.play`, `.btn.back`, `.btn.fwd`, `.btn.mute`, `.vol-input`, `.cur`, `.dur`, `.btn.cc`, `.row`.

- [ ] **Step 1: Hostile and Trusted Types fixtures**

`tests/fixtures/hostile.html` (site CSS that would wreck unisolated controls):

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8"><link rel="icon" href="data:,"><title>hostile</title>
  <style>
    button { display: none !important; }
    svg { display: none !important; }
    * { font-size: 40px !important; color: lime !important; }
    input[type=range] { width: 5px !important; }
  </style>
</head>
<body>
  <div id="wrap"><video id="v" src="test.mp4" width="640" height="360" muted loop></video></div>
</body>
</html>
```

`tests/fixtures/tt-generic.html` is served with `require-trusted-types-for 'script'` because its name starts with `tt-`:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><link rel="icon" href="data:,"><title>trusted types</title></head>
<body>
  <div id="wrap"><video id="v" src="test.mp4" width="640" height="360" muted loop></video></div>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests** — create `tests/e2e/pip-controls.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(pagePath = 'generic.html', settings = {}) {
  const page = await ctx.newPage(pagePath);
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}

test('controls render inside a shadow root', async () => {
  const page = await open();
  const info = await shadowEval(page, (shadow) => ({
    hasShadow: !!shadow,
    buttons: [...shadow.querySelectorAll('.row .btn')].map((b) => b.getAttribute('aria-label'))
  }));
  assert.equal(info.hasShadow, true);
  assert.deepEqual(info.buttons, ['Play (Space)', 'Back 10 seconds (←)', 'Forward 10 seconds (→)', 'Unmute (M)', 'Captions (C)']);
  await done(page);
});

test('site CSS copied into the PiP window cannot restyle the controls', async () => {
  const page = await open('hostile.html');
  const styles = await shadowEval(page, (shadow, pip) => {
    const play = shadow.querySelector('.btn.play');
    const cs = pip.getComputedStyle(play);
    return { width: play.getBoundingClientRect().width, color: cs.color, iconShown: pip.getComputedStyle(play.querySelector('svg')).display !== 'none' };
  });
  assert.equal(styles.width, 30);
  assert.equal(styles.color, 'rgb(242, 242, 242)');
  assert.equal(styles.iconShown, true);
  await done(page);
});

test('controls render on a Trusted Types page without errors', async () => {
  const page = await open('tt-generic.html');
  // new Function is blocked here too, so query directly
  const count = await page.evaluate(() => window.documentPictureInPicture.window.document
    .querySelector('subpip-controls').shadowRoot.querySelectorAll('.row .btn').length);
  assert.equal(count, 5);
  assert.deepEqual(page.errors, []);
  await done(page);
});

test('play button toggles and updates its icon label', async () => {
  const page = await open();
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.play').click());
  await sleep(300);
  const state = await shadowEval(page, (shadow, pip) => ({
    paused: pip.document.querySelector('video').paused,
    label: shadow.querySelector('.btn.play').getAttribute('aria-label')
  }));
  assert.deepEqual(state, { paused: false, label: 'Pause (Space)' });
  await done(page);
});

test('Space on a focused button toggles exactly once', async () => {
  const page = await open();
  const before = await pipEval(page, (pip) => pip.document.querySelector('video').paused);
  await shadowEval(page, (shadow, pip) => {
    const btn = shadow.querySelector('.btn.cc');
    btn.focus();
    btn.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, composed: true }));
  });
  await sleep(300);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').paused), before);
  await done(page);
});

test('±10s buttons seek', async () => {
  const page = await open();
  const delta = await shadowEval(page, async (shadow, pip) => {
    const video = pip.document.querySelector('video');
    video.currentTime = 30;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    shadow.querySelector('.btn.fwd').click();
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    return video.currentTime - 30;
  });
  assert.ok(delta > 9.5 && delta < 10.5, `moved ${delta}s`);
  await done(page);
});

test('seek bar previews while dragging and seeks on release', async () => {
  const page = await open();
  const result = await shadowEval(page, async (shadow, pip) => {
    const video = pip.document.querySelector('video');
    const seek = shadow.querySelector('.seek-input');
    seek.value = 90;
    seek.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 600));
    const during = { value: Number(seek.value), label: shadow.querySelector('.cur').textContent, time: video.currentTime };
    seek.dispatchEvent(new Event('change'));
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    return { during, after: video.currentTime };
  });
  assert.equal(result.during.value, 90);
  assert.equal(result.during.label, '1:30');
  assert.ok(result.during.time < 20);
  assert.ok(result.after >= 89 && result.after <= 91);
  await done(page);
});

test('hovering the seek bar shows a time tooltip', async () => {
  const page = await open();
  const tip = await shadowEval(page, (shadow, pip) => {
    const seek = shadow.querySelector('.seek-input');
    const rect = seek.getBoundingClientRect();
    seek.dispatchEvent(new pip.PointerEvent('pointermove', { clientX: rect.left + rect.width / 2, clientY: rect.top }));
    const el = shadow.querySelector('.tip');
    return { hidden: el.hidden, text: el.textContent };
  });
  assert.deepEqual(tip, { hidden: false, text: '1:00' });
  await done(page);
});

test('a muted video shows the muted icon and an empty slider', async () => {
  const page = await open();
  const vol = await shadowEval(page, (shadow) => ({
    label: shadow.querySelector('.btn.mute').getAttribute('aria-label'),
    slider: Number(shadow.querySelector('.vol-input').value)
  }));
  assert.deepEqual(vol, { label: 'Unmute (M)', slider: 0 });
  await done(page);
});

test('M toggles mute, arrows change volume', async () => {
  const page = await open();
  const result = await pipEval(page, async (pip) => {
    const video = pip.document.querySelector('video');
    video.volume = 0.5;
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyM' }));
    const afterM = video.muted;
    pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'ArrowUp' }));
    return { afterM, volume: Math.round(video.volume * 10) / 10, mutedAfterUp: video.muted };
  });
  assert.deepEqual(result, { afterM: false, volume: 0.6, mutedAfterUp: false });
  await done(page);
});

test('CC button and C key hide and show captions', async () => {
  const page = await open();
  await sleep(400);
  const vis = () => pipEval(page, (pip) => pip.getComputedStyle(pip.document.querySelector('.subpip-caption-container')).visibility);
  assert.equal(await vis(), 'visible');
  await shadowEval(page, (shadow) => shadow.querySelector('.btn.cc').click());
  assert.equal(await vis(), 'hidden');
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.btn.cc').getAttribute('aria-pressed')), 'false');
  await pipEval(page, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'KeyC' })));
  assert.equal(await vis(), 'visible');
  await done(page);
});

test('controls auto-hide after idle and lift captions while shown', async () => {
  const page = await open();
  await pipEval(page, (pip) => pip.document.dispatchEvent(new pip.MouseEvent('mousemove', { bubbles: true })));
  await sleep(200);
  const shown = await shadowEval(page, (shadow, pip) => ({
    visible: shadow.querySelector('.root').classList.contains('visible'),
    shift: pip.document.documentElement.style.getPropertyValue('--subpip-caption-shift')
  }));
  assert.equal(shown.visible, true);
  assert.notEqual(shown.shift, '0px');
  await sleep(2800);
  const hidden = await shadowEval(page, (shadow, pip) => ({
    visible: shadow.querySelector('.root').classList.contains('visible'),
    shift: pip.document.documentElement.style.getPropertyValue('--subpip-caption-shift'),
    cursor: pip.document.body.style.cursor
  }));
  assert.deepEqual(hidden, { visible: false, shift: '0px', cursor: 'none' });
  await done(page);
});

test('time reads --:-- before the duration is known', async () => {
  const page = await ctx.newPage('generic.html');
  // Detach the source so duration becomes NaN, then open
  await page.evaluate(() => { const v = document.getElementById('v'); v.removeAttribute('src'); v.load(); });
  await openPip(page).catch(() => {});
  const dur = await shadowEval(page, (shadow) => shadow ? shadow.querySelector('.dur').textContent : null);
  assert.equal(dur, '--:--');
  await done(page);
});

test('tiny windows do not overflow the button row', async () => {
  const page = await open();
  await pipEval(page, (pip) => pip.resizeTo(260, 180));
  await sleep(500);
  const row = await shadowEval(page, (shadow, pip) => {
    const r = shadow.querySelector('.row');
    return { overflow: r.scrollWidth > r.clientWidth, width: pip.innerWidth, timeShown: pip.getComputedStyle(shadow.querySelector('.time')).display !== 'none' };
  });
  assert.equal(row.overflow, false, `row overflows at ${row.width}px`);
  assert.equal(row.timeShown, false);
  await done(page);
});
```

Note on `resizeTo`: Chrome allows `resizeTo` on a Document PiP window from its opener. If the browser under test ignores it (the window keeps its size), change the test to open PiP on a fixture whose `<video>` is `width="260" height="146"` instead; `requestWindow` sizes the window from the video.

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:e2e`
Expected: baseline tests pass; the new controls tests FAIL (no `subpip-controls` host exists yet).

- [ ] **Step 4: Controls CSS** — create `src/content/controls.css.js`:

```js
// Styles for the PiP controls shadow root. `all: initial` on the host stops
// site styles (copied into the PiP window) from leaking in via inheritance.
export const CONTROLS_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  pointer-events: none;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: #f2f2f2;
}
.root { position: absolute; inset: 0; opacity: 0; transition: opacity 0.2s; }
.root.visible { opacity: 1; }
.root:not(.visible) .bar, .root:not(.visible) .menu { pointer-events: none; }
.fade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 120px; max-height: 60%;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); pointer-events: none;
}
.bar {
  position: absolute; left: 10px; right: 10px; bottom: 6px;
  display: flex; flex-direction: column; gap: 2px; pointer-events: auto;
}
.seek { position: relative; height: 14px; display: flex; align-items: center; }
.no-seek .seek { visibility: hidden; }
.seek-input {
  -webkit-appearance: none; appearance: none; width: 100%; height: 3px; margin: 0;
  border-radius: 3px; cursor: pointer; outline: none; transition: height 0.1s;
  background: linear-gradient(to right, #ff4d5e var(--p, 0%), rgba(255, 255, 255, 0.25) var(--p, 0%));
}
.seek:hover .seek-input { height: 5px; }
.seek-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 11px; height: 11px; border: 0; border-radius: 50%; background: #ff4d5e;
}
.tip {
  position: absolute; bottom: 16px; transform: translateX(-50%);
  padding: 2px 6px; border-radius: 4px; background: rgba(17, 18, 20, 0.95);
  font-size: 11px; white-space: nowrap; pointer-events: none;
}
.row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.btn {
  all: unset; box-sizing: border-box; flex: none; width: 30px; height: 30px;
  display: grid; place-items: center; border-radius: 8px; color: #f2f2f2; cursor: pointer;
}
.btn:hover { background: rgba(255, 255, 255, 0.1); }
.btn svg { display: block; width: 18px; height: 18px; }
.btn[aria-pressed="false"] { color: #8b8d93; }
.btn[aria-expanded="true"] { color: #ff4d5e; }
:focus-visible { outline: 2px solid #ff4d5e; outline-offset: 2px; }
.vol { display: flex; align-items: center; flex: none; }
.vol-input {
  -webkit-appearance: none; appearance: none; width: 0; height: 3px; margin: 0; opacity: 0;
  border-radius: 3px; background: rgba(255, 255, 255, 0.35); transition: width 0.15s, opacity 0.15s, margin 0.15s;
}
.vol:hover .vol-input, .vol:focus-within .vol-input { width: 56px; opacity: 1; margin: 0 6px 0 2px; }
.vol-input::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%; background: #f2f2f2;
}
.time { margin-left: 6px; color: #b8bac0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.spacer { flex: 1; min-width: 0; }
@media (max-width: 360px) {
  .skip, .time { display: none; }
}
`;
```

- [ ] **Step 5: Controls** — replace the whole of `src/content/controls.js` with:

```js
// PiP window controls: a Cinema-style bottom bar in a shadow root so the site
// stylesheets copied into the PiP window cannot restyle it. Everything is
// built with DOM calls - YouTube enforces Trusted Types (no HTML strings).

import { createIcon } from '../shared/icons.js';
import { CONTROLS_CSS } from './controls.css.js';

const HIDE_DELAY_MS = 2500;

export function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '--:--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

// createElement with props: class, text, attributes; children may be strings
function make(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

export function createControls({ video, pipDoc, session, seekTo, captions }) {
  const { listen, onCleanup } = session;
  const h = (tag, props, ...children) => make(pipDoc, tag, props, children);
  const setIcon = (button, name) => button.replaceChildren(createIcon(pipDoc, name));
  const setLabel = (button, label) => {
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  const iconButton = (cls, label, iconName) => {
    const button = h('button', { class: `btn ${cls}`, type: 'button' });
    setLabel(button, label);
    setIcon(button, iconName);
    return button;
  };

  const host = pipDoc.createElement('subpip-controls');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h('style', { text: CONTROLS_CSS }));

  const seekInput = h('input', { class: 'seek-input', type: 'range', min: '0', max: '0', step: '0.1', value: '0', 'aria-label': 'Seek' });
  const tip = h('div', { class: 'tip', hidden: '' });
  const playBtn = iconButton('play', 'Play (Space)', 'play');
  const backBtn = iconButton('skip back', 'Back 10 seconds (←)', 'back10');
  const fwdBtn = iconButton('skip fwd', 'Forward 10 seconds (→)', 'forward10');
  const muteBtn = iconButton('mute', 'Mute (M)', 'volume');
  const volInput = h('input', { class: 'vol-input', type: 'range', min: '0', max: '1', step: '0.01', 'aria-label': 'Volume' });
  const cur = h('span', { class: 'cur', text: '0:00' });
  const dur = h('span', { class: 'dur', text: '--:--' });
  const ccBtn = iconButton('cc', 'Captions (C)', 'cc');
  ccBtn.setAttribute('aria-pressed', 'true');

  const row = h('div', { class: 'row' },
    playBtn, backBtn, fwdBtn,
    h('div', { class: 'vol' }, muteBtn, volInput),
    h('span', { class: 'time' }, cur, ' / ', dur),
    h('span', { class: 'spacer' }),
    ccBtn
  );
  const bar = h('div', { class: 'bar' }, h('div', { class: 'seek' }, seekInput, tip), row);
  const root = h('div', { class: 'root' }, h('div', { class: 'fade' }), bar);
  shadow.append(root);

  // Play / pause
  const syncPlay = () => {
    setIcon(playBtn, video.paused ? 'play' : 'pause');
    setLabel(playBtn, video.paused ? 'Play (Space)' : 'Pause (Space)');
  };
  playBtn.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  listen(video, 'play', syncPlay);
  listen(video, 'pause', syncPlay);
  syncPlay();

  backBtn.addEventListener('click', () => seekTo(video.currentTime - 10));
  fwdBtn.addEventListener('click', () => seekTo(video.currentTime + 10));

  // Volume
  const syncVolume = () => {
    const muted = video.muted || video.volume === 0;
    setIcon(muteBtn, muted ? 'volume-muted' : 'volume');
    setLabel(muteBtn, muted ? 'Unmute (M)' : 'Mute (M)');
    volInput.value = muted ? 0 : video.volume;
  };
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 0.5;
  });
  volInput.addEventListener('input', () => {
    const volume = parseFloat(volInput.value);
    video.volume = volume;
    video.muted = volume === 0;
  });
  listen(video, 'volumechange', syncVolume);
  syncVolume();

  // Seek bar: preview while dragging, seek once on release
  let dragging = false;
  const setProgress = (time) => {
    const max = parseFloat(seekInput.max) || 0;
    seekInput.style.setProperty('--p', max ? `${(time / max) * 100}%` : '0%');
  };
  const syncDuration = () => {
    const duration = video.duration;
    const known = isFinite(duration) && duration > 0;
    seekInput.max = known ? duration : 0;
    seekInput.disabled = !known;
    root.classList.toggle('no-seek', !known);
    dur.textContent = duration === Infinity ? 'Live' : formatTime(known ? duration : NaN);
  };
  const syncTime = () => {
    if (dragging) return;
    cur.textContent = formatTime(video.currentTime || 0);
    seekInput.value = video.currentTime || 0;
    setProgress(video.currentTime || 0);
  };
  seekInput.addEventListener('input', () => {
    dragging = true;
    const time = parseFloat(seekInput.value);
    cur.textContent = formatTime(time);
    setProgress(time);
  });
  seekInput.addEventListener('change', () => {
    seekTo(parseFloat(seekInput.value));
    dragging = false;
  });
  seekInput.addEventListener('pointermove', (event) => {
    const max = parseFloat(seekInput.max);
    if (!max) return;
    const rect = seekInput.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    tip.textContent = formatTime(ratio * max);
    tip.style.left = `${ratio * 100}%`;
    tip.hidden = false;
  });
  seekInput.addEventListener('pointerleave', () => { tip.hidden = true; });
  listen(video, 'durationchange', syncDuration);
  listen(video, 'loadedmetadata', syncDuration);
  listen(video, 'timeupdate', syncTime);
  listen(video, 'seeked', syncTime);
  syncDuration();
  syncTime();

  // Captions on/off
  let captionsOn = true;
  const setCaptions = (on) => {
    captionsOn = on;
    captions.setVisible(on);
    setIcon(ccBtn, on ? 'cc' : 'cc-off');
    ccBtn.setAttribute('aria-pressed', String(on));
  };
  ccBtn.addEventListener('click', () => setCaptions(!captionsOn));

  // Show on mouse move; hide (with the cursor) after idle. Bottom captions
  // lift by the bar's height while it is shown.
  let menu = null;
  let visible = false;
  let pointerInside = false;
  let hideTimer = null;
  const menuOpen = () => !!menu && menu.isOpen();
  const setVisible = (on) => {
    visible = on;
    root.classList.toggle('visible', on);
    pipDoc.body.style.cursor = on ? '' : 'none';
    const shift = on ? Math.ceil(bar.getBoundingClientRect().height) + 6 : 0;
    pipDoc.documentElement.style.setProperty('--subpip-caption-shift', `${shift}px`);
  };
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!pointerInside && !menuOpen()) setVisible(false);
    }, HIDE_DELAY_MS);
  };
  const show = () => {
    setVisible(true);
    scheduleHide();
  };
  const trackPointer = (element) => {
    element.addEventListener('pointerenter', () => { pointerInside = true; });
    element.addEventListener('pointerleave', () => { pointerInside = false; scheduleHide(); });
  };
  trackPointer(bar);
  onCleanup(() => clearTimeout(hideTimer));
  listen(pipDoc, 'mousemove', show);
  listen(pipDoc.documentElement, 'mouseleave', () => {
    if (menuOpen()) return;
    clearTimeout(hideTimer);
    setVisible(false);
  });
  root.addEventListener('focusin', show);
  pipDoc.documentElement.style.setProperty('--subpip-caption-shift', '0px');
  show();

  return {
    host,
    bar,
    show,
    isVisible: () => visible,
    toggleCaptions: () => setCaptions(!captionsOn),
    captionsOn: () => captionsOn,
    closeMenu: () => menu && menu.close(),
    // Settings menu (Task 5): button goes at the end of the row, panel above the bar
    mountMenu(menuParts) {
      menu = menuParts;
      row.append(menuParts.button);
      root.insertBefore(menuParts.panel, bar);
      trackPointer(menuParts.panel);
    }
  };
}

// Keyboard shortcuts inside the PiP window
export function handlePipKeydown(event, { video, seekTo, controls }) {
  const origin = event.composedPath()[0];
  const tag = origin && origin.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // A focused button already acts on Space/Enter; don't double-toggle
  if (tag === 'BUTTON' && (event.code === 'Space' || event.code === 'Enter')) return;

  switch (event.code) {
    case 'Space':
      if (video.paused) video.play();
      else video.pause();
      break;
    case 'ArrowRight':
      seekTo(video.currentTime + 10);
      break;
    case 'ArrowLeft':
      seekTo(video.currentTime - 10);
      break;
    case 'ArrowUp':
      video.muted = false;
      video.volume = Math.min(1, video.volume + 0.1);
      break;
    case 'ArrowDown':
      video.volume = Math.max(0, video.volume - 0.1);
      break;
    case 'KeyM':
      video.muted = !video.muted;
      break;
    case 'KeyC':
      controls.toggleCaptions();
      break;
    case 'Escape':
      controls.closeMenu();
      break;
    default:
      return;
  }
  event.preventDefault();
  controls.show();
}
```

- [ ] **Step 6: Captions visibility** — in `src/content/captions.js`:

1. After the line `let rerender = () => { };` add:

```js
  // CC toggle state, re-applied whenever the caption element is replaced
  let captionsVisible = true;
  const present = () => {
    if (captionEl) captionEl.style.visibility = captionsVisible ? '' : 'hidden';
  };
```

2. In `useTextCaptions()`, after `pipDoc.body.appendChild(captionEl);` add `present();`.
3. In the site-caption branch, after the first `pipDoc.body.appendChild(captionEl);` add `present();`.
4. In `attachSource`, after `captionEl = fresh;` add `present();`.
5. In the returned object, add this method after `setTranslationOn`:

```js
    setVisible(on) {
      captionsVisible = on;
      present();
    },
```

- [ ] **Step 7: Mount the controls** — in `src/content/pip-window.js`:

1. Imports stay as they are (`createControls`, `handlePipKeydown`, `generateSubtitleStyles`, `setupCaptions`).
2. Replace the block from `pipDoc.body.style.overflow = 'hidden';` through `pipDoc.body.append(video);` with:

```js
  pipDoc.body.style.overflow = 'hidden';
  pipDoc.body.style.margin = '0';
  pipDoc.body.style.background = '#000';
  video.style.objectFit = 'fill';
  pipDoc.body.append(video);
```

3. Replace the line `pipDoc.body.appendChild(createControls({ video, pipDoc, session, seekTo, settings, isPremium, captions }));` with:

```js
  const controls = createControls({ video, pipDoc, session, seekTo, captions });
  pipDoc.body.appendChild(controls.host);
```

4. Replace the line `pipWindow.addEventListener('keydown', (event) => handlePipKeydown(event, video, seekTo));` with:

```js
  pipWindow.addEventListener('keydown', (event) => handlePipKeydown(event, { video, seekTo, controls }));
```

- [ ] **Step 8: Confirm no HTML-string sinks**

Run: `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|DOMParser|document\.write" src/content src/shared/icons.js`
Expected: no output. (`iconMarkup` in `src/shared/icons.js` builds a string but is never used by `src/content/`; esbuild drops it from `dist/script.js`.)

- [ ] **Step 9: Run all tests**

Run: `npm run test:unit && npm run test:e2e`
Expected: all unit tests and all e2e tests (baseline + controls) pass.

- [ ] **Step 10: Look at it**

Run `npm run build`, load `dist/` as an unpacked extension in Chrome, open a YouTube video with captions on, and press Alt+P → Open Picture-in-Picture. Check: the bar matches the Cinema mockup (dark fade, red seek fill, icon buttons); captions rise when the bar appears and settle when it hides; the cursor disappears when idle; M, C, Space, arrows work.

- [ ] **Step 11: Lint and commit**

```bash
npm run lint
git add src/content tests
git commit -m "feat: Cinema control bar for the PiP window

Shadow-DOM controls (isolated from site CSS, Trusted Types safe), icon
buttons, seek tooltip, expanding volume, CC toggle, auto-hide with caption
lift, M/C shortcuts, and --:-- until the duration is known."
```

---

### Task 5: PiP settings menu

Adds the gear button and menu: Speed (Premium), Caption size, Translate (Premium), Fill window. Size/translation changes are session-only overrides.

**Files:**
- Create: `src/content/settings-menu.js`
- Modify: `src/content/controls.css.js` (append menu styles), `src/content/pip-window.js`
- Test: `tests/e2e/pip-menu.test.js`

**Interfaces:**
- Consumes: `controls.mountMenu({ button, panel, isOpen, close })`, `controls.show()` (Task 4); `CAPTION_SIZES`, `LANGUAGES` (Task 2); `createIcon` (Task 3); `captions.translationOn` getter and `captions.setTranslationOn(on)` (existing).
- Produces: `createSettingsMenu({ video, pipDoc, session, isPremium, getSessionSettings, applyOverride, captions }) → { button, panel, isOpen() → boolean, close() }`. In `pip-window.js`: `sessionSettings()` = saved settings merged with `overrides`; `applyOverride(patch)` updates overrides, restyles captions and refreshes them.

- [ ] **Step 1: Write the failing tests** — create `tests/e2e/pip-menu.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(settings = {}) {
  const page = await ctx.newPage('generic.html');
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  const item = [...shadow.querySelectorAll('.menu .menu-item')].find((i) => i.querySelector('.label').textContent === text);
  item.click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());

test('gear opens the menu with current values (premium user)', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  assert.deepEqual(await menuItems(page), ['Speed=1×', 'Caption size=M', 'Translate=Off', 'Fill window=Off']);
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').getAttribute('aria-expanded')), 'true');
  await done(page);
});

test('free users see Premium tags and an upgrade note', async () => {
  const page = await open({ isPremium: false });
  await openMenu(page);
  assert.deepEqual(await menuItems(page), ['Speed=Premium', 'Caption size=M', 'Translate=Premium', 'Fill window=Off']);
  await clickItem(page, 'Speed');
  const note = await shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note').textContent);
  assert.match(note, /Premium feature/);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').playbackRate), 1);
  await done(page);
});

test('premium speed selection changes playback rate', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  await clickItem(page, 'Speed');
  await clickItem(page, '1.5×');
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').playbackRate), 1.5);
  assert.deepEqual((await menuItems(page))[0], 'Speed=1.5×');
  await done(page);
});

test('caption size applies to this window only', async () => {
  const page = await open({ fontSize: 18 });
  await openMenu(page);
  await clickItem(page, 'Caption size');
  await clickItem(page, 'XL');
  const css = await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent);
  assert.match(css, /font-size: 32px/);
  assert.equal(await page.evaluate(() => window.__SUBPIP_SETTINGS__.fontSize), 18);
  await done(page);
});

test('translate picks a language for this window', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  await clickItem(page, 'Translate');
  await clickItem(page, 'Spanish');
  assert.deepEqual((await menuItems(page))[2], 'Translate=Spanish');
  await clickItem(page, 'Translate');
  await clickItem(page, 'Off');
  assert.deepEqual((await menuItems(page))[2], 'Translate=Off');
  await done(page);
});

test('fill window toggles object-fit', async () => {
  const page = await open();
  const fit = () => pipEval(page, (pip) => pip.document.querySelector('video').style.objectFit);
  assert.equal(await fit(), 'contain');
  await openMenu(page);
  await clickItem(page, 'Fill window');
  assert.equal(await fit(), 'fill');
  assert.deepEqual((await menuItems(page))[3], 'Fill window=On');
  await done(page);
});

test('Escape and outside clicks close the menu; Back returns to the main list', async () => {
  const page = await open({ isPremium: true });
  const isOpen = () => shadowEval(page, (shadow) => !shadow.querySelector('.menu').hidden);
  await openMenu(page);
  await clickItem(page, 'Speed');
  await clickItem(page, 'Back');
  assert.equal((await menuItems(page)).length, 4);
  await pipEval(page, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'Escape' })));
  assert.equal(await isOpen(), false);
  await openMenu(page);
  await pipEval(page, (pip) => pip.document.querySelector('video').dispatchEvent(new pip.PointerEvent('pointerdown', { bubbles: true, composed: true })));
  assert.equal(await isOpen(), false);
  await done(page);
});

test('an open menu keeps the controls visible while idle', async () => {
  const page = await open();
  await openMenu(page);
  await sleep(3000);
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.root').classList.contains('visible')), true);
  await done(page);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:e2e`
Expected: the menu tests FAIL (no `.btn.gear`); all earlier tests still pass.

- [ ] **Step 3: Menu styles** — in `src/content/controls.css.js`, insert the following immediately before the `@media (max-width: 360px)` block:

```css
.menu {
  position: absolute; right: 10px; bottom: 60px; width: 220px;
  max-width: calc(100% - 20px); max-height: calc(100% - 76px); overflow: auto;
  box-sizing: border-box; padding: 6px; border: 1px solid #25262a; border-radius: 12px;
  background: #111214; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); pointer-events: auto;
}
.menu[hidden] { display: none; }
.menu-item {
  all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 8px; font-size: 12px; color: #f2f2f2; cursor: pointer;
}
.menu-item:hover { background: rgba(255, 255, 255, 0.07); }
.menu-item:focus-visible { outline: 2px solid #ff4d5e; outline-offset: -2px; }
.menu-item svg { display: block; width: 14px; height: 14px; flex: none; }
.menu-item .value { margin-left: auto; color: #8b8d93; }
.menu-item .check { color: #ff4d5e; visibility: hidden; }
.menu-item[aria-checked="true"] .check { visibility: visible; }
.menu-item.head { font-weight: 600; }
.tag {
  margin-left: auto; padding: 2px 6px; border-radius: 99px; font-size: 10px; font-weight: 600;
  background: rgba(255, 77, 94, 0.15); color: #ff7a86;
}
.menu-note { padding: 8px 10px; font-size: 12px; line-height: 1.4; color: #8b8d93; }
```

- [ ] **Step 4: Settings menu** — create `src/content/settings-menu.js`:

```js
// PiP settings menu: Speed (Premium), Caption size, Translate (Premium),
// Fill window. Size/translation are session overrides; nothing is saved.
// Built with DOM calls only (Trusted Types pages).

import { createIcon } from '../shared/icons.js';
import { CAPTION_SIZES, LANGUAGES } from '../shared/settings.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const UPGRADE_NOTE = 'Premium feature. Open the SubPIP popup to upgrade.';

export function createSettingsMenu({ video, pipDoc, session, isPremium, getSessionSettings, applyOverride, captions }) {
  const el = (tag, cls, text) => {
    const node = pipDoc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const button = el('button', 'btn gear');
  button.type = 'button';
  button.setAttribute('aria-label', 'Settings');
  button.title = 'Settings';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.append(createIcon(pipDoc, 'gear'));

  const panel = el('div', 'menu');
  panel.setAttribute('role', 'menu');
  panel.hidden = true;

  let view = 'main';

  const sizeLabel = () => {
    const px = getSessionSettings().fontSize;
    return CAPTION_SIZES.reduce((best, size) => (Math.abs(size.px - px) < Math.abs(best.px - px) ? size : best)).label;
  };
  const languageName = (code) => (LANGUAGES.find((lang) => lang.code === code) || { name: code }).name;
  const translateLabel = () => (captions.translationOn ? languageName(getSessionSettings().targetLanguage) : 'Off');

  // One row: label, then a value / Premium tag / check mark / chevron
  function item({ label, value, premium, checked, chevron, back, onSelect }) {
    const row = el('button', back ? 'menu-item head' : 'menu-item');
    row.type = 'button';
    row.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
    if (checked !== undefined) {
      const check = createIcon(pipDoc, 'check');
      check.classList.add('check');
      row.append(check);
      row.setAttribute('aria-checked', String(checked));
    }
    if (back) row.append(createIcon(pipDoc, 'chevron-left'));
    row.append(el('span', 'label', label));
    if (premium) row.append(el('span', 'tag', 'Premium'));
    else if (value !== undefined) row.append(el('span', 'value', value));
    if (chevron) row.append(createIcon(pipDoc, 'chevron-right'));
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      onSelect();
    });
    return row;
  }

  const go = (next) => () => {
    view = next;
    render();
  };
  const backRow = () => item({ label: 'Back', back: true, onSelect: go('main') });

  function mainView() {
    return [
      item({ label: 'Speed', value: `${video.playbackRate}×`, premium: !isPremium, chevron: true, onSelect: go('speed') }),
      item({ label: 'Caption size', value: sizeLabel(), chevron: true, onSelect: go('size') }),
      item({ label: 'Translate', value: translateLabel(), premium: !isPremium, chevron: true, onSelect: go('translate') }),
      item({
        label: 'Fill window',
        value: video.style.objectFit === 'fill' ? 'On' : 'Off',
        onSelect: () => {
          video.style.objectFit = video.style.objectFit === 'fill' ? 'contain' : 'fill';
          render();
        }
      })
    ];
  }

  function speedView() {
    if (!isPremium) return [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];
    return [backRow(), ...SPEEDS.map((speed) => item({
      label: `${speed}×`,
      checked: video.playbackRate === speed,
      onSelect: () => {
        video.playbackRate = speed;
        go('main')();
      }
    }))];
  }

  function sizeView() {
    const current = sizeLabel();
    return [backRow(), ...CAPTION_SIZES.map((size) => item({
      label: size.label,
      value: `${size.px}px`,
      checked: size.label === current,
      onSelect: () => {
        applyOverride({ fontSize: size.px });
        go('main')();
      }
    }))];
  }

  function translateView() {
    if (!isPremium) return [backRow(), el('div', 'menu-note', UPGRADE_NOTE)];
    const code = getSessionSettings().targetLanguage;
    return [
      backRow(),
      item({
        label: 'Off',
        checked: !captions.translationOn,
        onSelect: () => {
          captions.setTranslationOn(false);
          go('main')();
        }
      }),
      ...LANGUAGES.map((lang) => item({
        label: lang.name,
        checked: captions.translationOn && lang.code === code,
        onSelect: () => {
          applyOverride({ targetLanguage: lang.code });
          captions.setTranslationOn(true);
          go('main')();
        }
      }))
    ];
  }

  const VIEWS = { main: mainView, speed: speedView, size: sizeView, translate: translateView };

  function render() {
    panel.replaceChildren(...VIEWS[view]());
    const first = panel.querySelector('.menu-item');
    if (first && !panel.hidden) first.focus({ preventScroll: true });
  }

  const open = () => {
    view = 'main';
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    render();
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panel.hidden) open();
    else close();
  });

  // Clicks anywhere outside the menu and gear close it
  session.listen(pipDoc, 'pointerdown', (event) => {
    if (panel.hidden) return;
    const path = event.composedPath();
    if (!path.includes(panel) && !path.includes(button)) close();
  });

  return { button, panel, isOpen: () => !panel.hidden, close };
}
```

- [ ] **Step 5: Wire the menu and session overrides** — in `src/content/pip-window.js`:

1. Add the import next to the controls import:

```js
import { createSettingsMenu } from './settings-menu.js';
```

2. Right after `const isPremium = !!settings.isPremium;` add:

```js
  // PiP-menu choices (caption size, translation language) for this window
  // only; they sit on top of the saved settings and are never stored.
  const overrides = {};
  const sessionSettings = () => ({ ...getSettings(), ...overrides });
```

3. Change the default fit from `video.style.objectFit = 'fill';` to:

```js
  video.style.objectFit = 'contain';
```

4. Change `subtitleStyle.textContent = generateSubtitleStyles(settings);` to:

```js
  subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
```

5. Change the captions setup to use session settings:

```js
  const captions = await setupCaptions({ video, adapter, pipDoc, session, getSettings: sessionSettings, isPremium });
```

6. After `pipDoc.body.appendChild(controls.host);` add:

```js
  const applyOverride = (patch) => {
    Object.assign(overrides, patch);
    subtitleStyle.textContent = generateSubtitleStyles(sessionSettings());
    captions.refresh();
  };
  controls.mountMenu(createSettingsMenu({
    video, pipDoc, session, isPremium,
    getSessionSettings: sessionSettings,
    applyOverride,
    captions
  }));
```

7. In the returned `onSettingsChanged()`, change `generateSubtitleStyles(getSettings())` to `generateSubtitleStyles(sessionSettings())`.

- [ ] **Step 6: Run all tests**

Run: `npm run test:unit && npm run test:e2e`
Expected: every test passes, including `tiny windows do not overflow the button row`. The gear adds a sixth 30px button; if that test now fails, do **not** hide CC or the gear (both must stay reachable). Instead add `.btn { width: 28px; height: 28px; }` inside the `@media (max-width: 360px)` block and re-run.

- [ ] **Step 7: Look at it**

`npm run build`, reload the unpacked extension, open PiP on YouTube. Check: gear opens a dark menu above the bar, values are right, Speed/Translate show the red Premium tag when signed out, Escape and clicking the video close it, the bar stays up while the menu is open, and the menu fits a small window (scrolls rather than clipping).

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add src/content tests/e2e/pip-menu.test.js
git commit -m "feat: PiP settings menu (speed, caption size, translate, fill)"
```

---

### Task 6: Final verification for Part 1

**Files:** none new.

- [ ] **Step 1: Full check**

Run: `npm run lint && npm run test && npm run build`
Expected: lint clean, all unit and e2e tests pass, build prints the four bundles.

- [ ] **Step 2: Manual pass in Google Chrome** (the environment tests used Brave/Chrome with fixtures; this checks real sites)

Load `dist/` unpacked and verify on each site, noting any failure:

| Site | Check |
|---|---|
| YouTube (captions on) | Captions visible and lift above the bar; seek tooltip; M/C/Space; menu sizes change captions |
| Netflix | Seek bar and ±10s move playback without the M7375 error; captions mirror |
| Any page with a plain `<video>` | Controls work; no captions shown when none exist; CC button still toggles harmlessly |

- [ ] **Step 3: Report**

Summarize for the owner: what changed visually, test counts, any manual-check failures, and anything deferred to the popup/website plans. Wait for the owner's review before starting the popup plan (spec §7).
