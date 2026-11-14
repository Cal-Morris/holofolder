import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImport, importCatalog, type ImportCopy } from '@/lib/collection/import-plan';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import { normalizeInventorySnapshot, type InventorySnapshot } from '@/lib/domain/inventory';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

// Synthetic snapshot: one binder with a Charizard (Pokémon #6) pocket that also wants the holo 151 Charizard ex, and a
// Pikachu pocket that already holds a copy.
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const BINDER = '00000000-0000-4000-8000-0000000000b1';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function snapshot(): InventorySnapshot {
  const slot = (n: number, pokemonId: number, inventoryItemId: string | null, wantedCards: unknown[] = []) => ({
    id: `slot-${n}`,
    ownerUserId: OWNER,
    collectionId: BINDER,
    target: { kind: 'pokemon', pokemonId },
    inventoryItemId,
    wantedCards,
    status: inventoryItemId ? 'collected' : null,
    version: 1,
    presetOrigin: null,
  });
  return normalizeInventorySnapshot({
    ownerUserId: OWNER,
    inventoryRevision: 4,
    items: [
      {
        id: 'held',
        ownerUserId: OWNER,
        identity: { kind: 'card', cardId: 'synthetic-pikachu', language: 'en', finish: 'normal' },
        grading: null,
        acquiredAt: null,
        version: 1,
      },
    ],
    placements: [{ inventoryItemId: 'held', collectionId: BINDER, slotId: 'slot-2', version: 1 }],
    collections: [
      { id: BINDER, ownerUserId: OWNER, name: 'Dex', kind: 'binder', defaultPresentation: 'binder', version: 2 },
    ],
    binders: [
      {
        ownerUserId: OWNER,
        collectionId: BINDER,
        layoutRevision: 1,
        presetManifest: null,
        slots: [
          slot(1, 6, null, [
            {
              card_id: 'synthetic-charizard-ex',
              card_name: 'Charizard ex',
              card_language: 'en',
              card_finish: 'double_rare',
              added_at: '2026-11-01T00:00:00.000Z',
            },
          ]),
          slot(2, 25, 'held'),
        ],
      },
    ],
  })!;
}
const card = (id: string, dexIds: number[]): SearchCardResult => ({
  id,
  name: id,
  localId: '1',
  language: 'en',
  set: { id: 'synthetic-set', name: 'Synthetic' },
  dexIds,
});
const copy = (id: string, dexIds: number[], extra: Partial<ImportCopy> = {}): ImportCopy => ({
  card: card(id, dexIds),
  language: 'en',
  finish: 'double_rare',
  grading: null,
  ...extra,
});
let op = 0;
const context = () => ({
  source: 'app' as const,
  clientId: null,
  operationId: uuid(900 + ++op),
  batchId: null,
  clientOccurredAt: null,
});
const ids = () => {
  let n = 0;
  return () => uuid(++n);
};

test('fills the pocket made for a card (and its want), appends new cards, keeps duplicates and slabs out of pockets', () => {
  const copies = [
    copy('synthetic-charizard-ex', [6]),
    copy('synthetic-charizard-ex', [6]),
    copy('synthetic-pikachu', [25], { finish: 'normal' }),
    copy('synthetic-mew', [151], {
      grading: {
        provider: { kind: 'known', id: 'psa' },
        grade: '10',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: null,
        holder: null,
        label: { variant: null, assetIds: [] },
      },
    }),
    copy('synthetic-trainer', []),
  ];
  const plan = planImport({ snapshot: snapshot(), collectionId: BINDER, copies, context, newId: ids() });
  assert.deepEqual([plan.filled, plan.appended, plan.unplaced], [1, 1, 3]);
  assert.equal(plan.intents.length, 1);
  const commands = plan.intents[0].request.commands;
  assert.deepEqual(
    commands.map((c) => c.kind),
    ['assign', 'add', 'add', 'add', 'insertAssign'],
  );
  const assign = commands[0];
  assert.ok(assign.kind === 'assign' && assign.fulfillWant?.index === 0 && assign.destination.slot.id === 'slot-1');
  const after = projectSlotIntent(snapshot(), plan.intents[0], importCatalog(copies));
  assert.equal(after.items.length, 6);
  assert.equal(after.binders[0].slots.length, 3);
  assert.equal(after.binders[0].slots[0].wantedCards.length, 0);
});

test('large imports become several intents, each planned on the one before', () => {
  const copies = Array.from({ length: 120 }, (_, n) => copy(`synthetic-card-${n}`, []));
  const plan = planImport({ snapshot: snapshot(), collectionId: BINDER, copies, context, newId: ids() });
  assert.equal(plan.intents.length, 3);
  assert.equal(plan.appended, 120);
  let state = snapshot();
  for (const intent of plan.intents) {
    assert.equal(intent.request.inventoryRevision, state.inventoryRevision);
    state = projectSlotIntent(state, intent, importCatalog(copies));
  }
  assert.equal(state.binders[0].slots.length, 122);
});
