import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBundle } from '../lib/deal-check';
import { buildBundlePriceGuide } from '../lib/bundle-price-guide';
import type { CardPriceCheck } from '../lib/card-price-checks';
// Synthetic exact-printing prices, not real sales.
const now = Date.parse('2026-10-27T12:00:00Z');
const soldCheck: CardPriceCheck = {
  checkedAt: new Date(now).toISOString(),
  summary: { kind: 'sold', currency: 'GBP', count: 12, low: 98, median: 100, high: 102 },
  sales: Array.from({ length: 12 }, (_, i) => ({ amount: 100, soldAt: `2026-10-${25 - (i % 3)}` })),
};
const entry = {
  marketPrice: 102,
  catalogMarketGbp: 102,
  gbpPerUnit: 1,
  currency: 'GBP',
  finish: 'normal' as const,
  soldCheck,
};
test('bundle sums qualified sold and catalogue references, with explicit missing coverage', () => {
  const guide = buildBundlePriceGuide(
    [
      entry,
      { ...entry, soldCheck: undefined },
      { ...entry, soldCheck: undefined, catalogMarketGbp: null, marketPrice: null },
    ],
    'GBP',
    undefined,
    now,
  );
  assert.equal(guide.marketTotal, 202);
  assert.deepEqual(
    guide.items.map((item) => item.source),
    ['sold', 'catalogue', 'unknown'],
  );
  assert.deepEqual(guide.band, { low: 161.6, high: 181.8 });
  assert.equal(guide.complete, false);
  assert.equal(guide.overlap, null);
});
test('bundle never combines currencies or guesses FX, and stale sold falls back to catalogue', () => {
  const guide = buildBundlePriceGuide(
    [
      { ...entry, currency: 'USD' },
      { ...entry, currency: 'EUR', gbpPerUnit: null },
      { ...entry, soldCheck: { ...soldCheck, checkedAt: '2026-10-01' } },
    ],
    'GBP',
    undefined,
    now,
  );
  assert.deepEqual(
    guide.items.map((item) => item.marketPrice),
    [null, null, 102],
  );
  const converted = buildBundlePriceGuide(
    [{ ...entry, currency: 'EUR', gbpPerUnit: 0.8, marketPrice: 127.5 }],
    'EUR',
    undefined,
    now,
  );
  assert.equal(converted.marketTotal, 125);
  assert.deepEqual(converted.overlap, { low: 114.75, high: 137.5 });
});

test('legacy bundle values remain usable without claiming catalogue or sold provenance', () => {
  const guide = buildBundlePriceGuide([{ marketPrice: 100, currency: 'GBP', finish: 'normal' }], 'GBP', undefined, now);
  assert.equal(guide.marketTotal, 100);
  assert.equal(guide.items[0].source, 'saved');
  assert.equal(guide.overlap, null);
});

test('expired access drops retained sold evidence and restores catalogue reference', () => {
  const guide = buildBundlePriceGuide([entry], 'GBP', undefined, now, false);
  assert.equal(guide.items[0].source, 'catalogue');
  assert.equal(guide.items[0].marketPrice, 102);
});

test('complete-only comparison fails closed on mixed currency or missing FX and evidence', () => {
  // Synthetic prices composed exactly as the native read-only bundle does.
  for (const other of [
    { ...entry, currency: 'USD' },
    { ...entry, currency: 'EUR', gbpPerUnit: null },
    { ...entry, soldCheck: undefined, catalogMarketGbp: null, marketPrice: null },
  ]) {
    const guide = buildBundlePriceGuide([entry, entry, other], 'GBP', undefined, now);
    assert.equal(guide.complete, false);
    assert.equal(guide.items[2].marketPrice, null);
    assert.equal(checkBundle(guide.items, 50, undefined, true).deal, null);
  }
  const repeated = buildBundlePriceGuide([entry, entry], 'GBP', undefined, now);
  assert.equal(repeated.marketTotal, 200);
  assert.equal(checkBundle(repeated.items, 160, undefined, true).deal?.verdict, 'great');
});
