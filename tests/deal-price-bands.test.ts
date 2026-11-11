import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDealPriceBands, checkDeal } from '../lib/deal-check';

test('visual bands describe the same fair market range as verdicts, not just discounted targets', () => {
  const bands = buildDealPriceBands(100)!;
  assert.deepEqual(bands.fair, { low: 90, high: 110 });
  for (const amount of [90, 100, 110])
    assert.equal(checkDeal({ askingPrice: amount, marketPrice: 100 })?.verdict, 'fair');
  assert.equal(checkDeal({ askingPrice: 80, marketPrice: 100 })?.verdict, 'great');
  assert.equal(checkDeal({ askingPrice: 111, marketPrice: 100 })?.verdict, 'overpriced');
  for (const marketPrice of [0.01, 0.02, 0.03])
    assert.equal(checkDeal({ askingPrice: marketPrice, marketPrice })?.verdict, 'fair');
  assert.equal(checkDeal({ askingPrice: Infinity, marketPrice: 100 }), null);
  assert.equal(bands.greatBelow, 80);
  assert.equal(bands.walkAwayAbove, 135);
  assert.deepEqual(buildDealPriceBands(100, { greatPct: 25, fairPct: 15, walkAwayPct: 40 })?.fair, {
    low: 85,
    high: 115,
  });
  for (const amount of [0, -10, NaN, Infinity]) assert.equal(buildDealPriceBands(amount), null);
});

test('cent-rounded displayed boundaries and verdicts agree for real-world price amounts', () => {
  const bands = buildDealPriceBands(355.78)!;
  assert.equal(checkDeal({ askingPrice: bands.fair.low, marketPrice: 355.78 })?.verdict, 'fair');
  assert.equal(checkDeal({ askingPrice: bands.fair.high, marketPrice: 355.78 })?.verdict, 'fair');
  assert.equal(checkDeal({ askingPrice: bands.walkAwayAbove, marketPrice: 355.78 })?.verdict, 'walk-away');
});
