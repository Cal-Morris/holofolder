import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, catalogRows, snapshotCardIds } from './fixtures/inventory-read-server';
import { buildInventoryCatalog } from '@/lib/server/inventory-read-catalog';

// Synthetic ownership, actual mirror coordinates and image metadata only.
test('native catalog projects attested printing images just like legacy mirror reads', async () => {
  const f = fixture(0);
  const { inventoryBrowseFixture } = await import('./fixtures/inventory-browse');
  const snapshot = inventoryBrowseFixture(1);
  f.tables.tcg_cards = [
    {
      id: 'base1-4',
      series_id: 'base',
      set_id: 'base1',
      local_id: '4',
      name_en: 'Charizard',
      name_json: { en: 'Charizard', ja: 'リザードン' },
      image_languages_json: ['en', 'ja'],
      external_ids_json: {},
    },
  ];
  f.tables.tcg_sets = [{ id: 'base1', name_en: 'Base Set' }];
  const read = async () => buildInventoryCatalog(catalogRows(f.tables, snapshotCardIds(snapshot)));
  let cards = await read();
  assert.equal(cards[0].card.image, 'https://assets.tcgdex.net/en/base/base1/4/high.webp');
  assert.equal(cards[1].card.image, 'https://assets.tcgdex.net/ja/base/base1/4/high.webp');
  f.tables.tcg_cards[0].external_ids_json = { catalog: { image: 'https://images.pokemontcg.io/base1/4.png' } };
  cards = await read();
  assert.equal(cards[0].card.image, 'https://images.pokemontcg.io/base1/4.png');
  f.tables.tcg_cards[0].external_ids_json = {};
  f.tables.tcg_cards[0].image_languages_json = [];
  assert.equal((await read())[0].card.image, undefined);
});

test('unknown ids resolve through catalog canonical and alias ids; dex links name the species', () => {
  const f = fixture(0);
  f.tables.tcg_cards = [
    {
      id: 'synthetic-a',
      series_id: 'base',
      set_id: 'base1',
      local_id: '1',
      name_en: 'Synthetic',
      name_json: {},
      image_languages_json: [],
      external_ids_json: { catalog: { canonicalId: 'synthetic-canonical', aliasIds: ['synthetic-alias'] } },
    },
  ];
  f.tables.tcg_sets = [{ id: 'base1', name_en: 'Base Set' }];
  f.tables.tcg_card_dex_ids = [
    { card_id: 'synthetic-a', dex_id: 25 },
    { card_id: 'synthetic-a', dex_id: 6 },
  ];
  for (const id of ['synthetic-canonical', 'synthetic-alias', 'synthetic-a']) {
    const [entry] = buildInventoryCatalog(catalogRows(f.tables, [id]));
    assert.equal(entry.card.id, 'synthetic-a');
    assert.deepEqual(entry.pokemonIds, [6, 25]);
    assert.deepEqual(entry.speciesNames, ['Charizard', 'Pikachu']);
  }
  assert.deepEqual(buildInventoryCatalog(catalogRows(f.tables, ['synthetic-missing'])), []);
});
