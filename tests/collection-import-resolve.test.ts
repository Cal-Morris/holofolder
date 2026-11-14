import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchImportSets, resolveImportLookup, readImportLookups } from '../lib/collection-import-resolve';
import type { SearchCardResult } from '../lib/pokemon-card-browse';
const lookup = {
  language: 'en',
  finish: 'normal',
  list: 'owned',
  cardName: 'Bulbasaur',
  set: 'Base Set',
  number: '0044/102',
} as const;
const candidate: SearchCardResult = {
  id: 'synthetic-base-44',
  name: 'Bulbasaur',
  localId: '44',
  language: 'en',
  set: { id: 'synthetic-base', name: 'Base Set', officialCardCount: 102 },
  dexIds: [1],
  variants: { normal: true },
};
const cardOf = (result: ReturnType<typeof resolveImportLookup>) => ('card' in result ? result.card.id : undefined);
const finishOf = (result: ReturnType<typeof resolveImportLookup>) => ('finish' in result ? result.finish : undefined);

test('resolves exact identity, retains leading-number meaning and refuses ambiguity', () => {
  assert.equal(cardOf(resolveImportLookup(lookup, [candidate])), candidate.id);
  // Trainers and cards with two Pokémon are ordinary inventory copies now.
  assert.equal(cardOf(resolveImportLookup(lookup, [{ ...candidate, dexIds: [] }])), candidate.id);
  for (const candidates of [
    [{ ...candidate, name: 'Other' }],
    [{ ...candidate, language: 'ja' }],
    [candidate, { ...candidate, id: 'different-printing' }],
  ])
    assert.equal(cardOf(resolveImportLookup(lookup, candidates)), undefined);
  assert.equal(cardOf(resolveImportLookup({ ...lookup, finish: 'reverse_holo' }, [candidate])), undefined);
  assert.equal(cardOf(resolveImportLookup({ ...lookup, number: '44/99' }, [candidate])), undefined);
  assert.equal(cardOf(resolveImportLookup(lookup, [{ ...candidate, variants: { reverse: true } }])), undefined);
});
test('explicit IDs never fall back to a similarly named card', () => {
  assert.equal(cardOf(resolveImportLookup({ ...lookup, cardId: 'unknown' }, [candidate])), undefined);
  assert.equal(cardOf(resolveImportLookup({ ...lookup, cardId: candidate.id }, [candidate])), candidate.id);
});
test("a tracker's standard print becomes the printing's own finish", () => {
  const ex = { ...candidate, name: 'Charizard ex', rarity: 'Double rare', variants: { holo: true } };
  assert.equal(
    finishOf(resolveImportLookup({ ...lookup, cardName: 'Charizard ex', finish: 'holo' }, [ex])),
    'double_rare',
  );
  const holo = { ...candidate, variants: { holo: true } };
  assert.equal(finishOf(resolveImportLookup(lookup, [holo])), 'holo');
  // No recorded variants: the file's print is the only evidence there is.
  assert.equal(finishOf(resolveImportLookup({ ...lookup, finish: 'holo' }, [{ ...candidate, variants: {} }])), 'holo');
  // Both prints exist: the file's choice decides.
  const both = { ...candidate, variants: { normal: true, holo: true } };
  assert.equal(finishOf(resolveImportLookup({ ...lookup, finish: 'holo' }, [both])), 'holo');
  assert.equal(finishOf(resolveImportLookup(lookup, [both])), 'normal');
});
test('names may carry a number suffix or a qualifier; gallery totals are not set counts', () => {
  const tg = { ...candidate, name: 'Gardevoir', localId: 'TG05', variants: { holo: true } };
  const row = { ...lookup, cardName: 'Gardevoir', number: 'TG05/TG30', finish: 'holo' } as const;
  assert.equal(cardOf(resolveImportLookup(row, [tg])), tg.id);
  const ex = { ...candidate, name: 'Charizard ex', localId: '199', set: { ...candidate.set, officialCardCount: 165 } };
  for (const cardName of ['Charizard ex - 199/165', 'Charizard EX (Secret)'])
    assert.equal(cardOf(resolveImportLookup({ ...lookup, cardName, number: '199/165' }, [ex])), ex.id);
  assert.equal(cardOf(resolveImportLookup({ ...lookup, cardName: 'Pikachu', number: '199/165' }, [ex])), undefined);
  // A German card named in English, as TCG Collector exports it.
  const german = { ...ex, language: 'de', name: 'Glurak-ex', englishName: 'Charizard ex' };
  const germanRow = { ...lookup, language: 'de', cardName: 'Charizard ex', number: '199/165' } as const;
  assert.equal(cardOf(resolveImportLookup(germanRow, [german])), ex.id);
});
test('set names from other trackers find our set and its gallery subsets, never a guess', () => {
  const sets = [
    { id: 'sv03.5', name: '151' },
    { id: 'sv01', name: 'Scarlet & Violet' },
    { id: 'swsh7', name: 'Evolving Skies' },
    { id: 'swsh12', name: 'Silver Tempest' },
    { id: 'swsh12tg', name: 'Silver Tempest Trainer Gallery' },
    { id: 'swsh10.5', name: 'Pokémon GO' },
    { id: 'base1', name: 'Base Set' },
    { id: 'base4', name: 'Base Set 2' },
  ];
  assert.deepEqual(matchImportSets(sets, 'SV: Scarlet & Violet 151'), ['sv03.5']);
  assert.deepEqual(matchImportSets(sets, 'Scarlet & Violet—151'), ['sv03.5']);
  assert.deepEqual(matchImportSets(sets, 'SV01: Scarlet & Violet Base Set'), ['sv01']);
  assert.deepEqual(matchImportSets(sets, 'Scarlet & Violet'), ['sv01']);
  assert.deepEqual(matchImportSets(sets, 'SWSH07: Evolving Skies'), ['swsh7']);
  assert.deepEqual(matchImportSets(sets, 'Silver Tempest'), ['swsh12', 'swsh12tg']);
  assert.deepEqual(matchImportSets(sets, 'Pokemon GO'), ['swsh10.5']);
  assert.deepEqual(matchImportSets(sets, 'Base Set'), ['base1']);
  assert.deepEqual(matchImportSets(sets, 'base4'), ['base4']);
  assert.deepEqual(matchImportSets(sets, 'Base Set (Shadowless)'), []);
  assert.deepEqual(matchImportSets([...sets, { id: 'dup', name: '151' }], '151'), []);
  const promos = [...sets, { id: 'svp', name: 'SVP Black Star Promos' }];
  for (const name of ['SV Black Star Promos', 'SV: Scarlet & Violet Promo Cards', 'Scarlet & Violet Promos'])
    assert.deepEqual(matchImportSets(promos, name), ['svp']);
  assert.deepEqual(matchImportSets(promos, 'Promo'), []);
});
test('lookup request accepts bounded identities only', () => {
  assert.deepEqual(readImportLookups({ lookups: [lookup] }), [lookup]);
  for (const body of [
    { lookups: Array(26).fill(lookup) },
    { lookups: [{ ...lookup, language: 'xx' }] },
    { lookups: [{ ...lookup, cardId: 'a'.repeat(241) }] },
    { lookups: [{ ...lookup, tcgplayerId: '1),x' }] },
    { lookups: [{ ...lookup, cells: ['private note'] }] },
  ])
    assert.throws(() => readImportLookups(body));
});

test('reviewed aliases cannot cross language, finish or an ambiguous printing family', () => {
  const alias = 'synthetic-reviewed-alias';
  const aliased = { ...candidate, aliasIds: [alias] };
  const exact = { language: 'en', finish: 'normal', list: 'owned', cardId: alias } as const;
  assert.equal(cardOf(resolveImportLookup(exact, [aliased])), candidate.id);
  for (const conflicting of [
    { ...aliased, language: 'ja' },
    { ...aliased, variants: { reverse: true } },
  ])
    assert.equal(cardOf(resolveImportLookup(exact, [conflicting])), undefined);
  assert.equal(
    cardOf(resolveImportLookup(exact, [aliased, { ...aliased, id: 'unrelated-global-printing' }])),
    undefined,
  );
  assert.throws(() => readImportLookups({ lookups: [{ ...exact, tcgplayerId: '42' }] }), /namespace/);
});
