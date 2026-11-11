import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePriceObservationMatch,
  summarizePriceObservations,
  type PriceObservation,
  type PriceSubject,
} from '../lib/price-intelligence';

// Everything below is a labelled test fixture, not real market data.
const now = Date.parse('2026-10-09T12:00:00.000Z');
const fxRates = { eurToGbp: 0.85, usdToGbp: 0.75 };
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

const subject: PriceSubject = {
  cardId: 'mep-027',
  name: 'Haunter',
  setId: 'mep',
  setName: 'MEP Black Star Promos',
  localId: '027',
  language: 'en',
};

let counter = 0;
function fixtureObservation(amount: number, overrides: Partial<PriceObservation> = {}): PriceObservation {
  counter += 1;
  return {
    provider: 'ebay',
    title: 'Pokemon Mega Evolution Promo MEP027 Haunter Illustration Rare',
    sourceUrl: `https://example.test/item/${counter}`,
    amount,
    currency: 'GBP',
    observedAt: daysAgo(1),
    soldAt: daysAgo(2),
    ...overrides,
  };
}

const summarize = (observations: PriceObservation[], target: PriceSubject = subject) =>
  summarizePriceObservations(target, observations, { fxRates, now });

test('no usable observations yields an unknown, unpriced summary', () => {
  const summary = summarize([]);
  assert.equal(summary.marketGbpAmount, null);
  assert.equal(summary.confidence, 'unknown');
  assert.equal(summary.usedCount, 0);
});

test('one or two comps are low-volume noise and only ever low confidence', () => {
  assert.equal(summarize([fixtureObservation(10)]).confidence, 'low');
  const two = summarize([fixtureObservation(10), fixtureObservation(12)]);
  assert.equal(two.confidence, 'low');
  assert.equal(two.marketGbpAmount, 11);
});

test('a tight set of sold comps reaches high confidence with median market and p25 good target', () => {
  const summary = summarize([10, 10.5, 11, 11.5, 12, 12, 12.5, 13].map((amount) => fixtureObservation(amount)));

  assert.equal(summary.confidence, 'high');
  assert.equal(summary.usedCount, 8);
  assert.equal(summary.marketGbpAmount, 11.75);
  assert.equal(summary.goodGbpAmount, 10.88);
  assert.ok((summary.lowGbpAmount ?? 0) <= (summary.goodGbpAmount ?? 0));
  assert.ok((summary.highGbpAmount ?? 0) >= (summary.marketGbpAmount ?? 0));
});

test('mostly active listings (not sold) are capped at medium', () => {
  const summary = summarize(
    [10, 10.5, 11, 11.5, 12, 12, 12.5, 13].map((amount) => fixtureObservation(amount, { soldAt: null })),
  );
  assert.equal(summary.confidence, 'medium');
});

test('outliers are removed before the median is taken', () => {
  const summary = summarize([10, 11, 12, 11, 10.5, 250, 0.99].map((amount) => fixtureObservation(amount)));

  assert.equal(summary.excluded.outlier, 2);
  assert.equal(summary.usedCount, 5);
  assert.equal(summary.marketGbpAmount, 11);
  assert.ok((summary.highGbpAmount ?? 0) < 13);
});

test('identical comps plus one spike still drop the spike (degenerate MAD)', () => {
  const summary = summarize([10, 10, 10, 10, 40].map((amount) => fixtureObservation(amount)));
  assert.equal(summary.excluded.outlier, 1);
  assert.equal(summary.marketGbpAmount, 10);
});

test('EUR and USD observations are converted to GBP before aggregating', () => {
  const summary = summarize([
    fixtureObservation(10, { currency: 'GBP' }),
    fixtureObservation(10, { currency: 'EUR' }),
    fixtureObservation(10, { currency: 'USD' }),
  ]);
  assert.equal(summary.marketGbpAmount, 8.5);
  assert.equal(summary.lowGbpAmount, 7.7);
  assert.equal(summary.highGbpAmount, 9.7);
});

test('observations with an unusable FX rate or invalid amount are excluded, not guessed', () => {
  const summary = summarizePriceObservations(
    subject,
    [
      fixtureObservation(10, { currency: 'USD' }),
      fixtureObservation(0),
      fixtureObservation(-5),
      fixtureObservation(Number.NaN),
      fixtureObservation(12),
    ],
    { fxRates: { eurToGbp: 0.85, usdToGbp: Number.NaN }, now },
  );

  assert.equal(summary.excluded.currency, 1);
  assert.equal(summary.excluded.invalidAmount, 3);
  assert.equal(summary.usedCount, 1);
  assert.equal(summary.marketGbpAmount, 12);
});

test('stale and future-dated observations are ignored', () => {
  const summary = summarize([
    fixtureObservation(10),
    fixtureObservation(30, { soldAt: daysAgo(120) }),
    fixtureObservation(30, { soldAt: null, observedAt: daysAgo(200) }),
    fixtureObservation(30, { soldAt: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString() }),
    fixtureObservation(30, { soldAt: 'not a date' }),
  ]);
  assert.equal(summary.excluded.stale, 4);
  assert.equal(summary.marketGbpAmount, 10);
});

test('lots, slabs, jumbos and weak matches never reach the summary', () => {
  const summary = summarize([
    fixtureObservation(10),
    fixtureObservation(90, { title: 'PSA 10 Haunter MEP027 Mega Evolution Promo' }),
    fixtureObservation(2, { title: 'Haunter MEP027 promo lot of 5 cards' }),
    fixtureObservation(40, { title: 'Jumbo Haunter MEP027 Mega Evolution Promo' }),
    fixtureObservation(3, { title: 'Haunter pokemon card' }),
  ]);
  assert.equal(summary.excluded.rejected, 3);
  assert.equal(summary.excluded.weakMatch, 1);
  assert.equal(summary.usedCount, 1);
});

test('variant mismatches are rejected when the subject printing is known', () => {
  const normal: PriceSubject = { ...subject, variant: 'normal' };
  const reverse: PriceSubject = { ...subject, variant: 'reverse' };
  const firstEdition: PriceSubject = { ...subject, variant: '1st-edition' };
  const reverseTitle = 'Haunter MEP027 Mega Evolution Promo Reverse Holo';
  const firstEdTitle = 'Haunter MEP027 Mega Evolution Promo 1st Edition';
  const plainTitle = 'Haunter MEP027 Mega Evolution Promo';

  assert.deepEqual(scorePriceObservationMatch(normal, fixtureObservation(5, { title: reverseTitle })).rejectReasons, [
    'variant mismatch: reverse holo',
  ]);
  assert.deepEqual(scorePriceObservationMatch(reverse, fixtureObservation(5, { title: plainTitle })).rejectReasons, [
    'variant mismatch: reverse holo',
  ]);
  assert.equal(scorePriceObservationMatch(reverse, fixtureObservation(5, { title: reverseTitle })).rejected, false);
  assert.deepEqual(scorePriceObservationMatch(normal, fixtureObservation(5, { title: firstEdTitle })).rejectReasons, [
    'variant mismatch: 1st edition',
  ]);
  assert.equal(
    scorePriceObservationMatch(firstEdition, fixtureObservation(5, { title: firstEdTitle })).rejected,
    false,
  );
  assert.equal(scorePriceObservationMatch(normal, fixtureObservation(5, { title: plainTitle })).rejected, false);
  // Unknown subject printing keeps the previous, permissive behaviour.
  assert.equal(scorePriceObservationMatch(subject, fixtureObservation(5, { title: reverseTitle })).rejected, false);

  const summary = summarize(
    [fixtureObservation(10, { title: plainTitle }), fixtureObservation(25, { title: reverseTitle })],
    normal,
  );
  assert.equal(summary.usedCount, 1);
  assert.equal(summary.marketGbpAmount, 10);
});
