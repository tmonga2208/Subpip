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

// The PiP window as its own puppeteer Page, for real mouse input and for
// catching the file chooser it opens
export async function pipPageOf(page) {
  const target = await page.browser().waitForTarget(
    (candidate) => candidate.type() === 'page' && candidate.url() === 'about:blank' && candidate.opener() === page.target(),
    { timeout: 5000 }
  );
  return target.asPage();
}
