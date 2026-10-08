import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONAL_PRICES, defaultCurrency, localPrice } from '../../src/shared/pricing.js';

test('regional prices match the server', () => {
  assert.deepEqual(REGIONAL_PRICES, {
    INR: { currency: 'INR', amount: 99900, label: '₹999' },
    USD: { currency: 'USD', amount: 1500, label: '$15' }
  });
});

test('India time zones default to rupees, everything else to dollars', () => {
  assert.equal(defaultCurrency('Asia/Kolkata'), 'INR');
  assert.equal(defaultCurrency('Asia/Calcutta'), 'INR');
  assert.equal(defaultCurrency('America/New_York'), 'USD');
  assert.equal(defaultCurrency('Europe/London'), 'USD');
});

test('localPrice returns the price for a time zone', () => {
  assert.equal(localPrice('Asia/Kolkata').label, '₹999');
  assert.equal(localPrice('Asia/Tokyo').label, '$15');
});

// ---- price levels and the one-year pass, as the popup shows them ----

test('three levels by time zone, each with a lifetime and a one-year price', async () => {
  const { localPrices } = await import('../../src/shared/pricing.js');
  assert.deepEqual(localPrices('Asia/Kolkata'), { currency: 'INR', tier: 'standard', lifetime: '₹999', year: '₹399' });
  assert.deepEqual(localPrices('Asia/Jakarta'), { currency: 'USD', tier: 'low', lifetime: '$7', year: '$3' });
  assert.deepEqual(localPrices('America/Sao_Paulo'), { currency: 'USD', tier: 'low', lifetime: '$7', year: '$3' });
  assert.deepEqual(localPrices('Europe/Berlin'), { currency: 'USD', tier: 'standard', lifetime: '$15', year: '$6' });
  assert.equal(localPrice('Asia/Manila').label, '$7');
});

test('the popup and the website agree on the levels and on which time zones get the lower one', async () => {
  const { readFileSync } = await import('node:fs');
  const { LOWER_PRICED_TIME_ZONES, LEVEL_LABELS } = await import('../../src/shared/pricing.js');
  const site = readFileSync('web/script.js', 'utf8');
  const siteZones = /const LOWER_PRICED = \[([^\]]+)\]/.exec(site)[1].match(/'[^']+'/g).map((zone) => zone.slice(1, -1));
  assert.deepEqual([...LOWER_PRICED_TIME_ZONES].sort(), siteZones.sort());
  for (const label of Object.values(LEVEL_LABELS).flatMap((level) => [level.lifetime, level.year])) assert.ok(site.includes(`label: '${label}'`), label);
});

test('Premium bought for a year is over when the year is', async () => {
  const { premiumNow } = await import('../../src/shared/settings.js');
  const now = Date.parse('2026-10-08T10:00:00Z');
  assert.equal(premiumNow({ isPremium: true }, now), true);
  assert.equal(premiumNow({ isPremium: true, premiumUntil: null }, now), true);
  assert.equal(premiumNow({ isPremium: true, premiumUntil: now + 1000 }, now), true);
  assert.equal(premiumNow({ isPremium: true, premiumUntil: now - 1000 }, now), false);
  assert.equal(premiumNow({ isPremium: false, premiumUntil: now + 1000 }, now), false);
  assert.equal(premiumNow(null, now), false);
});
