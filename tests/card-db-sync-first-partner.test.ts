import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFirstPartnerPackSupplementRows } from '../lib/card-db-sync';

test('buildFirstPartnerPackSupplementRows creates curated first partner cards from source rows', () => {
  const result = buildFirstPartnerPackSupplementRows(
    [
      {
        id: 'neo1-54',
        series_id: 'neo',
        set_id: 'neo1',
        local_id: '54',
        local_id_sort: 54,
        name_json: { en: 'Chikorita' },
        name_en: 'Chikorita',
        category: 'Pokemon',
        rarity: 'Common',
        hp: 40,
        illustrator: 'Test Artist',
        types_json: ['Grass'],
        image_languages_json: ['en'],
        variants_json: { normal: true, jumbo: true },
        external_ids_json: { tcgdex: { image: 'https://assets.tcgdex.net/en/neo/neo1/54/high.webp' } },
        raw_json: {},
      },
    ],
    [{ card_id: 'neo1-54', dex_id: 152 }],
  );

  assert.equal(result.set.id, 'first-partner-packs');
  assert.equal(result.set.name_en, 'First Partner Packs');
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].id, 'first-partner-neo1-54');
  assert.equal(result.cards[0].set_id, 'first-partner-packs');
  assert.equal(result.cards[0].local_id, '005');
  assert.equal(result.cards[0].local_id_sort, 5);
  assert.equal(result.cards[0].name_en, 'Chikorita');
  assert.deepEqual(result.cards[0].image_languages_json, []);
  assert.deepEqual(result.cards[0].variants_json, { normal: true });
  assert.deepEqual(result.cards[0].external_ids_json, {
    tcgdex: { image: 'https://assets.tcgdex.net/en/neo/neo1/54/high.webp' },
  });
  assert.deepEqual(result.dexLinks, [{ card_id: 'first-partner-neo1-54', dex_id: 152 }]);
});
