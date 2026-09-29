# SubPIP

SubPIP is a browser extension that adds subtitles to Picture-in-Picture (PiP) mode. It currently works with Netflix and YouTube.

---

## Features

- Subtitles in PiP mode.
- Compatible with Netflix and YouTube.
- Easy-to-use interface.

---

## Installation

1. Download or clone this repository.
2. Build it: `npm install && npm run build` (creates `dist/`).
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable Developer Mode.
5. Click **Load unpacked** and select the `dist/` folder.

---

## Usage

1. Play a video on Netflix or YouTube.
2. Click the SubPIP extension icon.
3. Watch in PiP mode with subtitles.

---

## Known Issues

- SeekBar Not Working.
- Currently supports only Netflix and YouTube.

---

## Roadmap

- Add support for more platforms.

---

## Edit

- Added Hotstar/DisneyPlus Support
- Added JioCinema support

---

## Documentation

Full technical documentation is available in [documentation.md](file:///Users/tarunmonga/.gemini/antigravity/brain/bf01cbe6-60f8-41ee-90f0-559536c290bb/documentation.md).

### Quick Start
1. **Extension**: `npm install && npm run build`, then load `dist/` as an unpacked extension. Use `npm run watch` while developing, `npm run lint` to lint, and `npm run package` to build `subpip.zip` for the Chrome Web Store.
2. **Backend + website**: `web/` deploys to Vercel with `cd web && vercel --prod`; `web/api/` holds the server functions (orders, payments, licenses, license emails, translation, health). Firestore rules deploy with `firebase deploy --only firestore:rules` (free Spark plan).

### Configuration (Vercel → Project → Environment Variables, Production)

| Variable | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON (Admin SDK) |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook secret (events: `payment.captured`, `refund.processed`) → `https://subpip.vercel.app/api/razorpayWebhook` |
| `DEEPL_API_KEY` | DeepL API Free key (Premium translation; optional — without it translation falls back to MyMemory) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Gmail account and app password for license emails and alerts |
| `ALERT_EMAIL` | Optional; where owner alerts go (defaults to `GMAIL_USER`) |

`GET /api/health` reports which settings are present (never their values) and returns 503 if a required one is missing; point an uptime monitor at it.


