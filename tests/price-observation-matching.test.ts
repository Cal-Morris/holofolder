import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPriceResearchHeaders,
  scorePriceObservationMatch,
  type PriceObservation,
  type PriceSubject,
} from '../lib/price-intelligence';

const haunter: PriceSubject = {
  cardId: 'mep-027',
  name: 'Haunter',
  setId: 'mep',
  setName: 'MEP Black Star Promos',
  localId: '027',
  language: 'en',
};

function observation(overrides: Partial<PriceObservation>): PriceObservation {
  return {
    provider: 'ebay',
    title: 'Pokemon Mega Evolution Promo MEP027 Haunter Illustration Rare',
    sourceUrl: 'https://example.test/item/1',
    amount: 12,
    currency: 'GBP',
    observedAt: '2026-06-28T12:00:00.000Z',
    ...overrides,
  };
}

test('scorePriceObservationMatch accepts exact name and promo number matches', () => {
  const result = scorePriceObservationMatch(haunter, observation({}));

  assert.equal(result.rejected, false);
  assert.equal(result.rating, 'exact');
  assert.ok(result.score >= 90);
  assert.ok(result.reasons.includes('name matched'));
  assert.ok(result.reasons.includes('number matched'));
});

test('scorePriceObservationMatch rejects pick-your-card and lot listings', () => {
  const pickYourCard = scorePriceObservationMatch(
    haunter,
    observation({ title: 'Pokemon Mega Evolution Promos MEP001-MEP030 Choose Your Card' }),
  );
  const lot = scorePriceObservationMatch(haunter, observation({ title: 'Pokemon Haunter promo bundle lot, 12 cards' }));

  assert.equal(pickYourCard.rejected, true);
  assert.ok(pickYourCard.rejectReasons.includes('multi-card selection listing'));
  assert.equal(lot.rejected, true);
  assert.ok(lot.rejectReasons.includes('lot or bundle listing'));
});

test('scorePriceObservationMatch rejects graded slabs for raw card pricing', () => {
  const result = scorePriceObservationMatch(
    haunter,
    observation({ title: 'PSA 10 Pokemon Haunter MEP027 Mega Evolution Promo' }),
  );

  assert.equal(result.rejected, true);
  assert.ok(result.rejectReasons.includes('graded slab listing'));
});

test('scorePriceObservationMatch rejects wrong collector numbers even when the name matches', () => {
  const result = scorePriceObservationMatch(
    haunter,
    observation({ title: 'Pokemon Mega Evolution Promo MEP026 Haunter Illustration Rare' }),
  );

  assert.equal(result.rejected, true);
  assert.ok(result.rejectReasons.includes('collector number mismatch'));
});

test('buildPriceResearchHeaders uses an honest bot user agent', () => {
  const headers = buildPriceResearchHeaders();

  assert.match(headers['User-Agent'], /^HoloFolderPriceResearch\/1\.0 /);
  assert.doesNotMatch(headers['User-Agent'], /Mozilla|Chrome|Safari/i);
  assert.equal(headers.Accept, 'text/html,application/json;q=0.9,*/*;q=0.8');
});
