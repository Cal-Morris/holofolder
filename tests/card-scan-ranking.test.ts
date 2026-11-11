import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAggregatedCardScanMatchesWithText } from '../lib/card-scan-ranking';
import { extractCardTextSignals } from '../lib/card-scan-text';
import type { AggregatedCardScanMatch } from '../lib/card-scan-matching';

type TestCard = {
  id: string;
  name: string;
  localId: string;
  set: {
    id: string;
    name: string;
  };
};

const visualCard = { id: 'visual', name: 'Pikachu', localId: '006', set: { id: 'base1', name: 'Base Set' } };
const textCard = { id: 'text', name: 'Pikachu', localId: 'TG05', set: { id: 'swsh11tg', name: 'Trainer Gallery' } };

function aggregated(card: TestCard, similarity: number): AggregatedCardScanMatch<TestCard> {
  return {
    card,
    similarity,
    score: similarity,
    appearances: 2,
    appearanceRatio: 1,
    confidence: similarity,
    margin: 0,
  };
}

test('rankAggregatedCardScanMatchesWithText can recover a slot from OCR when visual finalists are empty', () => {
  const ranked = rankAggregatedCardScanMatchesWithText<TestCard>([], extractCardTextSignals('TG05/TG30'), {
    candidateCards: [visualCard, textCard],
    getCardId: (card) => card.id,
  });

  assert.equal(ranked[0]?.card.id, 'text');
  assert.ok(ranked[0]?.similarity >= 0.67);
  assert.ok(ranked[0]?.confidence >= 0.64);
  assert.ok(ranked[0]?.margin >= 0.67);
});

test('rankAggregatedCardScanMatchesWithText recalculates margins after OCR changes the order', () => {
  const ranked = rankAggregatedCardScanMatchesWithText<TestCard>(
    [aggregated(visualCard, 0.64)],
    extractCardTextSignals('TG05/TG30'),
    {
      candidateCards: [visualCard, textCard],
      getCardId: (card) => card.id,
    },
  );

  assert.equal(ranked[0]?.card.id, 'text');
  assert.equal(Number(ranked[0]?.margin.toFixed(2)), Number((ranked[0].similarity - ranked[1].similarity).toFixed(2)));
});

test('rankAggregatedCardScanMatchesWithText can use candidate asset OCR evidence', () => {
  const ranked = rankAggregatedCardScanMatchesWithText<TestCard>(
    [aggregated(visualCard, 0.7)],
    extractCardTextSignals('Sparkling Gale Moonlight Blade 088/197'),
    {
      candidateCards: [visualCard, textCard],
      candidateTextSignals: new Map([
        [visualCard.id, extractCardTextSignals('Static Shock Gnaw 006/102')],
        [textCard.id, extractCardTextSignals('Sparkling Gale Moonlight Blade 088/197')],
      ]),
      getCardId: (card) => card.id,
    },
  );

  assert.equal(ranked[0]?.card.id, 'text');
  assert.ok(ranked[0]?.confidence > ranked[1]?.confidence);
});
