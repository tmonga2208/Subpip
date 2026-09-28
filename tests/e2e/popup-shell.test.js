import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension } from '../helpers/extension.js';

const ctx = useExtension();

const viewState = (popup) => popup.evaluate(() => ({
  view: [...document.querySelectorAll('.view')].filter((v) => !v.hidden).map((v) => v.dataset.view).join(','),
  title: document.getElementById('page-title').textContent,
  topbarHidden: document.getElementById('topbar').hidden,
  pagebarHidden: document.getElementById('pagebar').hidden
}));

test('home shows the brand, Free badge and main button', async () => {
  const popup = await ctx.openPopup();
  const home = await popup.evaluate(() => ({
    brand: document.querySelector('.brand').textContent,
    badge: document.getElementById('plan-badge').textContent,
    button: document.getElementById('pip-btn').textContent.trim(),
    width: document.body.getBoundingClientRect().width,
    hasSave: !!document.getElementById('save-btn')
  }));
  assert.deepEqual(home, { brand: 'SubPIP', badge: 'Free', button: 'Open Picture-in-Picture', width: 340, hasSave: false });
  assert.deepEqual(await viewState(popup), { view: 'home', title: '', topbarHidden: false, pagebarHidden: true });
  assert.deepEqual(popup.errors, []);
  await popup.close();
});

test('every [data-icon] placeholder renders an svg', async () => {
  const popup = await ctx.openPopup();
  const missing = await popup.evaluate(() => [...document.querySelectorAll('[data-icon]')].filter((el) => !el.querySelector('svg')).length);
  assert.equal(missing, 0);
  await popup.close();
});

test('sub-pages show a back bar with a title; Back and Escape return home', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  assert.deepEqual(await viewState(popup), { view: 'account', title: 'Account & license', topbarHidden: true, pagebarHidden: false });
  await popup.click('#back-btn');
  assert.equal((await viewState(popup)).view, 'home');
  await popup.click('#account-btn');
  await popup.keyboard.press('Escape');
  assert.equal((await viewState(popup)).view, 'home');
  await popup.close();
});
