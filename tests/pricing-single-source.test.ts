import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as client from '../hooks/use-card-prices';
import * as server from '../lib/card-pricing';

const SHARED = [
  'getBuySignalStatusLabel',
  'getCardPriceKey',
  'getPriceSourceLabel',
  'normalizeBuySignal',
  'normalizeCardLanguage',
  'normalizePriceConfidence',
  'normalizePriceSource',
  'normalizeSourcePrices',
  'normalizeTrendPoints',
] as const;

test('client pricing helpers are the lib/card-pricing implementations, not copies', () => {
  for (const name of SHARED) {
    assert.equal(typeof server[name], 'function', name);
    assert.equal(client[name], server[name], name);
  }
});

test('hooks/use-card-prices declares no pricing types or normalizers of its own', () => {
  const source = readFileSync(new URL('../hooks/use-card-prices.ts', import.meta.url), 'utf8');
  for (const name of [...SHARED, 'readFiniteNumber']) {
    assert.doesNotMatch(source, new RegExp(`function ${name}\\(`), name);
  }
  for (const type of [
    'SupportedCurrency',
    'PriceSource',
    'PriceConfidence',
    'CardLanguage',
    'BuySignalStatus',
    'CardPriceSourceSummary',
    'CardPriceTrendPoint',
    'CardBuySignal',
  ]) {
    assert.doesNotMatch(source, new RegExp(`^(export )?(type|interface) ${type}\\b`, 'm'), type);
  }
});

test('lib/card-pricing never statically imports the service-role Supabase client', () => {
  const source = readFileSync(new URL('../lib/card-pricing.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import \{[^}]*\} from ["']@\/lib\/supabase\/admin["']/m);
  assert.match(source, /^import type \{ createAdminClient \} from ["']@\/lib\/supabase\/admin["']/m);
});

test('shared normalizers keep the client cache behaviour', () => {
  // Labelled test fixtures, not market data.
  assert.deepEqual(
    client
      .normalizeTrendPoints([
        { label: '7d', source: 'cardmarket', gbpAmount: 4, originalAmount: 5, originalCurrency: 'EUR' },
        { label: 'bad', source: 'nope', gbpAmount: 4, originalAmount: 5, originalCurrency: 'EUR' },
      ])
      .map((point) => point.label),
    ['7d'],
  );
  assert.equal(client.normalizePriceConfidence('bogus'), 'unknown');
  assert.equal(client.normalizeBuySignal({ status: 'rising' })?.label, 'Rising');
  assert.equal(client.getCardPriceKey('sv1-001', 'FR'), 'sv1-001::fr');
});
