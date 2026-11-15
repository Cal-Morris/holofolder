import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_MM } from '@/lib/print-placeholders';
import {
  layoutPageArt,
  normalizePageArt,
  pageArtSlices,
  parsePageArtInput,
  pageArtUploadIds,
  putPageArt,
  rectFromCorners,
} from '@/lib/page-art';

// Synthetic fixtures: made-up slot ids, card ids and image keys.
const upload = 'upload:0f8fad5b-d9cb-469f-a165-70867728950e';
const card = (id: string, anchorSlotId: string, rows = 1, cols = 3) => ({
  id,
  anchorSlotId,
  rows,
  cols,
  source: { kind: 'card', cardId: 'synthetic-1', image: 'pokemon/tcg/cards/en/synthetic/1/high.webp' },
  frame: { fit: 'fill', zoom: 1, x: 0, y: 0 },
});

describe('page art input', () => {
  test('accepts card, Pokémon and upload sources', () => {
    const parsed = parsePageArtInput([
      card('a', 's1'),
      { id: 'b', anchorSlotId: 's4', rows: 2, cols: 3, source: { kind: 'pokemon', pokemonId: 25 } },
      { id: 'c', anchorSlotId: 's9', rows: 1, cols: 1, source: { kind: 'upload', id: upload } },
    ]);
    assert.equal(parsed?.length, 3);
    assert.deepEqual(pageArtUploadIds(parsed!), [upload]);
  });
  test('accepts a full card image URL on our host and stores its key', () => {
    const parsed = parsePageArtInput([
      {
        ...card('a', 's1'),
        source: {
          kind: 'card',
          cardId: 'x',
          image: 'https://assets.holofolder.com/pokemon/tcg/cards/en/synthetic/1/high.webp',
        },
      },
    ]);
    assert.deepEqual(parsed?.[0]?.source, {
      kind: 'card',
      cardId: 'x',
      image: 'pokemon/tcg/cards/en/synthetic/1/high.webp',
    });
  });
  test('rejects the whole list when one entry is bad', () => {
    assert.equal(parsePageArtInput([card('a', 's1'), { ...card('b', 's2'), rows: 9 }]), null);
    assert.equal(
      parsePageArtInput([
        { ...card('a', 's1'), source: { kind: 'card', cardId: 'x', image: 'https://evil.example/a.png' } },
      ]),
      null,
    );
    assert.equal(parsePageArtInput([card('a', 's1'), card('a', 's2')]), null);
    assert.equal(parsePageArtInput({}), null);
  });
  test('reads drop broken entries and tolerate a missing column', () => {
    assert.deepEqual(normalizePageArt(null), []);
    assert.equal(normalizePageArt([card('a', 's1'), 'junk']).length, 1);
  });
});

describe('layoutPageArt', () => {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
  test('places a span by its anchor pocket and marks the joined cells', () => {
    const { placed, covered } = layoutPageArt(normalizePageArt([card('a', 's4', 2, 2)]), ids, 3, 3);
    assert.deepEqual(
      placed.map(({ row, col, rows, cols }) => ({ row, col, rows, cols })),
      [{ row: 1, col: 0, rows: 2, cols: 2 }],
    );
    assert.deepEqual([...covered].toSorted(), [3, 4, 6, 7]);
  });
  test('clips a span that runs off the page, and skips anchors on other pages', () => {
    const { placed } = layoutPageArt(normalizePageArt([card('a', 's6', 3, 3), card('b', 'elsewhere')]), ids, 3, 3);
    assert.deepEqual(
      placed.map(({ row, col, rows, cols }) => ({ row, col, rows, cols })),
      [{ row: 1, col: 2, rows: 2, cols: 1 }],
    );
  });
  test('the art follows its anchor when the page moves', () => {
    const arts = normalizePageArt([card('a', 's1', 3, 3)]);
    assert.equal(layoutPageArt(arts, ['x1', 'x2'], 3, 3).placed.length, 0);
    assert.equal(layoutPageArt(arts, ids, 3, 3).placed.length, 1);
  });
});

describe('pageArtSlices', () => {
  test('skips the gap between pockets so the picture lines up across the welds', () => {
    const { placed } = layoutPageArt(normalizePageArt([card('a', 's1', 1, 3)]), ['s1', 's2', 's3'], 1, 3);
    const slices = pageArtSlices([{ page: 1, placed }], 3, { x: 4, y: 4 }, CARD_MM);
    assert.equal(slices.length, 3);
    assert.equal(slices[0]!.width, 63 * 3 + 4 * 2);
    assert.deepEqual(
      slices.map((s) => s.left),
      [0, 67, 134],
    );
  });
  test('leaves out pockets that already hold a card', () => {
    const { placed } = layoutPageArt(normalizePageArt([card('a', 's1', 1, 3)]), ['s1', 's2', 's3'], 1, 3);
    const slices = pageArtSlices([{ page: 1, placed, filled: new Set([1]) }], 3, { x: 0, y: 0 }, CARD_MM);
    assert.deepEqual(
      slices.map((s) => s.col),
      [0, 2],
    );
  });
});

describe('putPageArt', () => {
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
  const grid = { rows: 3, cols: 3 };
  const source = { kind: 'pokemon', pokemonId: 25 } as const;
  const frame = { fit: 'fill', zoom: 1, x: 0, y: 0 } as const;
  test('anchors to the top-left pocket of the rectangle, from corners in any order', () => {
    const rect = rectFromCorners(8, 4, 3);
    assert.deepEqual(rect, { row: 1, col: 1, rows: 2, cols: 2 });
    const result = putPageArt([], ids, grid, { id: 'n', source, frame }, rect);
    assert.equal(result?.arts[0]?.anchorSlotId, 's5');
  });
  test('replaces artworks it overlaps and keeps the rest', () => {
    const arts = normalizePageArt([card('top', 's1', 1, 3), card('bottom', 's7', 1, 3)]);
    const result = putPageArt(arts, ids, grid, { id: 'n', source, frame }, { row: 0, col: 0, rows: 2, cols: 3 });
    assert.deepEqual(
      result?.arts.map((a) => a.id),
      ['bottom', 'n'],
    );
    assert.equal(result?.replaced, 1);
  });
  test('editing an artwork moves it rather than duplicating it', () => {
    const arts = normalizePageArt([card('a', 's1', 1, 1)]);
    const result = putPageArt(arts, ids, grid, { id: 'a', source, frame }, { row: 2, col: 2, rows: 1, cols: 1 });
    assert.deepEqual(
      result?.arts.map((a) => [a.id, a.anchorSlotId]),
      [['a', 's9']],
    );
  });
  test('needs a pocket at the corner', () => {
    assert.equal(
      putPageArt(
        [],
        ['s1', null],
        { rows: 1, cols: 2 },
        { id: 'n', source, frame },
        { row: 0, col: 1, rows: 1, cols: 1 },
      ),
      null,
    );
  });
});
