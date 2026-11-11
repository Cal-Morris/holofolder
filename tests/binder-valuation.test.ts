import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionAnalytics } from '../lib/collection-analytics';
import { buildRefinedValuation } from '../lib/binder-valuation';
import { priceCheckKey } from '../lib/card-price-check-cache';
import type { CardPriceSnapshot } from '../lib/card-pricing';
import type { CardPriceCheck } from '../lib/card-price-checks';
import type { CollectedPokemon } from '../lib/domain/cards';

// Synthetic inventory, quotes and sales, never real provider data.
const now = Date.parse('2026-11-07T12:00:00Z');
const owned: CollectedPokemon = {
  id: 'copy-1',
  pokemon_id: 1,
  pokemon_name: 'Fixture',
  card_id: 'fixture',
  card_name: 'Fixture',
  card_language: 'en',
  card_finish: 'normal',
  status: 'collected',
  wanted_cards: [],
  collected_at: new Date(now).toISOString(),
};
const quote: CardPriceSnapshot = {
  cardId: 'fixture',
  language: 'en',
  gbpAmount: 99,
  marketGbpAmount: 99,
  goodGbpAmount: null,
  lowGbpAmount: null,
  highGbpAmount: null,
  confidence: 'high',
  source: 'tcgplayer',
  sourcePrices: [
    {
      source: 'cardmarket',
      label: 'Cardmarket',
      variantLabel: 'Normal',
      marketGbpAmount: 10,
      lowGbpAmount: 8,
      originalMarketAmount: 12,
      originalLowAmount: 9,
      originalCurrency: 'EUR',
      updatedAt: new Date(now).toISOString(),
    },
  ],
  trendPoints: [],
  buySignal: null,
  originalAmount: 120,
  originalCurrency: 'USD',
  variantLabel: 'Normal',
  updatedAt: new Date(now).toISOString(),
  fxDate: '2026-11-06',
};
const summary = (price = quote, collection = [owned]) =>
  buildCollectionAnalytics(collection, { 'fixture::en': price }, now, { source: 'cardmarket', countCopies: true });
const check: CardPriceCheck = {
  checkedAt: new Date(now).toISOString(),
  summary: { kind: 'sold', currency: 'GBP', count: 12, low: 11, median: 11, high: 11 },
  sales: Array.from({ length: 12 }, (_, i) => ({ amount: 11, soldAt: `2026-11-0${4 + (i % 3)}` })),
};

test('Cardmarket valuation selects its own amount and provenance, never the preferred provider', () => {
  const result = summary();
  assert.equal(result.valueGbp, 10);
  assert.equal(result.cards[0].price?.source, 'cardmarket');
  assert.equal(result.cards[0].price?.originalCurrency, 'EUR');
  assert.equal(result.cards[0].price?.originalAmount, 12);
  assert.equal(buildCollectionAnalytics([owned], { 'fixture::en': quote }, now).valueGbp, 99);
});

test('Cardmarket excludes missing, ambiguous, special-edition, invalid and expired evidence', () => {
  for (const variantLabel of [null, 'Foil', 'Holo', '1st Edition Normal'])
    assert.equal(summary({ ...quote, sourcePrices: [{ ...quote.sourcePrices[0], variantLabel }] }).pricedCards, 0);
  for (const marketGbpAmount of [null, 0, -1, NaN, Infinity])
    assert.equal(summary({ ...quote, sourcePrices: [{ ...quote.sourcePrices[0], marketGbpAmount }] }).pricedCards, 0);
  for (const updatedAt of [null, '2026-09-01', '2026-11-08'])
    assert.equal(summary({ ...quote, sourcePrices: [{ ...quote.sourcePrices[0], updatedAt }] }).pricedCards, 0);
  assert.equal(summary({ ...quote, sourcePrices: [] }).pricedCards, 0);
  assert.equal(summary({ ...quote, finishPrices: [{ ...quote, finish: 'holo', variantKey: 'holo' }] }).pricedCards, 0);
});

test('finish-specific source evidence uses its own timestamp and accepts the inclusive age boundary', () => {
  const finish = {
    ...quote,
    finish: 'normal' as const,
    variantKey: 'normal',
    sourcePrices: [
      { ...quote.sourcePrices[0], variantLabel: 'Trend', updatedAt: new Date(now - 30 * 86400000).toISOString() },
    ],
  };
  const result = summary({ ...quote, finishPrices: [finish] });
  assert.equal(result.valueGbp, 10);
  assert.equal(result.staleCards, 1);
  assert.equal(result.oldestQuoteAt, finish.sourcePrices[0].updatedAt);
  assert.equal(
    summary({
      ...quote,
      finishPrices: [
        {
          ...finish,
          sourcePrices: [{ ...finish.sourcePrices[0], updatedAt: new Date(now - 30 * 86400000 - 1).toISOString() }],
        },
      ],
    }).pricedCards,
    0,
  );
  assert.equal(summary({ ...quote, finishPrices: [{ ...finish, variantKey: '1st-edition' }] }).pricedCards, 0);
});

test('Cardmarket-preferred combined rows use Cardmarket freshness, not an older supporting provider', () => {
  const combined = {
    ...quote,
    source: 'cardmarket' as const,
    marketGbpAmount: 10,
    gbpAmount: 10,
    updatedAt: '2026-09-01',
    variantLabel: 'normal',
  };
  const result = summary({ ...combined, finishPrices: [{ ...combined, finish: 'normal', variantKey: 'normal' }] });
  assert.equal(result.pricedCards, 1);
  assert.equal(result.oldestQuoteAt, quote.sourcePrices[0].updatedAt);
});

test('refined valuation counts copies and separates sold, fallback and unpriced coverage', () => {
  const cards = summary(quote, [
    owned,
    { ...owned, id: 'copy-2' },
    { ...owned, id: 'unknown', pokemon_id: 4, card_id: 'unknown' },
  ]).cards;
  const refined = buildRefinedValuation(cards, { [priceCheckKey('fixture', 'normal', 'soldcomps')]: check }, now);
  assert.equal(refined.totalGbp, 22);
  assert.equal(refined.soldCards, 2);
  assert.equal(refined.fallbackCards, 0);
  assert.equal(refined.unpricedCards, 1);
  const fallback = buildRefinedValuation(cards, {}, now);
  assert.equal(fallback.totalGbp, 20);
  assert.equal(fallback.fallbackCards, 2);
});

test('asking, sparse, stale and non-English evidence never refines the estimate', () => {
  for (const value of [
    { ...check, summary: { ...check.summary, kind: 'asking' as const } },
    { ...check, sales: check.sales!.slice(0, 2) },
    { ...check, checkedAt: '2026-10-01' },
  ]) {
    assert.equal(
      buildRefinedValuation(summary().cards, { [priceCheckKey('fixture', 'normal', 'soldcomps')]: value }, now)
        .soldCards,
      0,
    );
  }
  const cards = summary().cards.map((card) => ({ ...card, card: { ...card.card, card_language: 'ja' as const } }));
  assert.equal(
    buildRefinedValuation(cards, { [priceCheckKey('fixture', 'normal', 'soldcomps')]: check }, now).soldCards,
    0,
  );
  assert.equal(buildRefinedValuation([], {}, now).totalGbp, 0);
});

test("all-source valuation uses each provider's own freshness and falls back to a usable exact quote", () => {
  const old = '2026-09-01T00:00:00Z';
  const current = quote.sourcePrices[0];
  const finish = { ...quote, updatedAt: old, finish: 'normal' as const, variantKey: 'normal' };
  const all = (price: CardPriceSnapshot) => buildCollectionAnalytics([owned], { 'fixture::en': price }, now);
  // The preferred TCGplayer headline is stale, but Cardmarket's exact-finish evidence is fresh.
  assert.equal(all({ ...quote, finishPrices: [finish] }).valueGbp, 10);
  // A combined row can have an old supporting-provider timestamp while its selected source is fresh.
  const cardmarket = { ...finish, source: 'cardmarket' as const, gbpAmount: 10, marketGbpAmount: 10 };
  assert.equal(all({ ...quote, source: 'cardmarket', finishPrices: [cardmarket] }).valueGbp, 10);
  assert.equal(
    all({ ...quote, finishPrices: [{ ...finish, sourcePrices: [{ ...current, updatedAt: old }] }] }).pricedCards,
    0,
  );
  assert.equal(all({ ...quote, finishPrices: [{ ...finish, finish: 'holo' }] }).pricedCards, 0);
  assert.equal(all({ ...quote, finishPrices: [{ ...finish, variantKey: '1st-edition' }] }).pricedCards, 0);
});

test('generic prices count as labelled finish estimates, never exact-finish movers', () => {
  const generic: CardPriceSnapshot = {
    ...quote,
    variantLabel: 'Trend',
    sourcePrices: [{ ...quote.sourcePrices[0], variantLabel: 'Trend' }],
    trendPoints: [
      { label: '7d', source: 'tcgplayer', gbpAmount: 80, originalAmount: 80, originalCurrency: 'GBP' },
      { label: 'Trend', source: 'tcgplayer', gbpAmount: 99, originalAmount: 99, originalCurrency: 'GBP' },
    ],
  };
  const all = (price = generic) => buildCollectionAnalytics([owned], { 'fixture::en': price }, now);
  const result = all();
  assert.equal(result.valueGbp, 99);
  assert.equal(result.pricedCards, 1);
  assert.equal(result.estimatedFinishCards, 1);
  assert.equal(result.cards[0].estimatedFinish, true);
  assert.equal(result.rising.length, 0);
  assert.equal(result.falling.length, 0);
  assert.equal(all({ ...generic, updatedAt: '2026-09-01', sourcePrices: [] }).pricedCards, 0);
  assert.equal(all({ ...generic, variantLabel: '1st Edition', sourcePrices: [] }).pricedCards, 0);
  assert.equal(all({ ...generic, variantLabel: 'Holofoil', sourcePrices: [] }).pricedCards, 0);
  const exact = {
    ...quote,
    finish: 'normal' as const,
    variantKey: 'normal',
    gbpAmount: 8,
    marketGbpAmount: 8,
    sourcePrices: [],
  };
  const verified = buildCollectionAnalytics([owned], { 'fixture::en': { ...generic, finishPrices: [exact] } }, now);
  assert.equal(verified.valueGbp, 8);
  assert.equal(verified.estimatedFinishCards, 0);
});

test('tracked binder totals and Analytics use the same prices and estimate counts', async () => {
  const { summarizeOwnedCardPrices } = await import('../components/binder/binder-app-model');
  const generic = { ...quote, variantLabel: null, sourcePrices: [] };
  const inventory = [owned, { ...owned, pokemon_id: 4, card_id: 'unknown' }];
  const prices = { 'fixture::en': generic };
  const tracked = summarizeOwnedCardPrices(inventory, prices, now);
  const analytics = buildCollectionAnalytics(inventory, prices, now);
  assert.equal(tracked.gbpTotal, analytics.valueGbp);
  assert.equal(tracked.estimatedFinishCount, analytics.estimatedFinishCards);
  assert.equal(tracked.unpricedCount, 1);
});
