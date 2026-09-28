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
  ctx.newPage = (pagePath, host) => openFixture(ctx.browser, ctx.server.port, pagePath, host);
  return ctx;
}
