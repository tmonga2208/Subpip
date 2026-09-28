# SubPIP UI/UX Redesign

**Date:** 2026-09-28
**Status:** Draft for review

## Goal

Make SubPIP feel **polished and trustworthy**: people should be comfortable installing it and paying ₹1000 for Premium. Redesign all three surfaces with one shared visual language, in this order:

1. PiP window (`src/content/`)
2. Extension popup (`src/popup.html`, `src/popup.css`, `src/popup/`)
3. Website (`web/`)

Each surface is designed, built and verified before the next starts.

## Decisions

| Question | Choice |
|---|---|
| Visual direction | **Cinema**: near-black surfaces, one red accent, icon controls that sit over the video like Netflix/YouTube |
| PiP layout | **Bottom bar + settings menu** (YouTube-style) |
| Popup structure | **Home screen + drill-in sub-pages**, settings save instantly |
| Website stack | Static HTML/CSS on Vercel (no framework), dark only |
| Logo | Replace the current `logo.png` (a wireframe sketch containing "lorem ipsum") with a new mark |

## Non-goals

- No changes to payment, license or auth logic (only their UI).
- No new features beyond: the captions on/off (CC) toggle, caption presets, M/C shortcuts, and the popup's page status check.
- Chrome Web Store listing assets are out of scope.
- Privacy policy wording is not rewritten (see §5.3).

## 1. Shared visual system

### 1.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0b0c` | Page / window background |
| `--surface` | `#111214` | Popup body, menus |
| `--card` | `#17181b` | Cards, status box, inputs |
| `--border` | `#25262a` | Dividers, outlines |
| `--text` | `#f2f2f2` | Primary text |
| `--text-2` | `#8b8d93` | Secondary text, hints |
| `--accent` | `#ff4d5e` | Primary buttons, seek fill, focus ring, active states |
| `--accent-soft` | `rgba(255,77,94,0.15)` | Premium badge / tag background |
| `--accent-text` | `#ff7a86` | Premium badge / tag text |
| `--success` | `#3ecf8e` | "Video found" dot, success messages |
| `--danger-text` | `#ff8a8a` | Inline error text |
| `--radius-sm` | `8px` | Buttons, inputs, menu items |
| `--radius-lg` | `12px` | Cards, popup sections, menus |

No gradients on buttons. Over-video gradients (bottom fade) are the only gradients.

### 1.2 Type

System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`); no web fonts in the extension. Popup sizes: 11 (hints), 12 (body), 13 (labels/buttons), 15 (primary button). Website headings may go larger (hero ~48px desktop / 32px mobile).

### 1.3 Icons

One inline-SVG icon set (24×24 viewBox, 2px strokes or solid fills) in `src/shared/icons.js`, exported as SVG strings: play, pause, back10, forward10, volume, volume-muted, cc, cc-off, gear, check, chevron-right, chevron-left, lock, fill, close, spinner. The website copies the SVGs it needs inline.

### 1.4 Logo

New mark: a rounded red square (`--accent`) containing a white window outline with a short white caption bar near its bottom edge. Deliverables:

- `src/assets/logo.svg` (source)
- `src/assets/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` (rendered from the SVG; manifest `icons` and `action.default_icon` point to these)
- `web/logo.svg` (site nav and favicon)

Old `logo.png` and `icon28.png` are removed once nothing references them.

### 1.5 Accessibility

- Every icon-only button has an `aria-label` and a `title`.
- Visible focus ring: `2px solid var(--accent)` with 2px offset, on keyboard focus (`:focus-visible`).
- Text contrast meets WCAG AA against its background.
- Menus and sub-pages are keyboard reachable; Escape closes the PiP settings menu and goes back one level in the popup.

## 2. PiP window

### 2.1 Structure

Controls render inside a **Shadow DOM** root attached to a host element in the PiP document. The PiP window copies the site's stylesheets (needed for mirrored caption styling), which today can restyle our controls; the shadow root isolates them. Captions stay outside the shadow root (they must keep site styles).

```
PiP <body>
├── <video>                      (moved from the page)
├── caption element              (mirrored / text captions, unchanged sources)
└── <subpip-controls> #shadow-root
    ├── bottom gradient
    ├── control bar
    └── settings menu (hidden until opened)
```

### 2.2 Control bar

Over a bottom fade (`transparent → rgba(0,0,0,0.85)`), two rows:

1. **Seek bar**: 3px track, 5px on hover; `--accent` fill and thumb; hovering shows a small time tooltip at the cursor position. Drag-to-preview, seek-on-release (current behavior kept). Hidden for live streams (duration shows "Live").
2. **Buttons row**, left: play/pause · back 10s · forward 10s · volume (icon toggles mute; a slider expands to the right on hover/focus) · `12:04 / 31:40`. Right: **CC** (captions on/off) · **gear** (settings menu).

Visibility: the bar and the cursor show on mouse move and hide after 2.5s idle; they stay visible while the pointer is over the bar or the menu is open. While visible, captions shift up by the bar's height so they are never covered.

### 2.3 Settings menu

Opens above the gear, right-aligned, `--surface` background, `--radius-lg`, max 240px wide. Items show their current value and a chevron; selecting one swaps the menu to a sub-list with a back row.

| Item | Values | Free users |
|---|---|---|
| Speed | 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×, 2.5×, 3× | Row shows **Premium** tag; opening it shows "Upgrade in the SubPIP popup" |
| Caption size | S, M, L, XL (14 / 18 / 24 / 32 px) | Available |
| Translate | Off, then the 12 supported languages | **Premium** tag, same as Speed |
| Fill window | Toggle (object-fit fill ↔ contain) | Available |

Caption size and translation changes made here apply immediately in the PiP window only; they do not overwrite the popup's saved settings. Clicking outside the menu or pressing Escape closes it.

### 2.4 CC toggle

Hides/shows the caption element in the PiP window. State is per PiP session (starts on). The icon switches between `cc` and `cc-off`.

### 2.5 Keyboard shortcuts (in the PiP window)

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | Seek −10s / +10s |
| ↑ / ↓ | Volume ±10% |
| M | Mute / unmute (new) |
| C | Captions on / off (new) |
| Esc | Close settings menu |

Shortcuts are ignored while focus is in an input or select.

### 2.6 Caption presets

Caption appearance comes from a preset or custom values (§3.3). Presets map to existing settings fields:

| Preset | fontSize | textColor | bgColor | bgOpacity | Outline |
|---|---|---|---|---|---|
| Classic | 18 | `#ffffff` | `#000000` | 75 | none |
| Large | 26 | `#ffffff` | `#000000` | 75 | none |
| Outline | 20 | `#ffffff` | — | 0 | black text-shadow outline |
| Custom | user values | | | | |

New settings fields: `captionPreset` (`classic` \| `large` \| `outline` \| `custom`, default `classic`) and `captionOutline` (boolean, default `false`). `generateSubtitleStyles` uses `captionOutline` to emit a 4-direction black text-shadow instead of the current glow.

### 2.7 Files

- `src/content/controls.js`: rewritten (bar, menu, shortcuts) using Shadow DOM.
- `src/content/controls.css.js`: control styles as a string (injected into the shadow root).
- `src/content/styles.js`: caption styles gain outline support.
- `src/content/pip-window.js`: mounts the controls host, wires caption shift and CC.
- `src/shared/icons.js`: new.
- `src/shared/settings.js`: new fields and `CAPTION_PRESETS`.

## 3. Popup

### 3.1 Frame

340px wide, max 600px tall (Chrome's limit), `--surface` background. A header row stays fixed: logo · "SubPIP" · plan badge (**Free** in grey, **Premium** in `--accent-soft`) · account button (initial of the email, or a person icon when signed out). Sub-pages slide in from the right with a back arrow and title in place of the header content.

### 3.2 Home

1. **Status card** (`--card`). When the popup opens it runs a small detection script on the active tab (allowed by `activeTab`), returning `{ hasVideo, site, captionSource, pipOpen }`.

   | State | Dot | Title | Subtitle |
   |---|---|---|---|
   | Video found | green | Video found on `youtube.com` | Captions: YouTube / Captions: page text track / No captions detected |
   | PiP already open | green | Playing in Picture-in-Picture | on `youtube.com` |
   | No video | grey | No video on this page | Play a video, then open SubPIP |
   | Restricted page | grey | SubPIP can't run on this page | Chrome pages and the Web Store are off-limits |

   An `Alt+P` key hint sits at the right of the card.

2. **Primary button** (`--accent`, 15px): "Open Picture-in-Picture"; "Close Picture-in-Picture" when `pipOpen`; disabled with the status text when no video or restricted.

3. **Captions section**: a live preview (a 16:9 strip with a dark scene gradient and one sample caption rendered with the current style), then four preset chips: Classic · Large · Outline · Custom ›. Choosing a chip applies it instantly; Custom opens §3.3.

4. **Option rows** (label left, current value + chevron right):
   - Translate captions (Premium tag for free users) → §3.4
   - Playback speed (Premium tag for free users) → §3.5
   - Auto PiP on tab switch → §3.6
   - Account & license → §3.7

### 3.3 Custom caption style

Preview pinned at the top. Controls: Size (slider 12–40, value shown) · Text color (6 swatches + custom picker) · Background color (swatches + picker) · Background opacity (slider 0–100) · Font (Sans, Serif, Mono, Arial, Verdana) · Position (Bottom / Top segmented control) · Outline (toggle) · **Subtitle file URL** (Premium; text input + helper "VTT or SRT link"). Any change sets `captionPreset` to `custom`.

### 3.4 Translate captions

Premium users: on/off toggle, then a radio list of the 12 languages. Free users: the upgrade page (§3.8).

### 3.5 Playback speed

Premium users: radio list 0.5×–3× (default speed when PiP opens). Free users: the upgrade page.

### 3.6 Auto PiP

One paragraph: "Opens Picture-in-Picture automatically when you switch away from a tab playing video. Chrome will ask once for access to all sites so SubPIP can be ready on every page." Then the toggle (existing permission flow).

### 3.7 Account & license

- **Signed out**: segmented Sign in / Create account; email + password fields; primary button. Below: "Have a license key? Sign in first to activate it."
- **Signed in**: email and plan; if Free: license key field + Activate, "Already paid? Check payment", and **Get Premium · ₹1000 lifetime** (opens the website premium page). Sign out at the bottom as a text button.
- Errors appear inline under the relevant field/button in `--danger-text`; the pressed button shows a spinner while working.

### 3.8 Upgrade page (free users)

Shown when a free user opens a Premium row. Lists what Premium unlocks (translation, speed control, subtitle files), the price, and **Get Premium** (opens the website) plus "Already paid? Check payment".

### 3.9 Behavior

- **Instant save**: every control writes to `chrome.storage.sync` (debounced 300ms for sliders). The Save button is removed. Open PiP windows update live via the existing relay.
- The Activate/open flow keeps its current injection order (settings + run flag, `script.js`, save, relay) to preserve user activation.
- Header version text is removed (it showed a stale "v2.4").

### 3.10 Files

- `src/popup.html`: rewritten markup (home + sub-page containers).
- `src/popup.css`: rewritten on the tokens.
- `src/popup/index.js`: split into `src/popup/home.js`, `captions.js`, `account.js`, `router.js` (sub-page navigation), `status.js` (tab detection), `settings-store.js` (instant save), with `index.js` wiring them.
- `src/popup/license-manager.js`: unchanged.

## 4. PiP / popup settings data

`src/shared/settings.js` gains `captionPreset`, `captionOutline` and `CAPTION_PRESETS`. Existing stored settings without these fields get `captionPreset: 'custom'` when their values don't match a preset, so current users keep their look.

## 5. Website

### 5.1 Landing (`web/index.html`)

1. **Nav**: logo · Features · Pricing · FAQ · **Add to Chrome** (accent button linking to the Chrome Web Store listing). Collapses to logo + Add to Chrome on phones.
2. **Hero**: headline "Picture-in-Picture, with subtitles." · one-line subhead · **Add to Chrome, it's free** · secondary link "See Premium". Visual: a CSS-drawn PiP window with a caption, floating over a faint page layout (replaces `image.png`, which includes a Windows taskbar).
3. **Supported sites**: YouTube · Netflix · Disney+ Hotstar · JioCinema · Crunchyroll · "any site with built-in captions".
4. **Features** (6 cards, icon + title + one sentence): Captions in PiP · Caption styling · Translation (Premium) · Speed control (Premium) · Auto PiP · Keyboard shortcuts.
5. **How it works**: 3 steps (Install · Play a video · Press Alt+P).
6. **Pricing**: Free vs Premium cards; Premium ₹1000 lifetime with "Get Premium" → `premium.html`.
7. **FAQ**: existing accordion, answers updated to be accurate (supported sites, what Premium includes, where data goes).
8. **Footer**: logo, Privacy Policy, Contact (mailto), © year.

Removed: dark-mode toggle (dark only), the "download ZIP" link (the file is not in `web/`), the Buy Me a Coffee widget, `image.png` and `img.png` (Chrome Web Store badge replaced by the Add to Chrome button).

### 5.2 Premium (`web/premium.html`)

Same flow and script. One centered card: title, price "₹1000 · lifetime", feature list with check icons, email field, **Pay ₹1000**, "Secured by Razorpay". Success state in the same card: check icon, license key in a monospace box with Copy, and 3 activation steps. Inline `<style>` moves into the shared `style.css`.

### 5.3 Privacy (`web/privacy.html`)

Restyled only. The implementation report will list content gaps for the owner to address: account email storage (Firebase Auth/Firestore), caption text sent to Google Cloud Translation (Premium) and MyMemory (free) for translation, payment data handled by Razorpay, and the optional all-sites permission for auto-PiP.

### 5.4 Files

`web/index.html`, `web/premium.html`, `web/privacy.html`, `web/style.css` (rewritten on the tokens), `web/script.js` (accordion only), `web/logo.svg`.

## 6. Testing

- **PiP** (Puppeteer against `dist/script.js`, existing harness): controls render inside a shadow root and are unaffected by an injected hostile page stylesheet; play/pause, ±10s, mute, volume; seek drag/release; settings menu open/close/Escape; speed (premium) and size apply; free users see Premium tags; CC toggle and C/M shortcuts; captions shift when the bar shows; everything from the current suites still passes.
- **Popup** (Puppeteer loading `dist/`, opening `popup.html` as an extension page with a test tab): status card for video / no video / restricted page; preset chips update storage and preview; sub-page navigation and Escape; instant save reaches an open page via the relay; signed-out / free / premium account states render correctly (auth stubbed).
- **Website**: screenshots at 1440px and 390px widths for all three pages; no horizontal scroll at 390px; all links resolve.
- `npm run lint` and `npm run build` pass.

## 7. Order of work

1. Shared: tokens, icons, logo + icons, settings fields.
2. PiP window.
3. Popup.
4. Website.

Each step ends with its tests passing and a short review with the owner before the next begins.
