import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogRows, fixture, snapshotDocument } from './fixtures/inventory-read-server';
import { readOwnerInventoryState } from '../lib/server/inventory-read';
import {
  batchCatalogCardReads,
  inventoryCatalogCardIds,
  mergeCatalogRows,
  readCatalogCardRows,
} from '../lib/server/inventory-read-catalog';

// Synthetic mirror: direct ids, a canonical id two printings share, alias ids (one also a direct row's alias),
// unknown ids, several languages, a card with no translated names and dex links.
function syntheticCollection() {
  const f = fixture(4);
  const card = (id: string, set: string, names: Record<string, string>, catalog?: object) => ({
    id,
    series_id: 'synthetic-series',
    set_id: set,
    local_id: id.split('-')[1],
    name_en: names.en ?? `Synthetic ${id}`,
    name_json: names,
    image_languages_json: Object.keys(names),
    external_ids_json: catalog ? { catalog } : {},
  });
  f.tables.tcg_sets = [
    { id: 'syn1', name_en: 'Synthetic One' },
    { id: 'syn2', name_en: 'Synthetic Two' },
  ];
  f.tables.tcg_cards = [
    card('syn1-1', 'syn1', { en: 'Pikachu', fr: 'Pikachu', de: 'Pikachu', it: 'Pikachu' }),
    card('syn1-2', 'syn1', { en: 'Eevee', es: 'Eevee' }, { aliasIds: ['alias-x'] }),
    card('syn2-1', 'syn2', { en: 'Mew', ja: 'Mew' }, { canonicalId: 'canon-1' }),
    card('syn2-3', 'syn2', { en: 'Mew ex' }, { canonicalId: 'canon-1', aliasIds: ['alias-x'] }),
    card('syn2-2', 'syn2', {}, { aliasIds: ['alias-y'] }),
    card('syn2-9', 'syn2', { en: 'Unreferenced' }),
  ];
  f.tables.tcg_card_dex_ids = [
    { card_id: 'syn1-1', dex_id: 25 },
    { card_id: 'syn2-1', dex_id: 151 },
    { card_id: 'syn2-1', dex_id: 150 },
    { card_id: 'syn2-3', dex_id: 151 },
    { card_id: 'syn2-9', dex_id: 1 },
  ];
  const [, a, b, c] = f.tables.inventory_items;
  a.identity = { kind: 'card', cardId: 'syn1-1' };
  b.identity = { kind: 'card', cardId: 'canon-1' };
  c.identity = { kind: 'card', cardId: 'missing-1' };
  f.tables.binder_slots[0].target = { kind: 'card', cardId: 'alias-y' };
  const want = (id: string) => ({ card_id: id, card_name: 'Synthetic want', added_at: '2026-01-01T00:00:00Z' });
  f.tables.binder_slots[1].wanted_cards = [want('syn1-2'), want('alias-x'), want('missing-2')];
  return f;
}

test('the cached catalog path returns the same navigation catalog as inventory_read_v2', async () => {
  const before = await readOwnerInventoryState(syntheticCollection().client);
  const f = syntheticCollection();
  f.catalogFromCache();
  // One batched reader with a per-id result, as the shared cache stores it.
  const readCard = batchCatalogCardReads(f.client, 0);
  let asked: readonly string[] = [];
  const after = await readOwnerInventoryState(f.client, async (ids) => {
    asked = ids;
    return mergeCatalogRows(await Promise.all(ids.map(readCard)));
  });
  assert.deepEqual([...asked].sort(), ['alias-x', 'alias-y', 'canon-1', 'missing-1', 'missing-2', 'syn1-1', 'syn1-2']);
  assert.ok(before.navigation.catalog.length > 0);
  assert.deepEqual(after.navigation.catalog, before.navigation.catalog);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.deepEqual(after.evidence, before.evidence);
  assert.equal(f.requests.filter((r) => r.table === 'inventory_read_v2').length, 0);
  // Every id in one batch: direct, canonical, one alias read per miss, dex and sets.
  assert.equal(f.requests.filter((r) => r.table.startsWith('tcg_')).length, 3 + 4 + 2);
});

test('each card id resolves alone to its share of the snapshot catalog', async () => {
  const f = syntheticCollection();
  const ids = inventoryCatalogCardIds(snapshotDocument(f.tables, f.tables.binders[0].owner_user_id as string, 'slots'));
  const perId = await readCatalogCardRows(f.client, ids);
  for (const id of ids) {
    const alone = await readCatalogCardRows(f.client, [id]);
    assert.deepEqual(alone.get(id), catalogRows(f.tables, [id]), id);
    assert.deepEqual(perId.get(id), alone.get(id), id);
  }
  assert.deepEqual(mergeCatalogRows([...perId.values()]), catalogRows(f.tables, ids));
  assert.deepEqual(perId.get('missing-1'), { cards: [], dex: [], sets: [] });
});

test('a failed mirror read makes the inventory unavailable, not partial', async () => {
  const f = syntheticCollection();
  f.catalogFromCache();
  await assert.rejects(
    readOwnerInventoryState(f.client, async () => {
      throw new Error('synthetic cache failure');
    }),
    { code: 'inventory_read_unavailable' },
  );
});
