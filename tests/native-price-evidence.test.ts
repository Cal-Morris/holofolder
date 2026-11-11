import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nativeCatalogueQuote,
  nativeSoldEvidenceAllowed,
  type NativeCatalogueQuote,
} from '../lib/native-price-evidence';
import { buildBundlePriceGuide } from '../lib/bundle-price-guide';
import { checkBundle } from '../lib/deal-check';
import type { CardPriceCheck } from '../lib/card-price-checks';

const now = Date.parse('2026-11-10T12:00:00Z');
const card = { id: 'synthetic-card', language: 'en', variants: { normal: true } };
const quote: NativeCatalogueQuote = {
  cardId: card.id,
  language: 'en',
  finish: 'normal',
  variantKey: 'normal',
  source: 'cardmarket',
  confidence: 'high',
  updatedAt: new Date(now).toISOString(),
  gbpAmount: 100,
};
const entry = {
  card,
  finish: 'normal' as const,
  currency: 'GBP',
  gbpPerUnit: 1,
  marketPrice: 100,
  catalogMarketGbp: 100,
  nativeEvidence: { catalogue: quote, soldExact: true },
};

test('native catalogue requires exact identity, provenance, finite amount and known current date', () => {
  assert.equal(nativeCatalogueQuote(card, 'normal', quote, now)?.gbpAmount, 100);
  for (const changed of [
    { ...quote, cardId: 'other' },
    { ...quote, language: 'ja' as const },
    { ...quote, finish: 'holo' as const },
    { ...quote, variantKey: 'first-edition' },
    { ...quote, source: null },
    { ...quote, confidence: 'low' as const },
    { ...quote, updatedAt: null },
    { ...quote, updatedAt: 'invalid' },
    { ...quote, updatedAt: new Date(now + 1000).toISOString() },
    { ...quote, gbpAmount: NaN },
    { ...quote, gbpAmount: Infinity },
    { ...quote, gbpAmount: 0 },
  ])
    assert.equal(nativeCatalogueQuote(card, 'normal', changed, now), undefined);
  assert.equal(nativeCatalogueQuote({ ...card, language: undefined }, 'normal', quote, now), undefined);
  assert.equal(nativeCatalogueQuote(card, 'ultra_rare', quote, now), undefined);
  assert.equal(nativeCatalogueQuote(card, 'normal', quote, now + 8 * 86400000)?.confidence, 'medium');
  assert.equal(nativeCatalogueQuote(card, 'normal', quote, now + 31 * 86400000), undefined);
});

test('native saved sold checks never turn unknown language or any-finish evidence into an exact match', () => {
  assert.equal(nativeSoldEvidenceAllowed(card, 'normal'), true);
  assert.equal(nativeSoldEvidenceAllowed({ language: undefined, variants: { normal: true } }, 'normal', true), false);
  assert.equal(nativeSoldEvidenceAllowed({ ...card, language: 'ja' }, 'normal', true), false);
  assert.equal(nativeSoldEvidenceAllowed(card, 'ultra_rare', true), false);
  assert.equal(nativeSoldEvidenceAllowed({ language: 'en' }, 'normal'), false);
  assert.equal(nativeSoldEvidenceAllowed({ language: 'en' }, 'normal', true), true);
});

test('qualified saved sales cannot bypass native bundle identity gates', () => {
  const soldCheck: CardPriceCheck = {
    checkedAt: new Date(now).toISOString(),
    summary: { kind: 'sold', currency: 'GBP', count: 12, low: 100, median: 100, high: 100 },
    sales: Array.from({ length: 12 }, (_, i) => ({
      amount: 100,
      soldAt: new Date(now - ((i % 3) + 1) * 86400000).toISOString().slice(0, 10),
    })),
  };
  const sold = { ...entry, nativeEvidence: { soldExact: true }, catalogMarketGbp: null, soldCheck };
  assert.equal(buildBundlePriceGuide([sold], 'GBP', undefined, now, true, true).marketTotal, 100);
  for (const invalid of [
    { ...sold, card: { ...card, language: undefined } },
    { ...sold, finish: 'ultra_rare' as const },
    { ...sold, nativeEvidence: undefined },
  ]) {
    const guide = buildBundlePriceGuide([invalid], 'GBP', undefined, now, true, true);
    assert.equal(guide.complete, false);
    assert.equal(checkBundle(guide.items, 70, undefined, true).deal, null);
  }
});

test('native bundle ages retained provenance and never uses a legacy amount fallback', () => {
  const fresh = buildBundlePriceGuide([entry, entry], 'GBP', undefined, now, true, true);
  assert.equal(fresh.marketTotal, 200);
  assert.equal(checkBundle(fresh.items, 140, undefined, true).deal?.verdict, 'great');
  for (const invalid of [
    { ...entry, nativeEvidence: undefined },
    { ...entry, card: { ...card, language: undefined } },
    { ...entry, catalogMarketGbp: 120 },
    { ...entry, finish: 'ultra_rare' as const },
  ])
    assert.equal(buildBundlePriceGuide([invalid], 'GBP', undefined, now, true, true).complete, false);
  const expired = buildBundlePriceGuide([entry], 'GBP', undefined, now + 40 * 86400000, true, true);
  assert.equal(expired.complete, false);
  assert.equal(expired.marketTotal, 0);
  assert.equal(checkBundle(expired.items, 70, undefined, true).deal, null);
  // Existing legacy retained-price behavior stays separate.
  assert.equal(buildBundlePriceGuide([entry], 'GBP', undefined, now + 40 * 86400000).marketTotal, 100);
});
