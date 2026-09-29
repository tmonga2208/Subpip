import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONAL_PRICES, defaultCurrency, localPrice } from '../../src/shared/pricing.js';

test('regional prices match the server', () => {
  assert.deepEqual(REGIONAL_PRICES, {
    INR: { currency: 'INR', amount: 100000, label: '₹1000' },
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
  assert.equal(localPrice('Asia/Kolkata').label, '₹1000');
  assert.equal(localPrice('Asia/Tokyo').label, '$15');
});
