import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useExtension, firebaseStub } from '../helpers/extension.js';

const ctx = useExtension();

const account = (popup) => popup.evaluate(() => ({
  signedIn: !document.getElementById('signed-in').hidden,
  email: document.getElementById('account-email').textContent,
  plan: document.getElementById('account-plan').textContent,
  badge: document.getElementById('plan-badge').textContent,
  badgePremium: document.getElementById('plan-badge').classList.contains('premium'),
  initial: document.getElementById('account-initial').hidden ? null : document.getElementById('account-initial').textContent,
  freeActions: !document.getElementById('free-actions').hidden
}));

async function signIn(popup, email = 'tester@example.com', password = 'secret123') {
  await popup.click('#account-btn');
  await popup.type('#auth-email', email);
  await popup.type('#auth-password', password);
  await popup.click('#auth-submit');
}

test('signed out: sign-in form, mode switch renames the button', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  assert.equal((await account(popup)).signedIn, false);
  assert.equal(await popup.$eval('#auth-submit', (b) => b.textContent), 'Sign in');
  await popup.click('[data-mode="signup"]');
  assert.equal(await popup.$eval('#auth-submit', (b) => b.textContent), 'Create account');
  await popup.close();
});

test('signing in shows the account, Free plan and header initial', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await signIn(popup);
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.deepEqual(await account(popup), {
    signedIn: true, email: 'tester@example.com', plan: 'Free', badge: 'Free', badgePremium: false, initial: 'T', freeActions: true
  });
  assert.deepEqual(await ctx.authCache(), { uid: 'u1', email: 'tester@example.com', isPremium: false });
  // Sync storage is shared with the user's other browsers: the plan must not go there
  assert.equal((await ctx.storage()).subpipAuth, undefined);
  await popup.close();
});

test('a premium account shows the Premium badge and hides purchase actions', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub({ premium: true }) });
  await popup.waitForFunction(() => document.getElementById('plan-badge').textContent === 'Premium');
  const state = await account(popup);
  assert.equal(state.badgePremium, true);
  assert.equal(state.freeActions, false);
  await popup.close();
});

test('wrong password shows an inline error and re-enables the button', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub({ signIn: 'bad' }) });
  await signIn(popup);
  await popup.waitForSelector('#auth-error:not([hidden])');
  const state = await popup.evaluate(() => ({
    error: document.getElementById('auth-error').textContent,
    disabled: document.getElementById('auth-submit').disabled,
    busy: document.getElementById('auth-submit').classList.contains('busy')
  }));
  assert.deepEqual(state, { error: 'Invalid email or password', disabled: false, busy: false });
  await popup.close();
});

test('signing in offline shows a connection message', async () => {
  const popup = await ctx.openPopup({ stub: firebaseStub({ signIn: 'network' }) });
  await signIn(popup);
  await popup.waitForSelector('#auth-error:not([hidden])');
  assert.equal(await popup.$eval('#auth-error', (e) => e.textContent), "Can't reach SubPIP. Check your connection and try again.");
  assert.equal(await popup.$eval('#auth-submit', (b) => b.disabled), false);
  await popup.close();
});

test('empty fields are caught before any request', async () => {
  const popup = await ctx.openPopup();
  await popup.click('#account-btn');
  await popup.click('#auth-submit');
  assert.equal(await popup.$eval('#auth-error', (e) => e.textContent), 'Enter your email and password.');
  await popup.close();
});

test('a very long email never makes the popup scroll sideways', async () => {
  const email = `${'a'.repeat(60)}@example-company-with-a-long-name.com`;
  await ctx.signInAs({ email });
  const popup = await ctx.openPopup({ stub: firebaseStub({ email }) });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  // Measure the settled page, not the 180ms slide-in transform
  await popup.waitForFunction(() => document.getAnimations().length === 0);
  const layout = await popup.evaluate(() => {
    const el = document.getElementById('account-email');
    const scroller = document.querySelector('.views');
    return { pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, viewOverflow: scroller.scrollWidth > scroller.clientWidth, truncated: el.scrollWidth > el.clientWidth };
  });
  assert.deepEqual(layout, { pageOverflow: false, viewOverflow: false, truncated: true });
  await popup.close();
});

test('license activation reports success inline', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  await popup.type('#license-key', 'SUBPIP-ABCDEFGH-1234');
  await popup.click('#license-submit');
  await popup.waitForSelector('#license-success:not([hidden])');
  assert.equal(await popup.$eval('#license-success', (e) => e.textContent), 'Premium activated.');
  await popup.close();
});

test('sign out returns to the sign-in form and clears stored auth', async () => {
  await ctx.signInAs();
  const popup = await ctx.openPopup({ stub: firebaseStub() });
  await popup.click('#account-btn');
  await popup.waitForSelector('#signed-in:not([hidden])');
  await popup.click('#sign-out');
  await popup.waitForSelector('#signed-out:not([hidden])');
  assert.equal(await ctx.authCache(), undefined);
  await popup.close();
});
