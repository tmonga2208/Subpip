// "Not working on this site?" in the popup: it opens the report form on the
// website with the tab's site named after the "#", where no server sees it
// before the form is sent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension();
const REPORT = 'https://subpip.online/report.html';
const { version } = JSON.parse(readFileSync('src/manifest.json', 'utf8'));

const link = (popup) => popup.$eval('#report-problem', (button) => ({ shown: !button.hidden, text: button.textContent.trim() }));

// Record the tab the popup opens instead of opening it
async function report(popup) {
  await popup.evaluate(() => {
    window.openedTabs = [];
    chrome.tabs.create = async ({ url }) => { window.openedTabs.push(url); };
  });
  await popup.click('#report-problem');
  await popup.waitForFunction(() => window.openedTabs.length > 0, { timeout: 8000 });
  return popup.evaluate(() => window.openedTabs);
}

test('on a page with a video the link opens the form with this site and the version', async () => {
  const page = await ctx.newPage('generic.html');
  const popup = await ctx.openPopup();
  assert.deepEqual(await link(popup), { shown: true, text: 'Not working on this site? Tell me' });
  assert.deepEqual(await report(popup), [`${REPORT}#site=127.0.0.1&v=${version}`]);
  assert.deepEqual(popup.errors, []);
  await popup.close();
  await page.close();
});

test('only the name of the site goes along: no path, no address, no www', async () => {
  const page = await ctx.newPage('generic.html?watch=secret-title#t=95', 'www.films.localhost');
  const popup = await ctx.openPopup();
  assert.deepEqual(await report(popup), [`${REPORT}#site=films.localhost&v=${version}`]);
  await popup.close();
  await page.close();
});

test('it is offered where SubPIP finds no video too', async () => {
  const page = await ctx.newPage('novideo.html');
  const popup = await ctx.openPopup();
  assert.equal((await link(popup)).shown, true);
  assert.deepEqual(await report(popup), [`${REPORT}#site=127.0.0.1&v=${version}`]);
  await popup.close();
  await page.close();
});

test('where SubPIP cannot look at the page, the form opens without a site', async () => {
  const page = await ctx.browser.newPage();
  await page.goto('chrome://version');
  const popup = await ctx.openPopup();
  assert.equal((await link(popup)).shown, true);
  assert.deepEqual(await report(popup), [`${REPORT}#v=${version}`]);
  await popup.close();
  await page.close();
});
