# SubPIP

Picture-in-Picture that keeps the subtitles. SubPIP pops the video you are watching into a floating window together with its captions, with real player controls, caption styling and optional translation.

- **Install:** [SubPIP on the Chrome Web Store](https://chromewebstore.google.com/detail/subpip-picture-in-picture/cajeijlommigmipnnhemgopednbpmnjg)
- **Website:** <https://subpip.vercel.app>
- **Browsers:** Chrome, Edge, Brave and other Chromium browsers, version 116 or newer (SubPIP is built on Document Picture-in-Picture)

## What it does

Free:

- Captions in the Picture-in-Picture window, lifted above the controls when they show
- Captions switch themselves on when the page has them off, and the window's menu chooses between the caption languages the page offers (YouTube, and any video with subtitle tracks)
- A control bar: play/pause, ±10 s, seek, volume, captions on/off
- The picture itself: click to play or pause, double-click to fit the window to the video, scroll for volume
- Keyboard shortcuts in the window: Space, ←/→ (10 s; with Ctrl or Cmd a tenth of the video), Home/End, 0–9 (tenths of the video), ↑/↓, M (mute), C (captions), Esc
- Caption styling: Classic, Large and Outline presets, or your own size, colors, background, font and position
- **Alt+P** opens or closes Picture-in-Picture on the current tab; Alt+Shift+P opens the popup
- Auto PiP when you switch tabs (optional, Chrome 134+): for single sites, asking for access to that site only, or for every site

Premium (one payment: ₹1000 in India, $15 elsewhere):

- Caption translation into 12 languages. In Chrome 138+ it runs on your device, so lines appear in a few milliseconds and are not sent anywhere; otherwise it uses DeepL or MyMemory
- Dual subtitles: the original line above its translation
- Your own subtitles: load an SRT or VTT file from the window's menu, drop one onto the window, or save a link in the popup. Timing can be shifted earlier or later
- Playback speed from 0.5× to 3×
- Captions from speech, for videos that have none: Chrome's speech recognition writes them on your device from the video's own sound (Chrome 139+; not for protected video, which has captions anyway). They are translated like any other captions
- Study tools: A, S and D step to the previous line, replay the line and go to the next; Q stops the video after each line; clicking a word in a caption shows its meaning and the line's; lines can be saved and exported as CSV from the popup
- Skip intro, Skip recap and Next episode buttons in the window while the site shows its own, and a Next button (Shift+N) on YouTube

## Supported sites

| Site | Captions come from |
|---|---|
| YouTube, Netflix, JioHotstar, Disney+, Crunchyroll | the site's own caption element, mirrored into the window |
| Prime Video | same approach; the adapter is new and has not been checked against the live site yet |
| Sites built on Video.js, JW Player, Plyr, Bitmovin or Shaka Player | that player's caption element, read as text |
| Any other site | the captions you point at: *Captions not showing? Pick them on the page* in the popup, then click the caption text once. The choice is remembered for the site |
| Everything else | the video's own text track, when the page provides one |

What has and has not been checked against the live sites: YouTube's caption switch, caption languages and Next call were checked on youtube.com, though its captions could not be seen there under test automation (YouTube serves none to an automated browser). The Skip and Next episode buttons on Netflix, Prime Video and Disney+ go by those sites' own button names and have not been checked on the live sites. Skip ad is not offered: YouTube ignores a press that is passed on.

A video inside an embedded player (an iframe from another site) cannot be reached from the page it is embedded in. The popup says so and offers to open the player in its own tab.

## Using it

1. Play a video, with captions turned on in the site's player.
2. Press **Alt+P**, or click the SubPIP icon and choose *Open Picture-in-Picture*.
3. In the window, the gear opens Speed, Caption size, Translate, Subtitles and Fill window.

## Development

```sh
npm install
npm run build      # builds the extension into dist/
npm run watch      # rebuilds on change
```

Load `dist/` at `chrome://extensions` (Developer mode → Load unpacked).

| Command | What it does |
|---|---|
| `npm run lint` | ESLint over the extension, the API and the tests |
| `npm run test:unit` | unit tests (Node's test runner, no browser) |
| `npm run test:e2e` | end-to-end tests in a real browser window |
| `npm test` | both |
| `npm run package` | builds and zips `dist/` into `subpip.zip` for the Chrome Web Store |
| `npm run icons` | re-renders the extension icons from `src/assets/logo.svg` |

The end-to-end tests need a Chromium browser. Google Chrome, Brave and Chromium are found automatically; set `CHROME_PATH` to use another one. They open real windows, so leave the machine alone while they run.

### Layout

```
src/
  manifest.json
  background.js        service worker: translation, the Alt+P shortcut, Auto PiP registration
  relay.js             content script: passes settings and translation requests to the page script
  content/             the page script: the PiP window, captions, controls, menu, site adapters
  popup/               the popup: status, caption style, options, account and license
  shared/              settings, icons, pricing, on-device translation
web/                   the website and the server
  *.html, style.css    landing page, checkout, policies, uninstall feedback
  api/                 Vercel Functions (orders, payments, licenses, translation, feedback, health)
tests/                 unit/ and e2e/, with fixtures and helpers
scripts/               icon rendering, browser lookup, manual test licenses
```

## Website and server

`web/` deploys to Vercel:

```sh
cd web && vercel --prod
```

The functions run in Mumbai (`web/vercel.json`), next to the Firestore database. Firestore rules deploy with `firebase deploy --only firestore:rules` (the free Spark plan is enough).

### Configuration (Vercel → Project → Environment Variables, Production)

| Variable | Purpose |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON (Admin SDK) |
| `RAZORPAY_KEY_SECRET` | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook secret (events: `payment.captured`, `refund.processed`) → `https://subpip.vercel.app/api/razorpayWebhook` |
| `DEEPL_API_KEY` | DeepL API Free key (online Premium translation; optional — without it translation falls back to MyMemory) |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for license emails, alerts and uninstall feedback (the free plan sends 100 emails a day) |
| `EMAIL_FROM` | Sender on a domain verified in Resend, e.g. `SubPIP <licenses@example.com>`. Without a verified domain Resend only delivers to the account's own address |
| `ALERT_EMAIL` | Optional; where owner alerts and feedback go (defaults to the support address) |

In Razorpay, set **Payment capture → Automatic** (Settings → Payment capture). The webhook issues licenses on `payment.captured`, so buyers who close the checkout early still get theirs.

`GET /api/health` reports which settings are present (never their values) and returns 503 if a required one is missing; point an uptime monitor at it.

### How a purchase becomes Premium

- Bought from the popup while signed in: the checkout is tied to that account, and Premium turns on by itself once the payment is captured.
- Bought on the website: the buyer gets a license key on screen and by email, signs in to the popup and pastes it under *Account & license*, or presses *Check payment*.
- A full refund (7 days, no questions asked) revokes the license.

## Privacy

Settings stay in the browser. Signing in stores an email address and license status with Firebase. See the [privacy policy](https://subpip.vercel.app/privacy.html) for the full list.

## License

MIT — see [LICENSE](LICENSE).
