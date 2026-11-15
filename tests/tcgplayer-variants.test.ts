import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTcgplayerVariants,
  candidateGroups,
  matchGroupVariants,
  newTcgplayerLinks,
  tcgplayerCard,
  type TcgplayerCard,
} from '@/lib/tcgplayer-variants';

// Synthetic TCGCSV-shaped fixtures, not real product ids or listings.
const product = (productId: number, name: string, number?: string, groupId = 500) => ({
  productId,
  groupId,
  name,
  extendedData: number ? [{ name: 'Number', value: number }] : [],
});
const price = (productId: number, subTypeName: string) => ({ productId, subTypeName });
const card = (id: string, local_id: string, name_en: string, extra: Partial<TcgplayerCard> = {}): TcgplayerCard => ({
  id,
  set_id: 'syn',
  local_id,
  name_en,
  ...extra,
});
const variantsOf = (result: ReturnType<typeof matchGroupVariants>) =>
  Object.fromEntries([...result!.matches].map(([id, m]) => [id, m.variants]));

test('a set tries the groups its stored links use, then its map, then name, nearest release first', () => {
  const groups = [
    { groupId: 1, name: 'SYN01: Synthetic Reign', publishedOn: '2026-11-06T00:00:00' },
    { groupId: 2, name: 'EX Synthetic Reign', publishedOn: '2005-10-31T00:00:00' },
    { groupId: 3, name: 'Synthetic Reign Promos', publishedOn: '2026-11-06T00:00:00' },
    { groupId: 4, name: 'Old Synthetic Reign', publishedOn: '2026-11-06T00:00:00' },
  ];
  const tries = (release: string | null, name = 'Synthetic Reign', id = 's', cards: TcgplayerCard[] = []) =>
    candidateGroups({ id, name_en: name, release_date: release }, groups, cards);
  assert.deepEqual(tries('2026-11-06'), [[1], [2]]);
  assert.deepEqual(tries('2005-10-31'), [[2], [1]]);
  assert.deepEqual(tries(null, 'Reign'), []);
  assert.deepEqual(tries(null, 'Anything', 'swsh12.5'), [[17688, 17689]]);
  // Stored links: groups most of the set uses go first, read together; a stray single link is ignored.
  const linked = [
    ...Array.from({ length: 8 }, (_, i) => card(`a${i}`, String(i), 'A', { knownGroup: 9 })),
    card('b', '9', 'B', { knownGroup: 3 }),
    card('c', '10', 'C', { knownGroup: 3 }),
    card('d', '11', 'D', { knownGroup: 7 }),
  ];
  assert.deepEqual(tries('2026-11-06', 'Synthetic Reign', 's', linked), [[3, 9], [1], [2]]);
});

test('finishes come from the sold subtypes, matched by collector number and told apart by name', () => {
  const cards = [
    card('syn-001', '001', 'Synthmon'),
    card('syn-002', '2', 'Synthmon ex'),
    card('syn-003', '003', 'Deltamon δ'),
    card('syn-004', '004', 'Twinmon'),
    card('syn-005', '005', 'Oldmon'),
    card('syn-006', '006', 'Ballmon'),
    card('syn-007', '007', 'Heromon'),
  ];
  const products = [
    product(10, 'Synthmon - 001/005', '001/005'),
    product(20, 'Synthmon ex - 002/005', '002/005'),
    product(30, 'Deltamon (Delta Species)', '3/5'),
    product(40, 'Twinmon - 004/005', '004/005'),
    product(41, 'Twinmon (Staff Stamp)', '004/005'),
    product(50, 'Oldmon', '5/5'),
    product(60, 'Ballmon - 006/005', '006/005'),
    product(61, 'Ballmon - 006/005 (Poke Ball Pattern)', '006/005'),
    product(70, 'Heromon', '007/005'),
    product(71, 'Heromon (Poke Ball)', '007/005'),
    product(90, 'Synthetic Booster Box'),
  ];
  const prices = [
    price(10, 'Normal'),
    price(10, 'Reverse Holofoil'),
    price(20, 'Holofoil'),
    price(30, 'Holofoil'),
    price(30, 'Reverse Holofoil'),
    price(40, 'Normal'),
    price(41, 'Holofoil'),
    price(50, '1st Edition'),
    price(50, 'Unlimited'),
    price(60, 'Normal'),
    price(60, 'Reverse Holofoil'),
    price(61, 'Holofoil'),
    price(70, 'Normal'),
    price(71, 'Reverse Holofoil'),
    price(90, 'Normal'),
  ];
  const result = matchGroupVariants(cards, products, prices);
  // Twinmon and Ballmon: a stamped or patterned printing shares the number and name; the plain one is the card.
  assert.deepEqual(variantsOf(result), {
    'syn-001': { normal: true, holo: false, reverse: true },
    'syn-002': { normal: false, holo: true, reverse: false },
    'syn-003': { normal: false, holo: true, reverse: true },
    'syn-004': { normal: true, holo: false, reverse: false },
    'syn-005': { normal: true, holo: false, reverse: false, firstEdition: true },
    'syn-006': { normal: true, holo: false, reverse: true },
    // Its only reverse holo is sold as a patterned product.
    'syn-007': { normal: true, holo: false, reverse: true },
  });
  assert.deepEqual(
    { ...result!.matches.get('syn-004'), variants: undefined },
    { productId: 40, groupId: 500, by: 'number', variants: undefined },
  );
});

test('an id we hold wins over the collector number, and a number match against a held id is a conflict', () => {
  const cards = [
    // Our link names the stamped printing: kept, even though the number alone would pick the plain one.
    card('syn-1', '1', 'Linkmon', { known: ['11'] }),
    // We hold an id that isn't in these groups; the number match disagrees with it, so nothing is applied.
    card('syn-2', '2', 'Elsewheremon', { known: ['999'] }),
    card('syn-3', '3', 'Newmon'),
  ];
  const products = [
    product(10, 'Linkmon', '1/3'),
    product(11, 'Linkmon (Staff Stamp)', '1/3'),
    product(20, 'Elsewheremon', '2/3'),
    product(30, 'Newmon', '3/3'),
  ];
  const result = matchGroupVariants(cards, products, [
    price(10, 'Normal'),
    price(11, 'Holofoil'),
    price(20, 'Normal'),
    price(30, 'Normal'),
  ])!;
  assert.deepEqual(
    [...result.matches].map(([id, m]) => [id, m.productId, m.by]),
    [
      ['syn-1', 11, 'id'],
      ['syn-3', 30, 'number'],
    ],
  );
  assert.deepEqual(result.conflicts, ['syn-2']);
});

test('a group that only covers a few of the cards is not this set, and an ambiguous number is skipped', () => {
  const cards = Array.from({ length: 10 }, (_, i) => card(`syn-${i + 1}`, String(i + 1), `Mon ${i + 1}`));
  const few = [product(1, 'Mon 1', '1/10'), product(2, 'Mon 2', '2/10')];
  assert.equal(matchGroupVariants(cards, few, [price(1, 'Normal'), price(2, 'Normal')]), null);
  const all = cards.map((_, i) => product(i + 1, `Other ${i + 1}`, `${i + 1}/10`));
  all.push(product(99, 'Another 1', '1/10'));
  const result = matchGroupVariants(
    cards,
    all,
    all.map((p) => price(p.productId, 'Normal')),
  )!;
  assert.equal(result.matches.has('syn-1'), false);
  assert.equal(result.matches.size, 9);
});

test('known ids are our stored link first, then TCGdex ids; only cards without a link get one stored', () => {
  const row = {
    id: 'syn-1',
    set_id: 'syn',
    local_id: '1',
    name_en: 'Mon',
    external_ids_json: { tcgdex: { thirdParty: { tcgplayer: 222 } } },
  };
  assert.deepEqual(tcgplayerCard(row, { source_card_id: '111', source_set_id: '5' }), {
    id: 'syn-1',
    set_id: 'syn',
    local_id: '1',
    name_en: 'Mon',
    known: ['111', '222'],
    knownGroup: 5,
  });
  assert.deepEqual(tcgplayerCard({ ...row, external_ids_json: {} }, undefined), {
    id: 'syn-1',
    set_id: 'syn',
    local_id: '1',
    name_en: 'Mon',
  });
  const variants = { normal: true, holo: false, reverse: true };
  const matches = new Map([
    ['syn-1', { productId: 111, groupId: 5, by: 'id' as const, variants }],
    ['syn-2', { productId: 333, groupId: 5, by: 'number' as const, variants }],
  ]);
  assert.deepEqual(newTcgplayerLinks(matches, new Set(['syn-1'])), [
    { card_id: 'syn-2', source: 'tcgcsv-pricing', source_card_id: '333', source_set_id: '5', raw_json: {} },
  ]);
});

test("TCGplayer's finishes win over TCGdex flags and are kept as evidence; unmatched cards are untouched", () => {
  const row = {
    id: 'syn-001',
    variants_json: { normal: true, holo: false, reverse: false, jumbo: false },
    external_ids_json: { tcgdex: {} },
  };
  assert.equal(applyTcgplayerVariants(row, undefined), row);
  const evidence = { normal: false, holo: true, reverse: true };
  assert.deepEqual(applyTcgplayerVariants(row, evidence), {
    id: 'syn-001',
    variants_json: { normal: false, holo: true, reverse: true, jumbo: false },
    external_ids_json: { tcgdex: {}, tcgplayerVariants: evidence },
  });
});
