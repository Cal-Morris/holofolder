import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareWithLattice,
  matchSet,
  parseLatticeCatalogue,
  type OurCard,
  type OurSet,
} from '../lib/card-assets/lattice';

// Synthetic fixtures shaped like the Card Lattice catalogue and our tcg_sets / tcg_cards rows.
const ourSets: OurSet[] = [
  { id: 'xy5', names: { en: 'Primal Clash' } },
  { id: 'sv03.5', names: { en: '151', ja: '151' } },
  { id: 'SM3p', names: { ja: 'ひかる伝説' } },
  { id: 'base1', names: { en: 'Base Set', nl: 'Basis Set' } },
];

const card = (
  setId: string,
  localId: string,
  names: Record<string, string>,
  illustrator: string | null = null,
): OurCard => ({
  id: `${setId}-${localId}`,
  setId,
  localId,
  names,
  illustrator,
});

const catalogue = parseLatticeCatalogue({
  records: [
    { id: 'pokemon-base-set', metadata: { kind: 'set', name: 'Base Set' } },
    {
      id: 'pokemon-shining-legends',
      metadata: {
        kind: 'set',
        name: 'ひかる伝説',
        attributes: { printedIdentifiers: [{ code: 'SM3+', language: 'ja' }] },
      },
    },
    {
      id: 'pokemon-gaia-volcano',
      metadata: {
        kind: 'set',
        name: 'ガイアボルケーノ',
        attributes: { printedIdentifiers: [{ code: 'XY5', language: 'ja' }] },
      },
    },
    ...[
      ['pokemon-base-set', 'nl', '001', 'Alakazam', ['Ken Sugimori']],
      ['pokemon-base-set', 'nl', '002', 'Blastoise', []],
      ['pokemon-shining-legends', 'ja', '001', 'フシギダネ', []],
      ['pokemon-shining-legends', 'ja', '099', 'ミュウツー', []],
      ['pokemon-gaia-volcano', 'ja', '001', 'フシギダネ', []],
    ].map(([setId, language, collectorNumber, name, illustrators]) => ({
      id: `${setId}-${language}-${collectorNumber}`,
      metadata: { kind: 'printing', setId, language, collectorNumber, name, attributes: { illustrators } },
    })),
  ],
});

describe('matchSet', () => {
  test('matches printed codes case-insensitively, with + as p', () => {
    assert.equal(matchSet(catalogue.sets[1], 'ja', ourSets)?.id, 'SM3p');
  });

  test('does not match a code to our set in another language', () => {
    assert.equal(matchSet(catalogue.sets[2], 'ja', ourSets), null);
  });

  test('falls back to the English name, and drops the series prefix', () => {
    assert.equal(matchSet(catalogue.sets[0], 'nl', ourSets)?.id, 'base1');
    assert.equal(
      matchSet({ id: 'pokemon-scarlet-violet-151', name: 'Scarlet & Violet—151', codes: [] }, 'en', ourSets)?.id,
      'sv03.5',
    );
  });
});

describe('compareWithLattice', () => {
  const cards = [
    card('base1', '1', { en: 'Alakazam' }),
    card('base1', '2', { en: 'Blastoise', nl: 'Blastoise' }, 'Ken Sugimori'),
    card('base1', '3', { en: 'Chansey', nl: 'Chansey' }),
    card('SM3p', '1', { ja: 'フシギダネ' }),
  ];
  const result = compareWithLattice(catalogue, ourSets, cards);

  test('finds what Card Lattice has and we do not', () => {
    assert.deepEqual(
      result.missingSets.map((set) => [set.latticeSetId, set.language]),
      [['pokemon-gaia-volcano', 'ja']],
    );
    assert.deepEqual(
      result.missingCards.map((entry) => [entry.setId, entry.number]),
      [['SM3p', '099']],
    );
    assert.deepEqual(
      result.missingLanguage.map((entry) => [entry.cardId, entry.language]),
      [['base1-1', 'nl']],
    );
    assert.deepEqual(
      result.missingIllustrator.map((entry) => entry.cardId),
      ['base1-1'],
    );
  });

  test('finds what we hold and Card Lattice does not', () => {
    assert.deepEqual(result.notInLattice, [{ setId: 'base1', language: 'nl', numbers: ['3'] }]);
    assert.deepEqual(
      result.illustratorNotInLattice.map((entry) => entry.cardId),
      ['base1-2'],
    );
    assert.deepEqual(
      result.setsNotInLattice.map((set) => `${set.setId} ${set.language}`),
      ['base1 en'],
    );
  });
});
