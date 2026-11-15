import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import { publicCardPrice } from '@/lib/public-card-price';

// Synthetic quote for the gating logic; not real price data.
const quote = (extra: Partial<CardPriceSnapshot> = {}): CardPriceSnapshot => ({
  cardId: 'fixture-1',
  language: 'en',
  gbpAmount: 12.4,
  marketGbpAmount: 12.4,
  goodGbpAmount: null,
  lowGbpAmount: 10,
  highGbpAmount: 15.2,
  confidence: 'high',
  source: 'cardmarket',
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
      updatedAt: null,
    },
  ],
  trendPoints: [],
  buySignal: null,
  originalAmount: 14.5,
  originalCurrency: 'EUR',
  variantLabel: null,
  updatedAt: '2026-11-12T08:00:00Z',
  fxDate: null,
  ...extra,
});

describe('publicCardPrice', () => {
  test('shows a confident price with its range, date and marketplace quotes in their own currency', () => {
    assert.deepEqual(publicCardPrice(quote()), {
      market: '£12.40',
      range: '£10.00 to £15.20',
      confidence: 'high',
      updated: '12 November 2026',
      finishes: [],
      sources: [{ label: 'Cardmarket · Normal', amount: '€12.00' }],
    });
  });

  test('shows nothing below medium confidence or without a positive price', () => {
    assert.equal(publicCardPrice(undefined), null);
    assert.equal(publicCardPrice(quote({ confidence: 'low' })), null);
    assert.equal(publicCardPrice(quote({ confidence: 'unknown' })), null);
    assert.equal(publicCardPrice(quote({ marketGbpAmount: null, gbpAmount: 0 })), null);
  });

  test('lists finishes only when two or more have their own confident quote', () => {
    const finish = (finishName: 'holo' | 'reverse_holo', gbpAmount: number, confidence: 'high' | 'low') => ({
      ...quote({ gbpAmount, confidence }),
      finish: finishName,
      variantKey: finishName,
    });
    const both = publicCardPrice(
      quote({ finishPrices: [finish('holo', 12, 'high'), finish('reverse_holo', 3.1, 'high')] }),
    );
    assert.deepEqual(both?.finishes, [
      { label: 'Holo', amount: '£12.00' },
      { label: 'Reverse holo', amount: '£3.10' },
    ]);
    const oneConfident = publicCardPrice(
      quote({ finishPrices: [finish('holo', 12, 'high'), finish('reverse_holo', 3.1, 'low')] }),
    );
    assert.deepEqual(oneConfident?.finishes, []);
  });
});
