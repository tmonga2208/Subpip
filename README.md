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
2. **Backend**: Deploy `functions/` to Firebase (Node 22).


