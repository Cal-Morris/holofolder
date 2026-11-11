import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeAnalytics, nativeValueLabel, sumCopyValues } from '../lib/collection/native-analytics';
import {
  completeInventoryBrowseFixture,
  inventoryProjectionFixture,
  inventoryProjectionCatalog,
  inventoryProjectionPrices,
} from './fixtures/inventory-browse';
import type { CollectionNavigationRead } from '../lib/collection-navigation';

const scope = { accountUserId: 'synthetic-owner', ownerUserId: 'synthetic-owner', sessionId: 'synthetic-session' };
const now = Date.parse('2026-11-10T00:00:00Z');
async function fixture() {
  const snapshot = await completeInventoryBrowseFixture(inventoryProjectionFixture());
  const read: CollectionNavigationRead = {
    scope,
    evidence: { kind: 'complete', snapshot },
    catalog: inventoryProjectionCatalog,
    layouts: [],
  };
  const prices = inventoryProjectionPrices().map((p) => ({
    ...p,
    confidence: 'high' as const,
    finishPrices: p.finishPrices?.map((f) => ({ ...f, confidence: 'high' as const })),
  }));
  return { read, prices };
}
test('native analytics counts physical copies once across placements and Unassigned, separates species, wants, slots and targets', async () => {
  const { read, prices } = await fixture();
  const result = buildNativeAnalytics(scope, read, undefined, prices, 'UK', now)!;
  assert.equal(result.physicalCopies, 6);
  assert.equal(result.uniqueSpecies, 1);
  assert.equal(result.explicitWants, 2);
  assert.equal(result.actualSlots, 24);
  assert.equal(result.targetCount, 1);
  assert.equal(result.completedTargets, 0);
  assert.equal(result.rawValueGbp, 25);
  assert.equal(result.pricedCopies, 4);
  assert.equal(result.gradedUnknownCopies, 1);
  assert.equal(result.unpricedRawCopies, 1);
  assert.equal(result.requests.length, 3);
  assert.equal(buildNativeAnalytics(scope, read, 'alpha', prices, 'UK', now)!.physicalCopies, 1);
  assert.equal(buildNativeAnalytics(scope, read, 'trades', prices, 'UK', now)!.rawValueGbp, 10);
});
test('low, unknown and stale confidence still value the copy (as the card sheet shows it) and are counted', async () => {
  const { read, prices } = await fixture();
  assert.equal(buildNativeAnalytics(scope, read, undefined, prices, 'UK', now)!.lowConfidenceCopies, 0);
  for (const confidence of ['low', 'unknown'] as const) {
    const weak = prices.map((p) => ({
      ...p,
      confidence,
      finishPrices: p.finishPrices?.map((f) => ({ ...f, confidence })),
    }));
    const result = buildNativeAnalytics(scope, read, undefined, weak, 'UK', now)!;
    assert.equal(result.rawValueGbp, 25);
    assert.equal(result.pricedCopies, 4);
    assert.equal(result.lowConfidenceCopies, 4);
  }
  const stale = buildNativeAnalytics(scope, read, undefined, prices, 'UK', now + 40 * 86400000)!;
  assert.equal(stale.rawValueGbp, 25);
  assert.equal(stale.lowConfidenceCopies, 4);
});
test('invalid and missing finish evidence is unknown, graded value never uses raw', async () => {
  const { read, prices } = await fixture();
  for (const amount of [0, -10, NaN]) {
    const invalid = prices.map((p) => ({
      ...p,
      finishPrices: p.finishPrices?.map((f) => ({ ...f, gbpAmount: amount, marketGbpAmount: amount })),
    }));
    assert.equal(buildNativeAnalytics(scope, read, undefined, invalid, 'UK', now)!.rawValueGbp, null);
  }
  assert.equal(
    buildNativeAnalytics(
      scope,
      read,
      undefined,
      prices.map((p) => ({ ...p, finishPrices: [] })),
      'UK',
      now,
    )!.rawValueGbp,
    null,
  );
});
test('fences reject owner/account/session swaps, incomplete and unknown storage; cached subset stays labelled', async () => {
  const { read, prices } = await fixture();
  for (const changed of [
    { ...scope, ownerUserId: 'other' },
    { ...scope, accountUserId: 'other' },
    { ...scope, sessionId: 'other' },
  ])
    assert.equal(buildNativeAnalytics(changed, read, undefined, prices), null);
  assert.equal(buildNativeAnalytics(scope, { ...read, evidence: { kind: 'unavailable' } }, undefined, prices), null);
  assert.equal(buildNativeAnalytics(scope, read, 'unknown-storage', prices), null);
  assert.equal(
    buildNativeAnalytics(
      scope,
      { ...read, evidence: { kind: 'cached', snapshot: inventoryProjectionFixture() } },
      undefined,
      prices,
    )!.kind,
    'cached',
  );
  assert.equal(
    buildNativeAnalytics(
      scope,
      { ...read, evidence: { kind: 'complete', snapshot: inventoryProjectionFixture() as never } },
      undefined,
      prices,
    ),
    null,
  );
});
test('many same-species copies stay distinct; aliases deduplicate price reads without crossing language/finish identity', async () => {
  const s = inventoryProjectionFixture();
  s.items = Array.from({ length: 60 }, (_, n) => ({
    ...s.items[0],
    id: `synthetic-many-${n}`,
    identity: {
      kind: 'card' as const,
      cardId: n % 2 ? 'synthetic-alias' : 'synthetic-snorlax',
      language: n === 59 ? ('ja' as const) : ('en' as const),
      finish: n === 58 ? ('holo' as const) : ('normal' as const),
    },
  }));
  s.placements = [];
  s.binders.forEach((b) =>
    b.slots.forEach((slot) => {
      slot.inventoryItemId = null;
      slot.status = null;
    }),
  );
  const snapshot = await completeInventoryBrowseFixture(s);
  const catalog = inventoryProjectionCatalog.map((c) =>
    c.card.id === 'synthetic-snorlax'
      ? { ...c, card: { ...c.card, canonicalId: c.card.id, aliasIds: ['synthetic-alias'] } }
      : c,
  );
  catalog.push({ ...catalog[0], card: { ...catalog[0].card, language: 'ja' } });
  const read = { scope, evidence: { kind: 'complete' as const, snapshot }, catalog, layouts: [] };
  const { prices } = await fixture();
  const summary = buildNativeAnalytics(scope, read, undefined, prices, 'UK', now)!;
  assert.equal(summary.physicalCopies, 60);
  assert.equal(summary.uniqueSpecies, 1);
  assert.equal(summary.requests.length, 2);
  assert.equal(summary.pricedCopies, 58);
  assert.equal(summary.rawValueGbp, 580);
  assert.equal(summary.unpricedRawCopies, 2);
  assert.equal(new Set(summary.copies.map((c) => c.itemId)).size, 60);
});
test("a page total sums only that page's priced copies and keeps unpriced copies unpriced", async () => {
  const { read, prices } = await fixture();
  const { copies } = buildNativeAnalytics(scope, read, undefined, prices, 'UK', now)!;
  const all = new Set(copies.map((c) => c.itemId));
  assert.deepEqual(sumCopyValues(copies, all), { valueGbp: 25, priced: 4, total: 6 });
  const unpriced = copies.filter((c) => c.amountGbp === null).map((c) => c.itemId);
  assert.deepEqual(sumCopyValues(copies, new Set(unpriced)), { valueGbp: null, priced: 0, total: unpriced.length });
  assert.deepEqual(sumCopyValues(copies, new Set()), { valueGbp: null, priced: 0, total: 0 });
  const weak = prices.map((p) => ({
    ...p,
    confidence: 'low' as const,
    finishPrices: p.finishPrices?.map((f) => ({ ...f, confidence: 'low' as const })),
  }));
  assert.equal(sumCopyValues(buildNativeAnalytics(scope, read, undefined, weak, 'UK', now)!.copies, all).valueGbp, 25);
});
test('the value line labels partial and low confidence totals and is empty when nothing is priced', async () => {
  const { read, prices } = await fixture();
  const weak = prices.map((p) => ({
    ...p,
    finishPrices: p.finishPrices?.map((f) => ({ ...f, confidence: 'low' as const })),
  }));
  assert.equal(nativeValueLabel(buildNativeAnalytics(scope, read, undefined, prices, 'UK', now)), '£25.00 · partial');
  assert.equal(
    nativeValueLabel(buildNativeAnalytics(scope, read, undefined, weak, 'UK', now)),
    '£25.00 · partial · 4 low confidence',
  );
  assert.equal(nativeValueLabel(buildNativeAnalytics(scope, read, undefined, [], 'UK', now)), undefined);
  assert.equal(nativeValueLabel(null), undefined);
});
