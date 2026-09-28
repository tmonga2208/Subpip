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
