import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentFallbackImageUrl,
  GAP_NEW_SETS,
  normalizeGapName,
  normalizeGapNumber,
  planCardGapFill,
  splitProductName,
  type GapCard,
  type GapProduct,
} from '../lib/card-gap-fill';

const card = (
  id: string,
  set_id: string,
  local_id: string,
  name_en: string,
  extra: Partial<GapCard> = {},
): GapCard => ({ id, set_id, local_id, name_en, image_languages_json: [], external_ids_json: {}, ...extra });
const product = (
  productId: number,
  groupId: number,
  name: string,
  details: Record<string, string> = {},
): GapProduct => ({
  productId,
  groupId,
  name,
  extendedData: Object.entries(details).map(([name, value]) => ({ name, value })),
});
const scrydex = (id: string, name: string, number: string) => ({
  id,
  name,
  number,
  images: { large: `https://images.scrydex.com/pokemon/${id}/large` },
});
const base = {
  existingSetIds: new Set<string>(),
  existingSeriesIds: new Set(['catalog-supplements']),
  pokemontcg: {},
  tcgcsv: {},
  hasProductImage: () => true,
};

describe('card gap fill', () => {
  test('normalises names and collector numbers across sources', () => {
    assert.equal(normalizeGapName('Umbreon ☆'), normalizeGapName('Umbreon ★'));
    assert.equal(normalizeGapName('Gardevoir ex δ'), normalizeGapName('Gardevoir ex'));
    assert.equal(normalizeGapName('Mewtwo-EX'), normalizeGapName('Mewtwo EX'));
    assert.equal(normalizeGapName('Basic Fire Energy'), normalizeGapName('Fire Energy'));
    assert.equal(normalizeGapName('Poke Ball'), normalizeGapName('Poké Ball'));
    assert.equal(normalizeGapNumber('15_A1'), normalizeGapNumber('15A1'));
    assert.equal(normalizeGapNumber('092a/108'), '92a');
    assert.equal(normalizeGapNumber('%3F'), '?');
    assert.deepEqual(splitProductName('Raichu (#19 Non-Holo)'), { base: 'Raichu', qualifiers: ['#19 Non-Holo'] });
    assert.deepEqual(splitProductName('Pikachu - 018/091 (Cosmos Holo)'), {
      base: 'Pikachu',
      qualifiers: ['Cosmos Holo'],
    });
    assert.deepEqual(splitProductName('Glameow 83/130'), { base: 'Glameow', qualifiers: [] });
  });

  test('matches renumbered reprints by name and pairs same-name cards in order', () => {
    const plan = planCardGapFill({
      ...base,
      cards: [
        card('30th-c-001', '30th-c', '001', 'Charizard'),
        card('30th-c-019', '30th-c', '019', 'Darkrai & Cresselia LEGEND'),
        card('30th-c-020', '30th-c', '020', 'Darkrai & Cresselia LEGEND'),
        card('30th-c-004', '30th-c', '004', 'Genesect EX'),
      ],
      pokemontcg: {
        me55c: [
          scrydex('me55c-4', 'Charizard', '4'),
          scrydex('me55c-100', 'Darkrai & Cresselia LEGEND', '100'),
          scrydex('me55c-99', 'Darkrai & Cresselia LEGEND', '99'),
          scrydex('me55c-11g', 'Genesect-EX', '11'),
        ],
      },
    });
    assert.deepEqual(Object.fromEntries(plan.images.map((p) => [p.cardId, p.source])), {
      '30th-c-001': 'pokemontcg:me55c-4',
      '30th-c-019': 'pokemontcg:me55c-99',
      '30th-c-020': 'pokemontcg:me55c-100',
      '30th-c-004': 'pokemontcg:me55c-11g',
    });
  });

  test('never replaces an existing image and only uses mirrorable source URLs', () => {
    const plan = planCardGapFill({
      ...base,
      cards: [
        card('ecard2-50', 'ecard2', '50', 'Golduck', { image_languages_json: ['en'] }),
        card('ecard2-74', 'ecard2', '74', 'Drowzee'),
      ],
      pokemontcg: {
        ecard2: [
          {
            id: 'ecard2-50',
            name: 'Golduck',
            number: '50',
            images: { large: 'https://images.pokemontcg.io/ecard2/50_hires.png' },
          },
          { id: 'ecard2-74', name: 'Drowzee', number: '74', images: { large: 'https://example.com/74.png' } },
        ],
      },
    });
    assert.deepEqual(plan.images, []);
    assert.deepEqual(
      plan.unresolved.map((u) => u.cardId),
      ['ecard2-74'],
    );
  });

  test('uses the collector number from TCGplayer names and refuses ambiguous printings', () => {
    const plan = planCardGapFill({
      ...base,
      cards: [
        card('tk-sm-r-3', 'tk-sm-r', '3', 'Lightning Energy'),
        card('mfb-1', 'mfb', '1', 'Bulbasaur'),
        card('mfb-33', 'mfb', '33', 'Potion'),
      ],
      tcgcsv: {
        2069: [
          product(152851, 2069, 'Lightning Energy (#2)', { Number: '2/30' }),
          product(152852, 2069, 'Lightning Energy (#3)', { Number: '2/30' }),
        ],
        23330: [
          product(523984, 23330, 'Bulbasaur (Blue Border)'),
          product(523985, 23330, 'Bulbasaur'),
          product(524026, 23330, 'Potion (Bulbasaur)'),
          product(524027, 23330, 'Potion (Charmander)'),
        ],
      },
    });
    assert.deepEqual(
      plan.images.map((p) => [p.cardId, p.productId, p.image]),
      [
        ['mfb-1', '523985', 'https://product-images.tcgplayer.com/523985.jpg'],
        ['tk-sm-r-3', '152852', 'https://product-images.tcgplayer.com/152852.jpg'],
      ],
    );
    assert.deepEqual(plan.unresolved, [{ cardId: 'mfb-33', reason: 'Several source printings match' }]);
  });

  test('skips TCGplayer products without a product image', () => {
    const plan = planCardGapFill({
      ...base,
      cards: [card('ex5.5-1', 'ex5.5', '1', 'Treecko')],
      tcgcsv: { 2214: [product(162268, 2214, 'Treecko - 1/5', { Number: '001/005' })] },
      hasProductImage: () => false,
    });
    assert.equal(plan.images.length, 0);
  });

  test('aliases the same printing under two ids and gives both the image', () => {
    const plan = planCardGapFill({
      ...base,
      cards: [card('30th-c-022', '30th-c', '022', 'Palkia'), card('me55c-106p', '30th-c', '106', 'Palkia LV.X')],
      pokemontcg: { me55c: [scrydex('me55c-106p', 'Palkia LV.X', '106')] },
    });
    assert.deepEqual(plan.aliases, [
      { cardId: 'me55c-106p', catalog: { canonicalId: '30th-c-022', aliasIds: ['30th-c-022'] } },
      { cardId: '30th-c-022', catalog: { aliasIds: ['me55c-106p'] } },
    ]);
    assert.deepEqual(plan.images.map((p) => p.cardId).sort(), ['30th-c-022', 'me55c-106p']);
  });

  test('imports missing promo sets with stable ids, unique numbers and Pokédex links', () => {
    const plan = planCardGapFill({
      ...base,
      existingSeriesIds: new Set(),
      cards: [card('swsh3-103', 'swsh3', '103', 'Nickit', { external_ids_json: { catalog: { productId: '999' } } })],
      tcgcsv: {
        3179: [
          product(280301, 3179, 'Trick or Trade BOOster Bundle - Mini Booster Pack'),
          product(283818, 3179, 'Ariados', { Number: '103/189', HP: '110', 'Card Type': 'Darkness' }),
          product(283831, 3179, 'Nickit', { Number: '103/189', HP: '60' }),
          product(283766, 3179, 'Gengar (2021 Copyright Date)', { Number: '057/198', HP: '130' }),
          product(999, 3179, 'Already imported', { Number: '1/1', HP: '10' }),
        ],
      },
    });
    assert.deepEqual(
      plan.series.map((s) => s.id),
      ['catalog-supplements'],
    );
    assert.equal(plan.sets[0].id, 'trick-or-trade-2022');
    assert.deepEqual(
      plan.cards.map((c) => [c.id, c.local_id, c.name_en]),
      [
        ['tcgplayer-283766', '057/198', 'Gengar'],
        ['tcgplayer-283818', '103/189', 'Ariados'],
        ['tcgplayer-283831', '103/189~283831', 'Nickit'],
      ],
    );
    assert.deepEqual(plan.cards[0].external_ids_json, {
      catalog: { productId: '283766', image: 'https://product-images.tcgplayer.com/283766.jpg' },
    });
    assert.deepEqual(plan.dexLinks, [
      { card_id: 'tcgplayer-283766', dex_id: 94 },
      { card_id: 'tcgplayer-283818', dex_id: 168 },
      { card_id: 'tcgplayer-283831', dex_id: 827 },
    ]);
    assert.deepEqual(
      plan.externalSources.map((s) => [s.card_id, s.source, s.source_set_id]),
      [
        ['tcgplayer-283766', 'tcgcsv', '3179'],
        ['tcgplayer-283818', 'tcgcsv', '3179'],
        ['tcgplayer-283831', 'tcgcsv', '3179'],
      ],
    );
  });

  test('files a promo set with its own series under that series, not the supplemental one', () => {
    const plan = planCardGapFill({
      ...base,
      existingSetIds: new Set(GAP_NEW_SETS.filter((s) => s.id !== 'mcdonalds-2026').map((s) => s.id)),
      existingSeriesIds: new Set(),
      cards: [],
      tcgcsv: { 24938: [product(730419, 24938, 'Pikachu', { Number: '004/015', HP: '70' })] },
    });
    assert.deepEqual(plan.series, []);
    assert.deepEqual(
      plan.sets.map((s) => [s.id, s.series_id]),
      [['mcdonalds-2026', 'mc']],
    );
    assert.deepEqual(
      plan.cards.map((c) => [c.id, c.series_id, c.local_id]),
      [['tcgplayer-730419', 'mc', '004/015']],
    );
  });

  test("replaces dead images, preferring the card's own Scrydex scan", () => {
    const dead = card('2014xy-1', '2014xy', '1', 'Chespin', {
      external_ids_json: {
        pokemon_tcg: { cardId: 'mcd14-1', imageLarge: 'https://images.pokemontcg.io/mcd14/1_hires.png' },
      },
    });
    const mew = card('30th-B', '30th', 'B', 'Mew', {
      external_ids_json: { tcgdex: { image: 'https://assets.tcgdex.net/en/me/30th/B' } },
    });
    assert.equal(currentFallbackImageUrl(dead), 'https://images.pokemontcg.io/mcd14/1_hires.png');
    assert.equal(currentFallbackImageUrl(mew), 'https://assets.tcgdex.net/en/me/30th/B/high.webp');
    assert.equal(currentFallbackImageUrl({ ...mew, image_languages_json: ['en'] }), null);
    const input = { ...base, cards: [dead, mew], pokemontcg: { me55: [scrydex('me55-B', 'Mew', 'B')] } };
    assert.deepEqual(planCardGapFill(input).images, []);
    assert.deepEqual(
      planCardGapFill({ ...input, brokenImages: new Set(['2014xy-1', '30th-B']) }).images.map((p) => [
        p.cardId,
        p.image,
        p.source,
      ]),
      [
        ['30th-B', 'https://images.scrydex.com/pokemon/me55-B/large', 'pokemontcg:me55-B'],
        ['2014xy-1', 'https://images.scrydex.com/pokemon/mcd14-1/large', 'scrydex:mcd14-1'],
      ],
    );
  });

  test('addresses Scrydex and Limitless by collector number and skips dead candidates', () => {
    const energy = card('tk-sm-r-1', 'tk-sm-r', '1', 'Lightning Energy');
    const promo = card('hgssp-HGSS18', 'hgssp', 'HGSS18', 'Tropical Tidal Wave', {
      external_ids_json: { catalog: { image: 'https://images.scrydex.com/pokemon/hsp-HGSS18/large' } },
    });
    const input = {
      ...base,
      cards: [energy, promo],
      brokenImages: new Set(['hgssp-HGSS18']),
      pokemontcg: { hsp: [scrydex('hsp-HGSS18', 'Tropical Tidal Wave', 'HGSS18')] },
    };
    assert.deepEqual(
      planCardGapFill(input).images.map((p) => [p.cardId, p.image]),
      [
        ['hgssp-HGSS18', 'https://images.scrydex.com/pokemon/hsp-HGSS18/large'],
        ['tk-sm-r-1', 'https://images.scrydex.com/pokemon/tk10b-1/large'],
      ],
    );
    const replanned = planCardGapFill({
      ...input,
      unavailableImages: new Set([
        'https://images.scrydex.com/pokemon/hsp-HGSS18/large',
        'https://images.scrydex.com/pokemon/tk10b-1/large',
      ]),
    });
    assert.deepEqual(
      replanned.images.map((p) => [p.cardId, p.image, p.source]),
      [
        [
          'hgssp-HGSS18',
          'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/HSP/HSP_018_R_EN_LG.png',
          'limitless:HSP_018_R_EN_LG',
        ],
      ],
    );
    assert.deepEqual(
      replanned.unresolved.map((u) => u.cardId),
      ['tk-sm-r-1'],
    );
  });

  test('matches playshop.fr single-card scans by number and name', () => {
    const shop = (handle: string, title: string) => ({
      handle,
      title,
      image: `https://cdn.shopify.com/s/files/1/1015/7057/6719/files/${handle}.png?v=1`,
    });
    const plan = planCardGapFill({
      ...base,
      cards: [
        card('2018sm-fr-1', '2018sm-fr', '1', 'Feuillajou'),
        card('2018sm-fr-2', '2018sm-fr', '2', 'Croquine'),
        card('2019sm-fr-33', '2019sm-fr', '33', "Taupiqueur d'Alola"),
        card('2019sm-fr-33b', '2019sm-fr', '33b', "Taupiqueur d'Alola"),
      ],
      playshop: {
        '2018sm-fr': [
          shop('pokemon-2018sm-fr-1-feuillajou', '001/040 - Feuillajou'),
          shop('pokemon-2018sm-fr-2-croquine', '002/040 - Sovkipou'),
        ],
        '2019sm-fr': [shop('pokemon-2019sm-fr-33-taupiqueur-d', "033/040 - Taupiqueur d'Alola")],
      },
    });
    assert.deepEqual(
      plan.images.map((p) => [p.cardId, p.image, p.source]),
      [
        [
          '2018sm-fr-1',
          'https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2018sm-fr-1-feuillajou.png',
          'playshop:pokemon-2018sm-fr-1-feuillajou',
        ],
        [
          '2019sm-fr-33',
          'https://cdn.shopify.com/s/files/1/1015/7057/6719/files/pokemon-2019sm-fr-33-taupiqueur-d.png',
          'playshop:pokemon-2019sm-fr-33-taupiqueur-d',
        ],
      ],
    );
    assert.deepEqual(plan.unresolved.map((u) => u.cardId).sort(), ['2018sm-fr-2', '2019sm-fr-33b']);
  });
});
