import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, sleep } from '../helpers/browser.js';
import { openPip, togglePip, shadowEval, pipEval } from '../helpers/pip.js';

const ctx = useBrowser();

async function open(settings = {}) {
  const page = await ctx.newPage('generic.html');
  await openPip(page, settings);
  return page;
}
async function done(page) {
  await togglePip(page);
  await sleep(300);
  await page.close();
}
const menuItems = (page) => shadowEval(page, (shadow) => [...shadow.querySelectorAll('.menu .menu-item')]
  .map((item) => item.querySelector('.label').textContent + '=' + (item.querySelector('.value, .tag')?.textContent || '')));
const clickItem = (page, label) => shadowEval(page, (shadow, pip, text) => {
  const item = [...shadow.querySelectorAll('.menu .menu-item')].find((i) => i.querySelector('.label').textContent === text);
  item.click();
}, label);
const openMenu = (page) => shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').click());

test('gear opens the menu with current values (premium user)', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  assert.deepEqual(await menuItems(page), ['Speed=1×', 'Caption size=M', 'Translate=Off', 'Subtitles=Page', 'Fill window=Off']);
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.btn.gear').getAttribute('aria-expanded')), 'true');
  await done(page);
});

test('free users see Premium tags and an upgrade note', async () => {
  const page = await open({ isPremium: false });
  await openMenu(page);
  assert.deepEqual(await menuItems(page), ['Speed=Premium', 'Caption size=M', 'Translate=Premium', 'Subtitles=Premium', 'Fill window=Off']);
  await clickItem(page, 'Speed');
  const note = await shadowEval(page, (shadow) => shadow.querySelector('.menu .menu-note').textContent);
  assert.match(note, /Premium feature/);
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').playbackRate), 1);
  await done(page);
});

test('premium speed selection changes playback rate', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  await clickItem(page, 'Speed');
  await clickItem(page, '1.5×');
  assert.equal(await pipEval(page, (pip) => pip.document.querySelector('video').playbackRate), 1.5);
  assert.deepEqual((await menuItems(page))[0], 'Speed=1.5×');
  await done(page);
});

test('caption size applies to this window only', async () => {
  const page = await open({ fontSize: 18 });
  await openMenu(page);
  await clickItem(page, 'Caption size');
  await clickItem(page, 'XL');
  const css = await pipEval(page, (pip) => pip.document.getElementById('subpip-settings-style').textContent);
  assert.match(css, /font-size: 32px/);
  assert.equal(await page.evaluate(() => window.__SUBPIP_SETTINGS__.fontSize), 18);
  await done(page);
});

test('translate picks a language for this window', async () => {
  const page = await open({ isPremium: true });
  await openMenu(page);
  await clickItem(page, 'Translate');
  await clickItem(page, 'Spanish');
  assert.deepEqual((await menuItems(page))[2], 'Translate=Spanish');
  await clickItem(page, 'Translate');
  await clickItem(page, 'Off');
  assert.deepEqual((await menuItems(page))[2], 'Translate=Off');
  await done(page);
});

test('fill window toggles object-fit', async () => {
  const page = await open();
  const fit = () => pipEval(page, (pip) => pip.document.querySelector('video').style.objectFit);
  assert.equal(await fit(), 'contain');
  await openMenu(page);
  await clickItem(page, 'Fill window');
  assert.equal(await fit(), 'fill');
  assert.deepEqual((await menuItems(page))[4], 'Fill window=On');
  await done(page);
});

test('Escape and outside clicks close the menu; Back returns to the main list', async () => {
  const page = await open({ isPremium: true });
  const isOpen = () => shadowEval(page, (shadow) => !shadow.querySelector('.menu').hidden);
  await openMenu(page);
  await clickItem(page, 'Speed');
  await clickItem(page, 'Back');
  assert.equal((await menuItems(page)).length, 5);
  await pipEval(page, (pip) => pip.dispatchEvent(new pip.KeyboardEvent('keydown', { code: 'Escape' })));
  assert.equal(await isOpen(), false);
  await openMenu(page);
  await pipEval(page, (pip) => pip.document.querySelector('video').dispatchEvent(new pip.PointerEvent('pointerdown', { bubbles: true, composed: true })));
  assert.equal(await isOpen(), false);
  await done(page);
});

test('an open menu keeps the controls visible while idle', async () => {
  const page = await open();
  await openMenu(page);
  await sleep(3000);
  assert.equal(await shadowEval(page, (shadow) => shadow.querySelector('.root').classList.contains('visible')), true);
  await done(page);
});
