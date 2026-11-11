import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidateCardsForAssetTextOcr } from '../lib/card-scan-candidate-text';
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

function card(id: string, localId: string, name = 'Pikachu'): TestCard {
  return {
    id,
    name,
    localId,
    set: { id: 'sv1', name: 'Scarlet & Violet' },
  };
}

function match(card: TestCard, similarity: number): AggregatedCardScanMatch<TestCard> {
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

test('selectCandidateCardsForAssetTextOcr prioritizes visual winners and metadata text hits', () => {
  const visual = card('visual', '001');
  const textOnly = card('text-only', '088');
  const filler = Array.from({ length: 8 }, (_, index) => card(`filler-${index}`, `${index + 10}`));

  const selected = selectCandidateCardsForAssetTextOcr(
    [filler[0], textOnly, ...filler.slice(1), visual],
    [match(visual, 0.79)],
    extractCardTextSignals('088/197 Scarlet Violet'),
    {
      getCardId: (candidate) => candidate.id,
      maxCards: 3,
    },
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ['text-only', 'visual', 'filler-0'],
  );
});

test('selectCandidateCardsForAssetTextOcr uses stable bounded ordering and removes duplicates', () => {
  const alpha = card('alpha', '001');
  const beta = card('beta', '002');
  const gamma = card('gamma', '003');
  const delta = card('delta', '004');

  const selected = selectCandidateCardsForAssetTextOcr(
    [alpha, beta, gamma, delta],
    [match(gamma, 0.91), match(beta, 0.88), match(gamma, 0.86)],
    null,
    {
      getCardId: (candidate) => candidate.id,
      maxCards: 3,
    },
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ['gamma', 'beta', 'alpha'],
  );
});

test('selectCandidateCardsForAssetTextOcr keeps exact collector metadata ahead of weaker visual noise', () => {
  const exact = card('exact', 'TG05');
  const visual = card('visual', '005');
  const other = card('other', '006');

  const selected = selectCandidateCardsForAssetTextOcr(
    [visual, other, exact],
    [match(visual, 0.93), match(other, 0.9)],
    extractCardTextSignals('Trainer Gallery TG05/TG30 Thunderbolt'),
    {
      getCardId: (candidate) => candidate.id,
      maxCards: 2,
    },
  );

  assert.deepEqual(
    selected.map((candidate) => candidate.id),
    ['exact', 'visual'],
  );
});
