import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dequantizeInt8, planEmbeddingSync, toVectorLiteral } from '../lib/card-assets/embeddings-db';
import {
  isSameArtwork,
  isSimilarCardsResponse,
  SAME_ARTWORK_ANY_CREDIT,
  SAME_ARTWORK_SIMILARITY,
  type CardSubject,
  normalizeSimilarNeighbours,
  splitSimilarNeighbours,
  type SimilarNeighbour,
} from '../lib/similar-cards';

// Synthetic fixtures: card ids, keys and similarities below are made up for these tests.
const n = (cardId: string, similarity: number, lang = 'en'): SimilarNeighbour => ({ cardId, lang, similarity });

const subjects = (entries: Record<string, CardSubject>) => new Map(Object.entries(entries));
const pokemon = (dexId: number, illustrator?: string): CardSubject => ({ dexIds: [dexId], illustrator });

describe('isSameArtwork', () => {
  test('needs the same subject, then a matching credit or a very close picture', () => {
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6, 'A'), SAME_ARTWORK_SIMILARITY), true);
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6, ' a '), 0.8), true);
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6), 0.8), true, 'an uncredited reprint');
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6, 'B'), 0.9), false, 'another artist draws another picture');
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6, 'B'), SAME_ARTWORK_ANY_CREDIT), true);
    assert.equal(isSameArtwork(pokemon(6, 'A'), pokemon(6, 'A'), 0.7), false);
    assert.equal(
      isSameArtwork(pokemon(6, 'A'), pokemon(9, 'A'), 0.99),
      false,
      'a template full art of another Pokémon',
    );
  });
  test('cards without a Pokédex number compare by English name', () => {
    const energy = (name: string): CardSubject => ({ dexIds: [], name, category: 'Trainer' });
    assert.equal(isSameArtwork(energy('Fire Energy'), energy('fire energy'), 0.95), true);
    assert.equal(isSameArtwork(energy('Fire Energy'), energy('Water Energy'), 0.99), false);
    assert.equal(isSameArtwork(energy('Pikachu'), pokemon(25), 0.99), false);
    const japanese: CardSubject = { dexIds: [], illustrator: 'Artist', category: 'Trainer' };
    assert.equal(isSameArtwork({ ...energy('Nest Ball'), illustrator: 'artist' }, japanese, 0.9), true);
    assert.equal(isSameArtwork(energy('Nest Ball'), japanese, 0.9), false, 'no credit to compare');
    const unlinked = (illustrator: string): CardSubject => ({ dexIds: [], illustrator, category: 'Pokemon' });
    assert.equal(
      isSameArtwork(unlinked('5ban'), unlinked('5ban'), 0.85),
      false,
      'a credit alone never matches Pokémon',
    );
  });
});

describe('splitSimilarNeighbours', () => {
  const known = subjects({
    'a-1': pokemon(6, 'A'),
    'b-1': pokemon(6, 'A'),
    'c-1': pokemon(9, 'A'),
    'd-1': pokemon(6, 'B'),
    'e-1': pokemon(6, 'A'),
  });
  test('splits by the same-artwork rule, most similar first', () => {
    const split = splitSimilarNeighbours('a-1', [n('c-1', 0.95), n('b-1', 0.85), n('d-1', 0.86), n('e-1', 0.5)], known);
    assert.deepEqual(
      split.sameArtwork.map((x) => x.cardId),
      ['b-1'],
    );
    assert.deepEqual(
      split.similarLook.map((x) => x.cardId),
      ['c-1', 'd-1', 'e-1'],
    );
  });

  test('drops the card itself in other languages, repeats, unknown cards and languages the app cannot show', () => {
    const split = splitSimilarNeighbours(
      'a-1',
      [
        n('a-1', 0.99, 'de'),
        n('b-1', 0.97, 'fr'),
        n('b-1', 0.96, 'en'),
        n('e-1', 0.9, 'id'),
        n('z-1', 0.9),
        n('c-1', 0.4, 'ja'),
      ],
      known,
    );
    assert.deepEqual(
      split.sameArtwork.map((x) => [x.cardId, x.lang]),
      [['b-1', 'fr']],
    );
    assert.deepEqual(
      split.similarLook.map((x) => [x.cardId, x.lang]),
      [['c-1', 'ja']],
    );
  });

  test('caps each group', () => {
    const many = Array.from({ length: 10 }, (_, i) => n(`s-${i}`, 0.99 - i * 0.001));
    const rest = Array.from({ length: 10 }, (_, i) => n(`l-${i}`, 0.5 - i * 0.01));
    const all = subjects(
      Object.fromEntries([['a-1', pokemon(6)], ...[...many, ...rest].map((x) => [x.cardId, pokemon(6)])]),
    );
    const split = splitSimilarNeighbours('a-1', [...many, ...rest], all, { sameArtwork: 3, similarLook: 2 });
    assert.equal(split.sameArtwork.length, 3);
    assert.deepEqual(
      split.similarLook.map((x) => x.cardId),
      ['l-0', 'l-1'],
    );
  });
});

describe('normalizeSimilarNeighbours', () => {
  test('reads rows and drops malformed ones', () => {
    assert.deepEqual(
      normalizeSimilarNeighbours([
        { card_id: 'b-1', lang: 'en', similarity: 0.9 },
        { card_id: 'c-1', lang: 'ja', similarity: '0.5' },
        { card_id: 1, lang: 'en', similarity: 0.9 },
        { card_id: 'd-1', lang: 'en', similarity: 'x' },
        null,
      ]),
      [n('b-1', 0.9), n('c-1', 0.5, 'ja')],
    );
    assert.deepEqual(normalizeSimilarNeighbours(null), []);
  });
});

describe('isSimilarCardsResponse', () => {
  const card = { id: 'b-1', name: 'Card', localId: '1', set: { id: 's', name: 'Set' }, dexIds: [1], similarity: 0.9 };
  test('accepts the route response and rejects malformed ones', () => {
    assert.equal(isSimilarCardsResponse({ cardId: 'a-1', language: 'en', sameArtwork: [card], similarLook: [] }), true);
    assert.equal(
      isSimilarCardsResponse({ cardId: 'a-1', sameArtwork: [{ ...card, dexIds: null }], similarLook: [] }),
      false,
    );
    assert.equal(isSimilarCardsResponse({ cardId: 'a-1', sameArtwork: [] }), false);
  });
});

describe('planEmbeddingSync', () => {
  const index = [
    { id: 'a-1', key: 'k/a' },
    { id: 'b-1', key: 'k/b2' },
    { id: 'c-1', key: 'k/c' },
  ];
  test('writes new and changed rows, removes dropped ones', () => {
    const stored = new Map([
      ['a-1', 'k/a'],
      ['b-1', 'k/b1'],
      ['z-1', 'k/z'],
    ]);
    assert.deepEqual(planEmbeddingSync(index, stored), { upsert: ['b-1', 'c-1'], remove: ['z-1'] });
  });
  test('rewrites cards embedded again this run even when the key is unchanged', () => {
    const stored = new Map(index.map((row) => [row.id, row.key]));
    assert.deepEqual(planEmbeddingSync(index, stored, new Set(['a-1'])), { upsert: ['a-1'], remove: [] });
  });
  test('a re-run with nothing changed writes nothing', () => {
    const stored = new Map(index.map((row) => [row.id, row.key]));
    assert.deepEqual(planEmbeddingSync(index, stored), { upsert: [], remove: [] });
  });
});

describe('vector helpers', () => {
  test('dequantizeInt8 returns a unit vector in the same direction', () => {
    const v = dequantizeInt8(Int8Array.from([127, 0, -127, 0]));
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6);
    assert.ok(Math.abs(v[0] - Math.SQRT1_2) < 1e-6 && Math.abs(v[2] + Math.SQRT1_2) < 1e-6);
  });
  test('toVectorLiteral writes pgvector text', () => {
    assert.equal(toVectorLiteral([0.123456789, -1, 0]), '[0.12346,-1,0]');
  });
});
