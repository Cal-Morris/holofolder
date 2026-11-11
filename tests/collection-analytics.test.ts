import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCollectionAnalytics,
  normalizeAnalyticsHistory,
  parseAnalyticsQuery,
  activityDescription,
} from '../lib/collection-analytics';
import type { CollectedPokemon } from '../lib/domain/cards';
import type { CardPriceSnapshot } from '../lib/card-pricing';

// Synthetic fixtures, not real card or price observations.
const now = Date.parse('2026-10-11T12:00:00Z');
const owned: CollectedPokemon = {
  id: 'fixture',
  pokemon_id: 1,
  pokemon_name: 'bulbasaur',
  card_id: 'fixture-card',
  card_name: 'Fixture card',
  card_finish: 'normal',
  card_language: 'en',
  status: 'collected',
  wanted_cards: [],
  collected_at: '2026-01-01T00:00:00Z',
};
const quote: CardPriceSnapshot = {
  cardId: 'fixture-card',
  language: 'en',
  gbpAmount: 12,
  marketGbpAmount: 12,
  goodGbpAmount: null,
  lowGbpAmount: null,
  highGbpAmount: null,
  confidence: 'high',
  sourcePrices: [],
  trendPoints: [
    { label: '7d', source: 'cardmarket', gbpAmount: 10, originalAmount: 10, originalCurrency: 'GBP' },
    { label: 'Trend', source: 'cardmarket', gbpAmount: 12, originalAmount: 12, originalCurrency: 'GBP' },
  ],
  buySignal: null,
  originalAmount: null,
  originalCurrency: null,
  source: 'cardmarket',
  variantLabel: 'Normal',
  updatedAt: new Date(now).toISOString(),
  fxDate: null,
};
const prices = (price = quote) => ({
  'fixture-card::en': { ...price, finishPrices: [{ ...price, finish: 'normal' as const, variantKey: 'normal' }] },
});

test('cardless owned species count toward completion, never priced inventory', () => {
  const result = buildCollectionAnalytics([{ ...owned, card_id: undefined }], {}, now);
  assert.equal(result.ownedSpecies, 1);
  assert.equal(result.assignedCards, 0);
  assert.equal(result.pricedCards, 0);
  assert.equal(result.valueGbp, 0);
});

test('owned value and movers match exact finish, wanted is separate', () => {
  const result = buildCollectionAnalytics(
    [
      {
        ...owned,
        wanted_cards: [
          {
            card_id: 'fixture-card',
            card_name: 'Fixture wanted',
            card_language: 'en',
            card_finish: 'holo',
            added_at: '2026-10-01T00:00:00Z',
          },
        ],
      },
    ],
    prices(),
    now,
  );
  assert.equal(result.valueGbp, 12);
  assert.equal(result.pricedCards, 1);
  assert.equal(result.wantedCards, 1);
  assert.equal(result.rising.length, 1);
  assert.equal(result.cards.find((card) => card.scope === 'wanted')?.price, null);
  assert.equal(buildCollectionAnalytics([{ ...owned, card_finish: 'holo' }], prices(), now).pricedCards, 0);
});

test('weak, stale, missing timestamp and future data cannot call movers', () => {
  for (const price of [
    { ...quote, confidence: 'low' as const },
    { ...quote, updatedAt: '2026-10-01T00:00:00Z' },
    { ...quote, updatedAt: null },
    { ...quote, updatedAt: '2026-11-01T00:00:00Z' },
  ]) {
    assert.equal(buildCollectionAnalytics([owned], prices(price), now).rising.length, 0);
  }
  assert.equal(buildCollectionAnalytics([owned], prices({ ...quote, marketGbpAmount: NaN }), now).pricedCards, 0);
});

test('falling uses one source and suppresses a reversed 30d decline', () => {
  const falling = { ...quote, trendPoints: [{ ...quote.trendPoints[0], gbpAmount: 20 }, quote.trendPoints[1]] };
  assert.equal(buildCollectionAnalytics([owned], prices(falling), now).falling[0]?.momentum.change, -0.4);
  const reversed = {
    ...quote,
    trendPoints: [
      { ...quote.trendPoints[0], label: '30d', gbpAmount: 20 },
      { ...quote.trendPoints[0], gbpAmount: 10 },
      quote.trendPoints[1],
    ],
  };
  assert.equal(buildCollectionAnalytics([owned], prices(reversed), now).falling.length, 0);
  const mixed = {
    ...falling,
    trendPoints: [{ ...falling.trendPoints[0], source: 'tcgplayer' as const }, falling.trendPoints[1]],
  };
  assert.equal(buildCollectionAnalytics([owned], prices(mixed), now).falling.length, 0);
});

test('history rejects malformed private rows and unusable price points', () => {
  const result = normalizeAnalyticsHistory({
    activity: [
      { id: '1', pokemon_id: 1, pokemon_name: 'Fixture', recorded_at: 'invalid', before_state: null, after_state: {} },
    ],
    priceHistory: [
      {
        card_id: 'fixture-card',
        language: 'en',
        observed_day: '2026-10-11',
        recorded_at: '2026-10-11T12:00:00Z',
        gbp_amount: 'NaN',
        confidence: 'high',
        source: 'cardmarket',
      },
    ],
  });
  assert.deepEqual(result.activity, []);
  assert.deepEqual(result.priceHistory, []);
});

test('history query accepts bounded cursor and identity, rejects language/filter injection', () => {
  assert.deepEqual(parseAnalyticsQuery(new URLSearchParams('cardId=fixture-1&language=ja&beforeId=123')), {
    cardId: 'fixture-1',
    language: 'ja',
    beforeId: '123',
  });
  assert.equal(parseAnalyticsQuery(new URLSearchParams('cardId=mep-070~685563')).cardId, 'mep-070~685563');
  for (const query of [
    'beforeId=-1',
    'beforeId=9223372036854775808',
    'cardId=x%2Cuser_id.eq.owner',
    'language=unknown',
    'ownerId=someone-else',
  ])
    assert.throws(() => parseAnalyticsQuery(new URLSearchParams(query)));
});

test('wanted duplicates and malformed historical dates cannot inflate data', () => {
  const wanted = {
    card_id: 'fixture-card',
    card_name: 'Fixture',
    card_language: 'en' as const,
    card_finish: 'normal' as const,
    added_at: '2026-01-01T00:00:00Z',
  };
  assert.equal(buildCollectionAnalytics([{ ...owned, wanted_cards: [wanted, wanted] }], prices(), now).wantedCards, 1);
  for (const recorded_at of ['1', '2026-02-30', '2026-13-01', 'invalid'])
    assert.equal(
      normalizeAnalyticsHistory({ activity: [{ id: '1', pokemon_id: 1, pokemon_name: 'Fixture', recorded_at }] })
        .activity.length,
      0,
    );
});

test('activity names actual printing and wanted changes, keeping saved dates separate', () => {
  const event = {
    id: '1',
    pokemon_id: 1,
    pokemon_name: 'Fixture',
    recorded_at: '2026-10-11T12:00:00Z',
    before_state: { status: 'collected', card_id: 'old', card_name: 'Old', wanted_cards: [] },
    after_state: {
      status: 'collected',
      card_id: 'new',
      card_name: 'New',
      wanted_cards: [{ card_id: 'want', card_name: 'Want' }],
    },
  };
  assert.equal(activityDescription(event), 'Replaced Old with New; Wanted Want');
  assert.equal(
    activityDescription({ ...event, before_state: event.after_state, after_state: null }),
    'Removed New; Removed wanted Want',
  );
});

test("a reverse holo is valued from TCGplayer's reverseHolofoil row, never a 1st Edition row", () => {
  const reverse = { ...owned, card_finish: 'reverse_holo' as const };
  const withRows = (variantKey: string) => ({
    'fixture-card::en': {
      ...quote,
      finishPrices: [{ ...quote, gbpAmount: 3, marketGbpAmount: 3, finish: 'reverse_holo' as const, variantKey }],
    },
  });
  assert.equal(buildCollectionAnalytics([reverse], withRows('reverseHolofoil'), now).valueGbp, 3);
  assert.equal(buildCollectionAnalytics([reverse], withRows('reverse-holofoil'), now).valueGbp, 3);
  assert.equal(
    buildCollectionAnalytics(
      [{ ...owned }],
      {
        'fixture-card::en': {
          ...quote,
          finishPrices: [
            { ...quote, gbpAmount: 90, marketGbpAmount: 90, finish: 'normal' as const, variantKey: '1st-edition' },
          ],
        },
      },
      now,
    ).pricedCards,
    0,
  );
});

// Synthetic inventory exercises coverage and grouping without provider requests.
test('dashboard breakdown keeps unknown prices, wanted cards and copies distinct', async () => {
  const { buildAnalyticsBreakdown } = await import('../lib/collection-analytics');
  const rows = [
    owned,
    { ...owned, id: 'second-copy' },
    { ...owned, id: 'unpriced', pokemon_id: 4, card_id: 'no-quote', card_set: 'Fixture set' },
    { ...owned, id: 'want', pokemon_id: 7, status: 'wishlisted' as const },
  ];
  const summary = buildCollectionAnalytics(rows, prices(), now, { countCopies: true });
  const result = buildAnalyticsBreakdown(summary);
  assert.equal(result.topCards.length, 2);
  assert.equal(result.unpriced.length, 1);
  assert.deepEqual(result.sets, [
    { name: 'Unknown set', count: 2 },
    { name: 'Fixture set', count: 1 },
  ]);
  assert.equal(result.uncertainPrices, 0);
  assert.equal(summary.ownedSpecies, 2);
  assert.equal(summary.wantedCards, 1);
});

test('dashboard reports weak price coverage and handles empty inventory', async () => {
  const { buildAnalyticsBreakdown } = await import('../lib/collection-analytics');
  assert.equal(
    buildAnalyticsBreakdown(buildCollectionAnalytics([owned], prices({ ...quote, confidence: 'low' }), now))
      .uncertainPrices,
    1,
  );
  assert.deepEqual(buildAnalyticsBreakdown(buildCollectionAnalytics([], {}, now)), {
    sets: [],
    unpriced: [],
    topCards: [],
    uncertainPrices: 0,
  });
});

test('dashboard ranks priced owned cards by value without treating missing as zero', async () => {
  const { buildAnalyticsBreakdown } = await import('../lib/collection-analytics');
  const summary = buildCollectionAnalytics(
    [owned, { ...owned, pokemon_id: 4, card_id: 'other', card_set: 'Fixture' }],
    { ...prices(), 'other::en': { ...quote, marketGbpAmount: 100 } },
    now,
  );
  assert.deepEqual(
    buildAnalyticsBreakdown(summary).topCards.map((card) => card.amount),
    [100, 12],
  );
});
