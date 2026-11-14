import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findPokemonById,
  findPokemonBySlug,
  groupCardsBySet,
  pokemonByGeneration,
  pokemonSlug,
} from '@/lib/pokemon-pages';

describe('pokemonSlug', () => {
  test('dex number plus the display name, readable and ASCII', () => {
    assert.equal(pokemonSlug({ id: 197, name: 'umbreon' }), '197-umbreon');
    assert.equal(pokemonSlug({ id: 122, name: 'mr-mime' }), '122-mr-mime');
    assert.equal(pokemonSlug({ id: 29, name: 'nidoran-f' }), '29-nidoran-f');
    assert.equal(pokemonSlug({ id: 32, name: 'nidoran-m' }), '32-nidoran-m');
    assert.equal(pokemonSlug({ id: 772, name: 'type-null' }), '772-type-null');
    assert.equal(pokemonSlug({ id: 487, name: 'giratina-altered' }), '487-giratina');
  });

  test('every species gets a unique slug that finds it again', () => {
    const all = pokemonByGeneration().flatMap((gen) => gen.pokemon);
    assert.equal(all.length, 1025);
    assert.equal(new Set(all.map((p) => p.slug)).size, 1025);
    for (const pokemon of all) assert.equal(findPokemonBySlug(pokemon.slug)?.id, pokemon.id);
  });
});

describe('findPokemonBySlug', () => {
  test('only the exact slug finds a species, so each page has one URL', () => {
    assert.equal(findPokemonBySlug('197-umbreon')?.name, 'Umbreon');
    for (const slug of ['197', '197-espeon', '197-umbreon-', '0197-umbreon', '9999-x', 'umbreon', ''])
      assert.equal(findPokemonBySlug(slug), undefined, slug);
  });

  test('neighbours stop at the ends of the National Dex', () => {
    assert.equal(findPokemonById(0), undefined);
    assert.equal(findPokemonById(1026), undefined);
    assert.equal(findPokemonById(1)?.slug, '1-bulbasaur');
  });
});

test('pokemonByGeneration covers the nine generations in dex order', () => {
  const gens = pokemonByGeneration();
  assert.deepEqual(
    gens.map((gen) => [gen.region, gen.pokemon[0].id, gen.pokemon.at(-1)!.id]),
    [
      ['Kanto', 1, 151],
      ['Johto', 152, 251],
      ['Hoenn', 252, 386],
      ['Sinnoh', 387, 493],
      ['Unova', 494, 649],
      ['Kalos', 650, 721],
      ['Alola', 722, 809],
      ['Galar', 810, 905],
      ['Paldea', 906, 1025],
    ],
  );
});

// Synthetic sets and cards; names mirror real sets but ids and dates are illustrative.
describe('groupCardsBySet', () => {
  const sets = [
    { id: 'new', slug: 'new', name: 'New Set', seriesName: 'Scarlet & Violet', releaseDate: '2025-01-01' },
    { id: 'mid', slug: 'mid', name: 'Mid Set', seriesName: 'Scarlet & Violet', releaseDate: '2024-01-01' },
    { id: 'old', slug: 'old', name: 'Old Set', seriesName: 'Sword & Shield', releaseDate: '2021-01-01' },
    { id: 'empty', slug: 'empty', name: 'Empty Set', seriesName: 'Sword & Shield', releaseDate: '2022-01-01' },
  ];
  const cards = [
    { id: 'old-1', setId: 'old' },
    { id: 'new-2', setId: 'new' },
    { id: 'mid-1', setId: 'mid' },
    { id: 'new-1', setId: 'new' },
    { id: 'gone-1', setId: 'not-public' },
  ];

  test('series and sets newest first, cards keep their order, empty and unknown sets left out', () => {
    const groups = groupCardsBySet(cards, sets);
    assert.deepEqual(
      groups.map((group) => [group.series, group.sets.map(({ set, cards }) => [set.id, cards.map((c) => c.id)])]),
      [
        [
          'Scarlet & Violet',
          [
            ['new', ['new-2', 'new-1']],
            ['mid', ['mid-1']],
          ],
        ],
        ['Sword & Shield', [['old', ['old-1']]]],
      ],
    );
  });

  test('no cards, no groups', () => {
    assert.deepEqual(groupCardsBySet([], sets), []);
  });
});
