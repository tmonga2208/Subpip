import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useWebsite, razorpayStub, resendStub, both } from '../helpers/web.js';

const ctx = useWebsite();

test('lost-key form sends the email and shows the generic reply', async () => {
  const seen = [];
  const page = await ctx.open('premium.html', { intercept: both(razorpayStub(), resendStub(seen)) });
  await page.click('.lost-key summary');
  await page.type('#lostKeyEmail', 'buyer@example.com');
  await page.click('#lostKeyForm button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('lostKeyMsg').textContent.length > 0);
  assert.equal(await page.$eval('#lostKeyMsg', (el) => el.textContent), "If a purchase exists for that email, we've sent the license to it.");
  assert.deepEqual(seen, ['buyer@example.com']);
  await page.close();
});
