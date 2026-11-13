import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCollectionInsights,
  buildWantListInsights,
  momentumSparkline,
} from '../lib/collection/analytics-insights';
import type { WantedDashboardCard } from '../lib/wanted-dashboard';
import type { MomentumPriceInput } from '../lib/price-momentum';

// Synthetic test fixtures only; none of these cards or prices are real market data.
const now = Date.parse('2026-11-13T12:00:00.000Z');
const recent = new Date(now - 86_400_000).toISOString();
const quote = (points: Record<string, number>, confidence = 'high'): MomentumPriceInput & { confidence: string } => ({
  confidence: confidence as MomentumPriceInput['confidence'],
  updatedAt: recent,
  trendPoints: Object.entries(points).map(([label, gbpAmount]) => ({ label, source: 'cardmarket', gbpAmount })),
});
const row = (itemId: string, over: Record<string, unknown> = {}) => ({
  itemId,
  name: `Card ${itemId}`,
  cardId: `set-${itemId}`,
  speciesNames: [],
  setName: 'Set A',
  image: null,
  language: 'en',
  finish: 'normal',
  graded: false,
  ...over,
});

describe('buildCollectionInsights', () => {
  test('collapses copies of one printing, ranks value and gates movers on confidence', () => {
    const rows = [
      row('a'),
      row('a2', { cardId: 'set-a' }),
      row('b', { setName: 'Set B' }),
      row('c', { setName: 'Set B' }),
      row('g', { graded: true }),
    ];
    const copies = [
      { itemId: 'a', amountGbp: 12, quote: quote({ '30d': 10, '7d': 11, trend: 12 }) },
      { itemId: 'a2', amountGbp: 12, quote: quote({ '30d': 10, '7d': 11, trend: 12 }) },
      { itemId: 'b', amountGbp: 4, quote: quote({ '30d': 10, '7d': 8, trend: 4 }, 'low') },
      { itemId: 'c', amountGbp: null, quote: null },
      { itemId: 'g', amountGbp: null, quote: quote({ '30d': 10, trend: 30 }) },
    ];
    const insights = buildCollectionInsights(rows, copies, now);

    assert.deepEqual(
      insights.topCards.map((c) => [c.key, c.copies]),
      [
        ['set-a|en|normal', 2],
        ['set-b|en|normal', 1],
      ],
    );
    assert.deepEqual(
      insights.rising.map((c) => c.key),
      ['set-a|en|normal'],
    );
    // Low confidence drop and graded copy never become signals.
    assert.equal(insights.falling.length, 0);
    assert.deepEqual(insights.confidence, { high: 2, medium: 0, low: 1, unpriced: 1, graded: 1 });
    assert.deepEqual(insights.valueBySet[0], { name: 'Set A', valueGbp: 24, copies: 3 });
  });

  test('folds small sets into one bar', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`r${i}`, { setName: `Set ${i}` }));
    const copies = rows.map((r, i) => ({ itemId: r.itemId, amountGbp: i + 1, quote: null }));
    const { valueBySet, setCount } = buildCollectionInsights(rows, copies, now);
    assert.equal(setCount, 8);
    assert.equal(valueBySet.length, 7);
    assert.deepEqual(valueBySet.at(-1), { name: '2 other sets', valueGbp: 3, copies: 2 });
  });
});

test('momentumSparkline reads the momentum source in time order', () => {
  const price = quote({ '30d': 10, '7d': 11, trend: 12 });
  assert.deepEqual(
    momentumSparkline(price, {
      change: 0.2,
      timeframe: '30d',
      source: 'cardmarket',
      currentGbpAmount: 12,
      baselineGbpAmount: 10,
    }),
    [10, 11, 12],
  );
});

test('buildWantListInsights gates drops, rises and cheapest picks on confidence', () => {
  const want = (id: string, amount: number | null, price?: ReturnType<typeof quote>) =>
    ({
      key: id,
      card: { card_id: id, card_name: id, added_at: '' },
      pokemonId: 0,
      pokemonName: id,
      price,
      isPriced: amount !== null,
      effectiveGbpAmount: amount,
    }) as unknown as WantedDashboardCard;
  const insights = buildWantListInsights(
    [
      want('drop', 6, quote({ '30d': 10, '7d': 8, trend: 6 })),
      want('climb', 15, quote({ '30d': 10, '7d': 12, trend: 15 })),
      want('climb', 15, quote({ '30d': 10, '7d': 12, trend: 15 })),
      want('shaky', 1, quote({ '30d': 10, trend: 1 }, 'low')),
      want('unpriced', null),
    ],
    now,
  );
  assert.deepEqual(
    insights.drops.map((d) => d.card.key),
    ['drop'],
  );
  assert.deepEqual(
    insights.rising.map((d) => d.card.key),
    ['climb'],
  );
  assert.deepEqual(
    insights.cheapest.map((c) => c.key),
    ['drop', 'climb'],
  );
  assert.deepEqual(insights.total, { totalGbp: 36, priced: 3, unknown: 2 });
});
