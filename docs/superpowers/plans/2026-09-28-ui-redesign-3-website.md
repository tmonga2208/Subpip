# UI Redesign, Part 3: Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the static website (`web/`) in the Cinema style: a landing page that sells the free extension and Premium, a single-card checkout page, and a restyled privacy page, all sharing one stylesheet and the new logo.

**Architecture:** Plain HTML + one shared `web/style.css` built on the same tokens as the extension, plus `web/script.js` for the FAQ accordion. No framework, no build step; Vercel serves `web/` as-is. The checkout page keeps its existing inline payment script (Razorpay → `confirmPayment` Cloud Function) unchanged; only markup and styles change. E2E tests serve `web/` with the existing test server and drive it with puppeteer-core, stubbing Razorpay and the Cloud Function by request interception.

**Tech Stack:** HTML, CSS, a few lines of vanilla JS; `node:test` + puppeteer-core (existing harness).

**Spec:** `docs/superpowers/specs/2026-09-28-ui-redesign-design.md` §5 (Website) and the website part of §6. Parts 1 (PiP) and 2 (popup) are complete on branch `ui-redesign`.

## Global Constraints

- Tokens (same as extension): `--bg #0b0b0c`, `--surface #111214`, `--card #17181b`, `--border #25262a`, `--text #f2f2f2`, `--text-2 #8b8d93`, `--accent #ff4d5e`, `--accent-soft rgba(255,77,94,0.15)`, `--accent-text #ff7a86`, `--success #3ecf8e`, `--danger-text #ff8a8a`; radius 8px / 12px; no gradients on buttons.
- System font stack; hero headline ~48px desktop / 32px at ≤900px.
- Dark only: no theme toggle.
- No horizontal scrolling at 390px wide; on phones the nav collapses to logo + "Add to Chrome".
- Chrome Web Store URL: `https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg`.
- Price copy: "₹1000 · lifetime" / "₹1000 lifetime"; Premium = translation, speed control, subtitle files.
- Contact: `mailto:tarunmonga2208@gmail.com`.
- Removed: dark-mode toggle, "download ZIP" link, Buy Me a Coffee widget, `image.png`, `img.png`, `logo.png`.
- Checkout keeps its element ids (`emailInput`, `payBtn`, `loading`, `errorMsg`, `paymentSection`, `successSection`, `licenseKey`, `userEmailDisplay`), the `initiatePayment()` / `copyLicense()` globals, and the `.hide` / `.show` state classes its script toggles.
- Privacy page: restyle only; the wording stays.
- Focus ring `2px solid #ff4d5e`; icon-only controls have `aria-label`.

## Review Focus

- **Phones (390px):** no page scrolls sideways; nav shows only logo + Add to Chrome. Pinned in Task 4.
- **Razorpay's script blocked (ad blockers, flaky network):** a clear "couldn't load the payment gateway" message and a usable button, not a dead click. Pinned in Task 2.
- **Payment succeeds but license confirmation fails:** the error shows the payment ID so support can recover the purchase. Pinned in Task 2.
- **Returning buyer:** revisiting the page shows the saved license instead of asking to pay again. Pinned in Task 2.
- **Keyboard users on the FAQ:** each question toggles with Enter/Space and exposes `aria-expanded`. Pinned in Task 1.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `web/style.css` | rewrite | Tokens, layout, nav, hero, sections, cards, pricing, FAQ, checkout, prose, footer |
| `web/index.html` | rewrite | Landing page |
| `web/premium.html` | rewrite (markup + styles only) | Checkout card; payment script kept verbatim |
| `web/privacy.html` | rewrite (markup only) | Privacy policy on the shared styles |
| `web/script.js` | rewrite | FAQ accordion |
| `web/logo.svg` | create | Site logo + favicon (copy of `src/assets/logo.svg`) |
| `web/image.png`, `web/img.png`, `web/logo.png` | delete | Replaced |
| `tests/helpers/server.js` | modify | `.svg` / `.png` content types |
| `tests/helpers/browser.js` | modify | Export `WEB_DIR` |
| `tests/helpers/web.js` | create | `useWebsite()` harness, Razorpay/Cloud Function stubs |
| `tests/e2e/web-*.test.js` | create | Landing, checkout, privacy, cross-page checks |

---

### Task 1: Shared styles, logo and landing page

**Files:**
- Modify: `tests/helpers/server.js`, `tests/helpers/browser.js`
- Create: `tests/helpers/web.js`, `web/logo.svg`, `tests/e2e/web-landing.test.js`
- Rewrite: `web/style.css`, `web/index.html`, `web/script.js`

**Interfaces:**
- Produces:
  - `WEB_DIR` (from `tests/helpers/browser.js`)
  - `useWebsite() → ctx` with `ctx.open(pagePath, { width = 1440, height = 900, intercept } = {}) → Promise<Page>` (`page.errors: string[]`; `intercept(request) → boolean` handles a request when it returns true)
  - `CHROME_STORE_URL` constant (from `tests/helpers/web.js`)
  - CSS classes later pages reuse: `.site-header`, `.nav`, `.brand`, `.nav-links`, `.btn`, `.btn-primary`, `.btn-ghost`, `.container`, `.section`, `.card`, `.tag`, `.site-footer`, `.check-list`

- [ ] **Step 1: Test harness additions**

In `tests/helpers/server.js`, add two entries to `TYPES`:

```js
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
```

In `tests/helpers/browser.js`, after the `DIST_DIR` line add:

```js
export const WEB_DIR = path.join(ROOT, 'web');
```

Create `tests/helpers/web.js`:

```js
// Serves web/ and opens its pages in a headed browser, with hooks to stub
// third-party requests (Razorpay, Cloud Functions).
import { before, after } from 'node:test';
import { launchBrowser, WEB_DIR, DIST_DIR } from './browser.js';
import { startServer } from './server.js';

export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg';

export function useWebsite() {
  const ctx = {};
  before(async () => {
    ctx.server = await startServer({ fixturesDir: WEB_DIR, distDir: DIST_DIR });
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
```

- [ ] **Step 2: Write the failing landing tests** — `tests/e2e/web-landing.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, CHROME_STORE_URL } from '../helpers/web.js';

const ctx = useWebsite();

test('sections appear in the spec order', async () => {
  const page = await ctx.open('index.html');
  const ids = await page.$$eval('main > section', (sections) => sections.map((s) => s.id));
  assert.deepEqual(ids, ['hero', 'sites', 'features', 'how', 'pricing', 'faq']);
  assert.equal(await page.$eval('#hero h1', (h) => h.textContent.trim()), 'Picture-in-Picture, with subtitles.');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('calls to action point to the Web Store and the checkout', async () => {
  const page = await ctx.open('index.html');
  const links = await page.evaluate(() => ({
    nav: document.querySelector('.nav .btn-primary').href,
    hero: document.querySelector('#hero .btn-primary').href,
    heroSecondary: document.querySelector('#hero .btn-ghost').getAttribute('href'),
    premium: document.querySelector('#pricing .price-card.featured .btn-primary').getAttribute('href')
  }));
  assert.deepEqual(links, { nav: CHROME_STORE_URL, hero: CHROME_STORE_URL, heroSecondary: '#pricing', premium: 'premium.html' });
  await page.close();
});

test('nav links jump to real sections', async () => {
  const page = await ctx.open('index.html');
  const missing = await page.$$eval('.nav-links a[href^="#"]', (links) => links
    .map((a) => a.getAttribute('href')).filter((href) => !document.querySelector(href)));
  assert.deepEqual(missing, []);
  await page.close();
});

test('six features, two plans, supported sites listed', async () => {
  const page = await ctx.open('index.html');
  const counts = await page.evaluate(() => ({
    features: document.querySelectorAll('#features .card').length,
    plans: document.querySelectorAll('#pricing .price-card').length,
    sites: [...document.querySelectorAll('#sites .site-chip')].map((c) => c.textContent.trim())
  }));
  assert.equal(counts.features, 6);
  assert.equal(counts.plans, 2);
  assert.deepEqual(counts.sites, ['YouTube', 'Netflix', 'Disney+ Hotstar', 'JioCinema', 'Crunchyroll', 'Any site with built-in captions']);
  await page.close();
});

test('removed: theme toggle, ZIP download, coffee widget, old images', async () => {
  const page = await ctx.open('index.html');
  const html = await page.content();
  for (const gone of ['darkModeToggle', 'subpip.zip', 'buymeacoffee', 'image.png', 'img.png', 'logo.png']) {
    assert.equal(html.includes(gone), false, `${gone} still present`);
  }
  await page.close();
});

test('FAQ questions toggle with mouse and keyboard', async () => {
  const page = await ctx.open('index.html');
  const trigger = '.accordion-item:first-child .accordion-trigger';
  const state = () => page.$eval(trigger, (b) => ({ expanded: b.getAttribute('aria-expanded'), item: b.closest('.accordion-item').dataset.state }));
  assert.deepEqual(await state(), { expanded: 'false', item: 'closed' });
  await page.click(trigger);
  assert.deepEqual(await state(), { expanded: 'true', item: 'open' });
  await page.focus(trigger);
  await page.keyboard.press('Enter');
  assert.deepEqual(await state(), { expanded: 'false', item: 'closed' });
  await page.keyboard.press('Space');
  assert.deepEqual(await state(), { expanded: 'true', item: 'open' });
  await page.close();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-landing.test.js`
Expected: FAIL (old page has different sections, BMC widget, etc.).

- [ ] **Step 4: Logo** — copy the extension logo:

```bash
cp src/assets/logo.svg web/logo.svg
```

- [ ] **Step 5: Shared stylesheet** — replace all of `web/style.css` with:

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
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --maxw: 1120px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; scroll-padding-top: 80px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { background: var(--bg); color: var(--text); font: 16px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
img, svg { display: block; max-width: 100%; }
a { color: inherit; }
button, input { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
.container { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 0 20px; }
.muted { color: var(--text-2); }

/* Header */
.site-header { position: sticky; top: 0; z-index: 10; border-bottom: 1px solid var(--border); background: rgba(11, 11, 12, 0.85); backdrop-filter: blur(10px); }
.nav { display: flex; align-items: center; gap: 28px; height: 64px; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; text-decoration: none; }
.brand img { width: 28px; height: 28px; }
.nav-links { display: flex; gap: 24px; margin-left: auto; list-style: none; }
.nav-links a { color: var(--text-2); font-size: 14px; text-decoration: none; }
.nav-links a:hover { color: var(--text); }
@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav .btn { margin-left: auto; }
}

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 18px; border: 1px solid transparent; border-radius: var(--radius-sm); font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; white-space: nowrap; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:disabled { background: var(--card); color: var(--text-2); cursor: default; }
.btn-ghost { border-color: var(--border); color: var(--text); }
.btn-ghost:hover { border-color: #3a3b40; }
.btn-sm { padding: 7px 14px; font-size: 14px; }
.btn-block { width: 100%; }

/* Hero */
.hero { padding: 88px 0 72px; }
.hero-grid { display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
.hero h1 { font-size: 48px; line-height: 1.1; letter-spacing: -0.02em; }
.hero .lead { max-width: 30em; margin-top: 16px; color: var(--text-2); font-size: 18px; }
.hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 28px; }
.hero-note { margin-top: 12px; color: var(--text-2); font-size: 13px; }
@media (max-width: 900px) {
  .hero { padding: 56px 0 48px; }
  .hero-grid { grid-template-columns: 1fr; gap: 40px; }
  .hero h1 { font-size: 32px; }
}

/* Hero visual: a PiP window with captions floating over a page */
.demo { position: relative; aspect-ratio: 16 / 11; }
.demo-page { position: absolute; inset: 0 14% 12% 0; padding: 22px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.demo-line { height: 10px; margin-bottom: 14px; border-radius: 5px; background: #222328; }
.demo-line:nth-child(1) { width: 45%; height: 14px; background: #2a2b30; }
.demo-line:nth-child(2) { width: 90%; }
.demo-line:nth-child(3) { width: 80%; }
.demo-line:nth-child(4) { width: 86%; }
.demo-line:nth-child(5) { width: 60%; }
.demo-pip {
  position: absolute; right: 0; bottom: 0; width: 64%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--radius-lg);
  background: linear-gradient(160deg, #3b4a5c, #1f2a36 45%, #0e1319);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.demo-caption { position: absolute; bottom: 30%; left: 50%; padding: 3px 10px; transform: translateX(-50%); border-radius: 4px; background: rgba(0, 0, 0, 0.75); font-size: clamp(11px, 1.4vw, 15px); font-weight: 600; white-space: nowrap; }
.demo-bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 12px 10px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.85)); }
.demo-track { height: 3px; border-radius: 3px; background: linear-gradient(to right, var(--accent) 38%, rgba(255, 255, 255, 0.25) 38%); }

/* Sections */
.section { padding: 72px 0; border-top: 1px solid var(--border); }
.section-head { max-width: 40em; margin-bottom: 32px; }
.section-head h2 { font-size: 32px; line-height: 1.2; letter-spacing: -0.01em; }
.section-head p { margin-top: 10px; color: var(--text-2); }
@media (max-width: 600px) {
  .section { padding: 56px 0; }
  .section-head h2 { font-size: 26px; }
}

.sites { display: flex; flex-wrap: wrap; gap: 10px; }
.site-chip { padding: 8px 14px; border: 1px solid var(--border); border-radius: 99px; background: var(--card); font-size: 14px; }
.site-chip.muted { color: var(--text-2); }

.card { padding: 22px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.card h3 { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 16px; }
.card p { color: var(--text-2); font-size: 15px; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-text); font-size: 11px; font-weight: 600; }

.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 900px) { .features { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .features { grid-template-columns: 1fr; } }
.feature-icon { display: grid; place-items: center; width: 36px; height: 36px; margin-bottom: 14px; border-radius: 9px; background: var(--accent-soft); color: var(--accent-text); }
.feature-icon svg { width: 18px; height: 18px; }

.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; list-style: none; counter-reset: step; }
.steps li { counter-increment: step; }
.steps li::before { content: counter(step); display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 12px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 14px; font-weight: 700; }
@media (max-width: 720px) { .steps { grid-template-columns: 1fr; } }
kbd { padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); font: 13px var(--font); }

/* Pricing */
.pricing { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 760px; }
@media (max-width: 720px) { .pricing { grid-template-columns: 1fr; } }
.price-card { display: flex; flex-direction: column; }
.price-card.featured { border-color: var(--accent); }
.price-card .price { margin: 8px 0 16px; font-size: 32px; font-weight: 700; }
.price-card .price span { color: var(--text-2); font-size: 14px; font-weight: 400; }
.price-card .btn { margin-top: auto; }
.check-list { display: grid; gap: 8px; margin-bottom: 22px; list-style: none; }
.check-list li { display: flex; align-items: flex-start; gap: 10px; color: var(--text); font-size: 15px; }
.check-list svg { flex: none; width: 18px; height: 18px; margin-top: 3px; color: var(--accent); }

/* FAQ */
.accordion { max-width: 760px; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.accordion-item + .accordion-item { border-top: 1px solid var(--border); }
.accordion-trigger { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 18px 20px; border: 0; background: none; font-size: 16px; font-weight: 600; text-align: left; cursor: pointer; }
.accordion-trigger:hover { background: rgba(255, 255, 255, 0.03); }
.accordion-trigger svg { flex: none; width: 18px; height: 18px; color: var(--text-2); transition: transform 0.2s; }
.accordion-item[data-state="open"] .accordion-trigger svg { transform: rotate(180deg); }
.accordion-content { display: none; padding: 0 20px 18px; color: var(--text-2); }
.accordion-item[data-state="open"] .accordion-content { display: block; }

/* Footer */
.site-footer { padding: 32px 0 40px; border-top: 1px solid var(--border); color: var(--text-2); font-size: 14px; }
.footer-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.footer-links { display: flex; flex-wrap: wrap; gap: 20px; list-style: none; }
.footer-links a { text-decoration: none; }
.footer-links a:hover { color: var(--text); }
```

- [ ] **Step 6: Accordion script** — replace all of `web/script.js` with:

```js
// FAQ accordion: each question button toggles its answer
document.querySelectorAll('.accordion-trigger').forEach((button) => {
  button.addEventListener('click', () => {
    const item = button.closest('.accordion-item');
    const open = item.dataset.state !== 'open';
    item.dataset.state = open ? 'open' : 'closed';
    button.setAttribute('aria-expanded', String(open));
  });
});

document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});
```

- [ ] **Step 7: Landing page** — replace all of `web/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SubPIP · Picture-in-Picture with subtitles</title>
  <meta name="description" content="SubPIP keeps subtitles when you pop a video out into Picture-in-Picture. Works on YouTube, Netflix, Disney+ Hotstar and more.">
  <meta name="google-site-verification" content="8d2RQim-pa1k3qIsEEiFXSmktRfVQa0P2tWGlJwGkiQ">
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html"><img src="logo.svg" alt="" width="28" height="28">SubPIP</a>
      <ul class="nav-links">
        <li><a href="#features">Features</a></li>
        <li><a href="#pricing">Pricing</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ul>
      <a class="btn btn-primary btn-sm" href="https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg">Add to Chrome</a>
    </div>
  </header>

  <main>
    <section class="hero" id="hero">
      <div class="container hero-grid">
        <div>
          <h1>Picture-in-Picture, with subtitles.</h1>
          <p class="lead">SubPIP keeps the captions when you pop a video out, so you can follow every line while you work in another tab.</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg">Add to Chrome, it's free</a>
            <a class="btn btn-ghost" href="#pricing">See Premium</a>
          </div>
          <p class="hero-note">Works in Chrome, Edge and Brave. Press <kbd>Alt</kbd>+<kbd>P</kbd> on any video.</p>
        </div>
        <div class="demo" aria-hidden="true">
          <div class="demo-page"><div class="demo-line"></div><div class="demo-line"></div><div class="demo-line"></div><div class="demo-line"></div><div class="demo-line"></div></div>
          <div class="demo-pip">
            <div class="demo-caption">I told you we'd make it back.</div>
            <div class="demo-bar"><div class="demo-track"></div></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section" id="sites">
      <div class="container">
        <div class="section-head"><h2>Works where you watch</h2><p>Built-in caption support for the big streaming sites, and the video's own captions everywhere else.</p></div>
        <div class="sites">
          <span class="site-chip">YouTube</span>
          <span class="site-chip">Netflix</span>
          <span class="site-chip">Disney+ Hotstar</span>
          <span class="site-chip">JioCinema</span>
          <span class="site-chip">Crunchyroll</span>
          <span class="site-chip muted">Any site with built-in captions</span>
        </div>
      </div>
    </section>

    <section class="section" id="features">
      <div class="container">
        <div class="section-head"><h2>Everything a mini player should do</h2><p>A floating window with real controls and captions you can actually read.</p></div>
        <div class="features">
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4"/></svg></div>
            <h3>Captions in PiP</h3>
            <p>Subtitles follow the video into the floating window and stay above the controls.</p>
          </article>
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg></div>
            <h3>Caption styling</h3>
            <p>Pick Classic, Large or Outline, or set your own size, colors and background.</p>
          </article>
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h9M8.5 3v2M6 5c1 4 4 7 7 8M11 5c-1 4-4 7-7 8M13 21l4-10 4 10M14.5 17h5"/></svg></div>
            <h3>Translation <span class="tag">Premium</span></h3>
            <p>Real-time caption translation into 12 languages while you watch.</p>
          </article>
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 12l5-3"/><path d="M4 16a8 8 0 1 1 16 0"/></svg></div>
            <h3>Speed control <span class="tag">Premium</span></h3>
            <p>Play anywhere from 0.5× to 3×, right from the PiP window.</p>
          </article>
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="14" rx="2"/><rect x="11" y="10" width="8" height="6" rx="1"/></svg></div>
            <h3>Auto PiP</h3>
            <p>Optional: switch tabs and the video pops out on its own (Chrome 134+).</p>
          </article>
          <article class="card">
            <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg></div>
            <h3>Keyboard shortcuts</h3>
            <p>Space, arrows, M to mute, C for captions, and Alt+P to open.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="container">
        <div class="section-head"><h2>How it works</h2></div>
        <ol class="steps">
          <li class="card"><h3>Install</h3><p>Add SubPIP to Chrome from the Web Store. It's free.</p></li>
          <li class="card"><h3>Play a video</h3><p>On YouTube, Netflix or any site, with captions turned on.</p></li>
          <li class="card"><h3>Press <kbd>Alt</kbd>+<kbd>P</kbd></h3><p>Or click the SubPIP icon and choose Open Picture-in-Picture.</p></li>
        </ol>
      </div>
    </section>

    <section class="section" id="pricing">
      <div class="container">
        <div class="section-head"><h2>Simple pricing</h2><p>SubPIP is free. Premium is a one-time payment, no subscription.</p></div>
        <div class="pricing">
          <article class="card price-card">
            <h3>Free</h3>
            <div class="price">₹0</div>
            <ul class="check-list">
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Captions in Picture-in-Picture</li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Caption styling and presets</li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Auto PiP and keyboard shortcuts</li>
            </ul>
            <a class="btn btn-ghost btn-block" href="https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg">Add to Chrome</a>
          </article>
          <article class="card price-card featured">
            <h3>Premium <span class="tag">Lifetime</span></h3>
            <div class="price">₹1000 <span>lifetime</span></div>
            <ul class="check-list">
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Everything in Free</li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Real-time caption translation</li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Playback speed 0.5×–3×</li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Load subtitle files (VTT / SRT)</li>
            </ul>
            <a class="btn btn-primary btn-block" href="premium.html">Get Premium</a>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="container">
        <div class="section-head"><h2>Questions</h2></div>
        <div class="accordion">
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">What does SubPIP do?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>It opens the video you're watching in a floating Picture-in-Picture window together with its subtitles, so you can keep following the dialogue while you work in other tabs or apps.</p></div>
          </div>
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">Which sites work?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>YouTube, Netflix, Disney+ Hotstar, JioCinema and Crunchyroll have built-in support. On other sites, SubPIP uses the video's own captions when the page provides them.</p></div>
          </div>
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">What does Premium add?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>Real-time caption translation into 12 languages, playback speed from 0.5× to 3×, and loading your own subtitle files (VTT or SRT). It's one payment of ₹1000, with no subscription.</p></div>
          </div>
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">How do I activate Premium?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>After paying you get a license key. Open the SubPIP popup, sign in with the same email, and paste the key under Account &amp; license, or press "Check payment".</p></div>
          </div>
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">Does SubPIP collect my data?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>Your settings stay in your browser. If you sign in, your email and license status are stored with Firebase. When translation is on, caption text is sent to the translation service. See the <a href="privacy.html">Privacy Policy</a>.</p></div>
          </div>
          <div class="accordion-item" data-state="closed">
            <button class="accordion-trigger" type="button" aria-expanded="false">Which browsers are supported?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            <div class="accordion-content"><p>Chrome and other Chromium browsers such as Edge and Brave, version 116 or newer (they need Document Picture-in-Picture).</p></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-row">
      <a class="brand" href="index.html"><img src="logo.svg" alt="" width="28" height="28">SubPIP</a>
      <ul class="footer-links">
        <li><a href="privacy.html">Privacy Policy</a></li>
        <li><a href="mailto:tarunmonga2208@gmail.com">Contact</a></li>
        <li>© <span data-year></span> SubPIP</li>
      </ul>
    </div>
  </footer>
  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 8: Run the tests**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-landing.test.js`
Expected: PASS (6 tests).

- [ ] **Step 9: Lint, full suite, commit**

```bash
npm run lint && npm run test
git add web/style.css web/index.html web/script.js web/logo.svg tests
git commit -m "feat(web): Cinema landing page and shared site styles"
```

---

### Task 2: Checkout page

**Files:**
- Rewrite: `web/premium.html` (markup and styles; the `<script type="module">` block is kept byte-for-byte)
- Modify: `web/style.css` (append checkout styles)
- Create: `tests/e2e/web-premium.test.js`

**Interfaces:**
- Consumes: `useWebsite`, `ctx.open(..., { intercept })` (Task 1); shared classes (Task 1).
- Produces: `razorpayStub({ mode = 'success' | 'failed' | 'blocked' })`, `confirmStub({ ok = true })` in `tests/helpers/web.js`.

- [ ] **Step 1: Stubs** — append to `tests/helpers/web.js`:

```js
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
```

- [ ] **Step 2: Write the failing tests** — `tests/e2e/web-premium.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, confirmStub, both } from '../helpers/web.js';
import { sleep } from '../helpers/browser.js';

const ctx = useWebsite();

const state = (page) => page.evaluate(() => ({
  paying: !document.getElementById('paymentSection').classList.contains('hide'),
  success: document.getElementById('successSection').classList.contains('show'),
  key: document.getElementById('licenseKey').textContent,
  email: document.getElementById('userEmailDisplay').textContent,
  error: document.getElementById('errorMsg').classList.contains('show') ? document.getElementById('errorMsg').textContent : null,
  buttonDisabled: document.getElementById('payBtn').disabled
}));

async function pay(page, email = 'buyer@example.com') {
  await page.type('#emailInput', email);
  await page.click('#payBtn');
}

test('checkout card shows price, features and the pay button', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  const card = await page.evaluate(() => ({
    title: document.querySelector('.checkout h1').textContent.trim(),
    price: document.querySelector('.checkout .price').textContent.replace(/\s+/g, ' ').trim(),
    features: document.querySelectorAll('.checkout .check-list li').length,
    pay: document.getElementById('payBtn').textContent.trim()
  }));
  assert.deepEqual(card, { title: 'SubPIP Premium', price: '₹1000 · lifetime', features: 4, pay: 'Pay ₹1000' });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('a successful payment shows the license key', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub()) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('successSection').classList.contains('show'));
  const s = await state(page);
  assert.deepEqual({ paying: s.paying, key: s.key, email: s.email }, { paying: false, key: 'SUBPIP-TESTKEY1-ABCD', email: 'buyer@example.com' });
  await page.close();
});

test('an invalid email is caught before opening Razorpay', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  await pay(page, 'not-an-email');
  assert.equal((await state(page)).error, 'Please enter a valid email address');
  assert.equal(await page.evaluate(() => !!window.__rzpOpened), false);
  await page.close();
});

test('a declined card shows the reason', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  await page.evaluate(() => { window.__rzpMode = 'failed'; });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  assert.equal((await state(page)).error, 'Payment failed: Card declined');
  await page.close();
});

test('a blocked payment gateway gives a clear message and a usable button', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub({ blocked: true }) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  const s = await state(page);
  assert.match(s.error, /Failed to load payment gateway/);
  assert.equal(s.buttonDisabled, false);
  await page.close();
});

test('if confirmation fails, the payment ID is shown for support', async () => {
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), confirmStub({ ok: false })) });
  await pay(page);
  await page.waitForFunction(() => document.getElementById('errorMsg').classList.contains('show'));
  assert.match((await state(page)).error, /pay_TEST123/);
  await page.close();
});

test('a returning buyer sees their saved license', async () => {
  const page = await ctx.open('premium.html', { intercept: razorpayStub() });
  await page.evaluate(() => localStorage.setItem('subpip_license', JSON.stringify({ licenseKey: 'SUBPIP-SAVED123-XYZ1', email: 'me@example.com' })));
  await page.reload({ waitUntil: 'load' });
  await sleep(200);
  const s = await state(page);
  assert.deepEqual({ success: s.success, key: s.key }, { success: true, key: 'SUBPIP-SAVED123-XYZ1' });
  await page.evaluate(() => localStorage.clear());
  await page.close();
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-premium.test.js`
Expected: FAIL (no `.checkout` card; old page loads the old `script.js` dark-mode code).

- [ ] **Step 4: Checkout styles** — append to `web/style.css`:

```css
/* Checkout */
.checkout-wrap { padding: 56px 0 72px; }
.checkout { max-width: 440px; margin: 0 auto; }
.checkout .back-link { display: inline-block; margin-bottom: 16px; color: var(--text-2); font-size: 14px; text-decoration: none; }
.checkout .back-link:hover { color: var(--text); }
.checkout-card { padding: 28px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.checkout h1 { font-size: 26px; line-height: 1.2; }
.checkout .price { margin: 10px 0 20px; font-size: 28px; font-weight: 700; }
.checkout .price span { color: var(--text-2); font-size: 15px; font-weight: 400; }
.field-label { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 600; }
.email-input { width: 100%; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); outline: none; }
.email-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
.pay-btn { margin-top: 12px; }
.secure-badge { margin-top: 12px; color: var(--text-2); font-size: 13px; text-align: center; }
.loading, .error-msg { display: none; margin-top: 12px; font-size: 14px; }
.loading.show, .error-msg.show { display: block; }
.loading { color: var(--text-2); }
.error-msg { color: var(--danger-text); }
.payment-container.hide { display: none; }
.success-container { display: none; }
.success-container.show { display: block; }
.success-icon { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 14px; border-radius: 50%; background: rgba(62, 207, 142, 0.15); color: var(--success); }
.success-icon svg { width: 22px; height: 22px; }
.license-box { margin: 20px 0; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.license-label { color: var(--text-2); font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.license-key { margin: 8px 0 12px; font: 600 18px var(--mono); overflow-wrap: anywhere; }
.instructions h2 { margin-bottom: 8px; font-size: 16px; }
.instructions ol { display: grid; gap: 6px; padding-left: 20px; color: var(--text-2); }
```

- [ ] **Step 5: Checkout markup** — rewrite `web/premium.html` so that:
  1. The `<head>` is exactly:

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SubPIP Premium</title>
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="style.css">
</head>
```

  (the old inline `<style>` block is removed).

  2. Everything from `<body>` up to the existing `<script type="module">` line is replaced with:

```html
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="index.html"><img src="logo.svg" alt="" width="28" height="28">SubPIP</a>
      <ul class="nav-links">
        <li><a href="index.html#features">Features</a></li>
        <li><a href="index.html#faq">FAQ</a></li>
      </ul>
      <a class="btn btn-ghost btn-sm" href="mailto:tarunmonga2208@gmail.com">Contact</a>
    </div>
  </header>

  <main class="checkout-wrap">
    <div class="container checkout">
      <a class="back-link" href="index.html">← Back to home</a>

      <div class="checkout-card payment-container" id="paymentSection">
        <h1>SubPIP Premium</h1>
        <div class="price">₹1000 <span>· lifetime</span></div>
        <ul class="check-list">
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Real-time caption translation (12 languages)</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Playback speed 0.5×–3×</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Load subtitle files (VTT / SRT)</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>One payment, no subscription</li>
        </ul>
        <label class="field-label" for="emailInput">Email for your receipt and license</label>
        <input type="email" id="emailInput" class="email-input" placeholder="you@example.com" autocomplete="email">
        <button class="btn btn-primary btn-block pay-btn" id="payBtn" type="button" onclick="initiatePayment()">Pay ₹1000</button>
        <p class="secure-badge">Secured by Razorpay</p>
        <p class="loading" id="loading" role="status">Creating your license…</p>
        <p class="error-msg" id="errorMsg" role="alert"></p>
      </div>

      <div class="checkout-card success-container" id="successSection">
        <div class="success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div>
        <h1>Payment successful</h1>
        <p class="muted">Your Premium license is ready.</p>
        <div class="license-box">
          <div class="license-label">Your license key</div>
          <div class="license-key" id="licenseKey"></div>
          <button class="btn btn-ghost btn-sm copy-btn" type="button" onclick="copyLicense()">Copy license key</button>
        </div>
        <div class="instructions">
          <h2>Activate it</h2>
          <ol>
            <li>Click the SubPIP icon in your browser.</li>
            <li>Sign in with <strong id="userEmailDisplay"></strong>.</li>
            <li>Paste the key under Account &amp; license and press Activate.</li>
          </ol>
        </div>
      </div>
    </div>
  </main>

  <footer class="site-footer">
    <div class="container footer-row">
      <a class="brand" href="index.html"><img src="logo.svg" alt="" width="28" height="28">SubPIP</a>
      <ul class="footer-links">
        <li><a href="privacy.html">Privacy Policy</a></li>
        <li><a href="mailto:tarunmonga2208@gmail.com">Contact</a></li>
        <li>© <span data-year></span> SubPIP</li>
      </ul>
    </div>
  </footer>
```

  3. The existing `<script type="module"> … </script>` block stays exactly as it is.
  4. Everything after that block (the old `script.js` include and the inline year script) is replaced with:

```html
  <script src="script.js"></script>
</body>
</html>
```

  5. Inside the module script, the copy button's success text uses the element's own text node, which still works: `copyLicense()` sets `.copy-btn` text to "✓ Copied!" and back to "Copy License Key". Change only that restore string to match the new casing: `btn.textContent = 'Copy license key';`.

Verify the payment script is otherwise untouched:

```bash
git diff web/premium.html | grep -E '^[-+]' | grep -vE '^(\+\+\+|---)' | grep -E 'RAZORPAY|confirmPayment|handlePaymentSuccess|localStorage|initiatePayment = ' || echo "payment logic unchanged"
```

Expected: `payment logic unchanged`.

- [ ] **Step 6: Run the tests**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-premium.test.js`
Expected: PASS (7 tests).

- [ ] **Step 7: Lint, full suite, commit**

```bash
npm run lint && npm run test
git add web/premium.html web/style.css tests
git commit -m "feat(web): single-card checkout page"
```

---

### Task 3: Privacy page

**Files:**
- Rewrite: `web/privacy.html` (markup only; the policy wording is unchanged)
- Modify: `web/style.css` (append prose styles)
- Create: `tests/e2e/web-privacy.test.js`

**Interfaces:**
- Consumes: shared header/footer classes (Task 1).

- [ ] **Step 1: Write the failing test** — `tests/e2e/web-privacy.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { useWebsite } from '../helpers/web.js';

const ctx = useWebsite();

test('privacy policy uses the shared layout and keeps all nine sections', async () => {
  const page = await ctx.open('privacy.html');
  const info = await page.evaluate(() => ({
    header: !!document.querySelector('.site-header .brand'),
    footer: !!document.querySelector('.site-footer'),
    prose: !!document.querySelector('article.prose'),
    headings: [...document.querySelectorAll('.prose h2')].map((h) => h.textContent.trim().split('.')[0]),
    date: document.getElementById('privacyDate').textContent.length > 0,
    inlineStyles: document.querySelectorAll('main [style]').length
  }));
  assert.deepEqual(info, { header: true, footer: true, prose: true, headings: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], date: true, inlineStyles: 0 });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('policy wording is unchanged', async () => {
  const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const page = await ctx.open('privacy.html');
  const body = text(await page.$eval('article.prose', (el) => el.innerHTML));
  const original = await readFile(new URL('./privacy-wording.txt', import.meta.url), 'utf8');
  for (const sentence of original.trim().split('\n')) assert.ok(body.includes(sentence), `missing: ${sentence}`);
  await page.close();
});
```

Create `tests/e2e/privacy-wording.txt` with one key sentence per section, captured from the current page before rewriting it:

```
SubPIP ("we", "our", or "the extension") is a browser extension that provides Picture-in-Picture video with subtitles, caption customization, and optional translation.
Caption preferences (font size, color, position, playback speed, translation language).
Email and authentication state are handled by Firebase Authentication.
To provide Picture-in-Picture, subtitles, and playback controls on the sites you use.
We use the following services; each has its own privacy policy:
We request only the permissions needed for the extension to work:
Settings and local caches are stored in your browser.
You can disable the extension or revoke permissions at any time.
We may update this Privacy Policy from time to time.
For privacy-related questions or requests, contact us at:
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-privacy.test.js`
Expected: both FAIL: the page has no `.site-header` or `article.prose` yet and still uses inline styles. The wording file itself was captured from the current page, so once the markup is rebuilt the wording test proves the text survived.

- [ ] **Step 3: Prose styles** — append to `web/style.css`:

```css
/* Long-form text (privacy policy) */
.prose { max-width: 760px; margin: 0 auto; padding: 56px 0 72px; }
.prose h1 { font-size: 36px; line-height: 1.15; }
.prose .updated { margin: 8px 0 32px; color: var(--text-2); }
.prose section + section { margin-top: 28px; }
.prose h2 { margin-bottom: 8px; font-size: 20px; }
.prose p, .prose li { color: #c8c9cd; }
.prose ul { display: grid; gap: 6px; margin: 8px 0 0 22px; }
.prose p + p, .prose p + ul, .prose ul + p { margin-top: 10px; }
.prose a { color: var(--accent-text); }
```

- [ ] **Step 4: Privacy markup** — rewrite `web/privacy.html`:
  1. `<head>`: same as the checkout page's head, with `<title>Privacy Policy · SubPIP</title>`.
  2. Header and footer: the same `<header class="site-header">…</header>` as the landing page (Task 1 Step 7) and the same `<footer class="site-footer">…</footer>`.
  3. `<main>` becomes:

```html
  <main class="container">
    <article class="prose">
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: <span id="privacyDate"></span></p>
      <!-- sections 1–9 -->
    </article>
  </main>
```

  where `<!-- sections 1–9 -->` is replaced by the nine existing `<section>` elements copied from the current file with every `style="…"` attribute removed and nothing else changed (headings, paragraphs, lists, links and their text stay identical).

  4. Scripts at the end of `<body>`:

```html
  <script src="script.js"></script>
  <script>
    document.getElementById('privacyDate').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  </script>
```

  (the date behavior is unchanged; see Task 4's report note).

- [ ] **Step 5: Run the tests**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-privacy.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Lint, full suite, commit**

```bash
npm run lint && npm run test
git add web/privacy.html web/style.css tests
git commit -m "feat(web): privacy page on the shared layout"
```

---

### Task 4: Cross-page checks, cleanup and screenshots

**Files:**
- Create: `tests/e2e/web-site.test.js`
- Delete: `web/image.png`, `web/img.png`, `web/logo.png`

- [ ] **Step 1: Write the failing tests** — `tests/e2e/web-site.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { useWebsite, razorpayStub } from '../helpers/web.js';
import { WEB_DIR } from '../helpers/browser.js';

const ctx = useWebsite();
const PAGES = ['index.html', 'premium.html', 'privacy.html'];

test('no page scrolls sideways on a phone', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { width: 390, height: 844, intercept: razorpayStub() });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0, `${pagePath} overflows by ${overflow}px`);
    await page.close();
  }
});

test('on a phone the nav shows only the logo and the main button', async () => {
  const page = await ctx.open('index.html', { width: 390, height: 844 });
  const nav = await page.evaluate(() => ({
    links: getComputedStyle(document.querySelector('.nav-links')).display,
    button: getComputedStyle(document.querySelector('.nav .btn')).display !== 'none',
    brand: getComputedStyle(document.querySelector('.nav .brand')).display !== 'none'
  }));
  assert.deepEqual(nav, { links: 'none', button: true, brand: true });
  await page.close();
});

test('every local link and asset exists', async () => {
  const missing = [];
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    const refs = await page.evaluate(() => [...document.querySelectorAll('[href], [src]')]
      .map((el) => el.getAttribute('href') || el.getAttribute('src')));
    for (const ref of refs) {
      if (/^(https?:|mailto:|data:|#)/.test(ref)) continue;
      const file = ref.split('#')[0];
      if (file && !existsSync(path.join(WEB_DIR, file))) missing.push(`${pagePath} → ${ref}`);
    }
    await page.close();
  }
  assert.deepEqual(missing, []);
});

test('old images are gone', () => {
  for (const file of ['image.png', 'img.png', 'logo.png']) {
    assert.equal(existsSync(path.join(WEB_DIR, file)), false, `${file} still in web/`);
  }
});

test('pages load without console errors', async () => {
  for (const pagePath of PAGES) {
    const page = await ctx.open(pagePath, { intercept: razorpayStub() });
    assert.deepEqual(page.errors, [], pagePath);
    await page.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-concurrency=1 --test-timeout=30000 tests/e2e/web-site.test.js`
Expected: FAIL only on `old images are gone`.

- [ ] **Step 3: Delete the old images**

```bash
grep -rn "image.png\|img.png\|logo.png" web && echo "STILL REFERENCED" || git rm -q web/image.png web/img.png web/logo.png
```

Expected: no "STILL REFERENCED" output.

- [ ] **Step 4: Run all tests**

Run: `npm run lint && npm run test`
Expected: all pass.

- [ ] **Step 5: Screenshots** — with the website harness, screenshot all three pages full-length at 1440px and 390px wide, plus the checkout success state. Check each against the Cinema direction (dark surfaces, one red accent, no gradients on buttons, readable at phone width). Fix any visual defect found, with a test when behavior is involved.

- [ ] **Step 6: Commit and report**

```bash
git add tests web
git commit -m "chore(web): cross-page checks and remove replaced images"
```

Report to the owner: screenshots, test counts, and these privacy-policy gaps (wording left unchanged per spec §5.3):
- The "Last updated" date is generated from today's date on every visit, so it never reflects a real revision date.
- §5 lists `tabs`, `windows` and always-on `all_urls` permissions; the extension now asks for `activeTab`, `scripting`, `storage` and only requests all-sites access (optionally) for Auto PiP.
- §4 names MyMemory for translation but not Google Cloud Translation, which Premium translation uses.
- §9 points to a personal site rather than a direct privacy contact.
