// Renders src/assets/logo.svg to the PNG sizes Chrome needs, and to the logo
// emails show (mail apps do not display SVG; 144px stays sharp at the 36px it
// is shown at, on any screen).
import puppeteer from 'puppeteer-core';
import { readFile, writeFile } from 'node:fs/promises';
import { findBrowser } from './find-browser.mjs';

const ICONS = [16, 32, 48, 128].map((size) => ({ size, file: `src/assets/icon-${size}.png` }));
const EMAIL_LOGO = { size: 144, file: 'web/logo.png' };
const svg = await readFile('src/assets/logo.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
try {
  const page = await browser.newPage();
  for (const { size, file } of [...ICONS, EMAIL_LOGO]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(file, png);
    console.log(file);
  }
} finally {
  await browser.close();
}
