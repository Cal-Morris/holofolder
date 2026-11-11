import { emptyGradingRecord } from '@/lib/grading/draft';

/** Synthetic mixed removal, real host/HTTP/IDB. No SQL or hosted authority claim. */
export function seedSlotRemoval(tables: Record<string, Record<string, unknown>[]>, owner: string) {
  const collection = String(tables.binders[0].id);
  const source = { id: 'synthetic-original-goals', version: 'original-v1' };
  tables.storage_collection_state[0].preset_manifest = {
    source,
    name: 'Synthetic original goals',
    entries: [
      { id: 'original-snorlax', target: { kind: 'pokemon', pokemonId: 143 } },
      { id: 'original-pikachu', target: { kind: 'pokemon', pokemonId: 25 } },
    ],
  };
  tables.tcg_sets = [{ id: 'synthetic', name_en: 'Synthetic removal set' }];
  tables.tcg_cards = [
    {
      id: 'synthetic-duplicate',
      set_id: 'synthetic',
      local_id: '1',
      name_en: 'Synthetic duplicate',
      name_json: { en: 'Synthetic duplicate' },
      external_ids_json: {},
    },
  ];
  tables.tcg_card_dex_ids = [{ card_id: 'synthetic-duplicate', dex_id: 143 }];
  tables.inventory_items = Array.from({ length: 4 }, (_, n) => ({
    id: `synthetic-retained-${n}`,
    owner_user_id: owner,
    identity: n === 3 ? { kind: 'pokemon', pokemonId: 143 } : { kind: 'card', cardId: 'synthetic-duplicate' },
    grading:
      n === 2
        ? {
            ...emptyGradingRecord(),
            grade: '9',
            certificate: '000-synthetic-private',
            label: { variant: 'Synthetic private label', assetIds: ['synthetic-private-asset'] },
          }
        : null,
    acquired_at: '2026-01-02T00:00:00Z',
    version: 2,
    legacy_source: { original: ['00007', null, { retained: true }] },
  }));
  tables.binder_slots.push({ ...tables.binder_slots[0], id: 'synthetic-slot-4', position: 4 });
  tables.binder_slots[0].target = { kind: 'pokemon', pokemonId: 143 };
  tables.binder_slots[0].preset_origin = { source, entryId: 'original-snorlax' };
  tables.binder_slots[4].target = { kind: 'pokemon', pokemonId: 25 };
  tables.binder_slots[4].preset_origin = { source, entryId: 'original-pikachu' };
  for (const n of [0, 4])
    tables.binder_slots[n].wanted_cards = [
      { card_id: 'synthetic-want', card_name: 'Synthetic explicit want', added_at: '2026-01-01T00:00:00Z' },
    ];
  tables.inventory_placements = tables.inventory_items.map((item, n) => ({
    inventory_item_id: item.id,
    owner_user_id: owner,
    collection_id: collection,
    slot_id: `synthetic-slot-${n}`,
    version: 3,
  }));
  for (const slot of tables.binder_slots.slice(0, 4)) slot.status = 'collected';
}

/** 129 occupied slots exceed the unchanged ordinary 256-work-unit removal budget. */
export function seedSlotRemovalBound(tables: Record<string, Record<string, unknown>[]>, owner: string) {
  const item = tables.inventory_items[0],
    slot = tables.binder_slots[1],
    placement = tables.inventory_placements[0];
  tables.inventory_items = Array.from({ length: 129 }, (_, n) => ({ ...item, id: `synthetic-bound-copy-${n}` }));
  tables.binder_slots = Array.from({ length: 129 }, (_, n) => ({
    ...slot,
    id: `synthetic-bound-slot-${n}`,
    position: n,
  }));
  tables.inventory_placements = tables.inventory_items.map((i, n) => ({
    ...placement,
    owner_user_id: owner,
    inventory_item_id: i.id,
    slot_id: tables.binder_slots[n].id,
  }));
  tables.binders[0].binder_rows = 8;
  tables.binders[0].binder_cols = 8;
}
