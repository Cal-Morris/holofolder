import type { BinderSnapshot } from '@/lib/domain/binder-slots';
import type { InventorySnapshot } from '@/lib/domain/inventory';

/** Entirely synthetic contract fixtures, never customer cards or certificates. */
export function syntheticSlotDisplaySnapshot(empty = false) {
  const binder: BinderSnapshot = {
    ownerUserId: 'synthetic-owner',
    collectionId: 'synthetic-binder',
    layoutRevision: 1,
    presetManifest: null,
    slots: [],
  };
  const targets = [
    { kind: 'pokemon', pokemonId: 143 },
    { kind: 'pokemon', pokemonId: 143 },
    null,
    null,
    { kind: 'pokemon', pokemonId: 143 },
    { kind: 'card', cardId: 'synthetic-trainer' },
    null,
  ] as const;
  binder.slots = empty
    ? []
    : targets.map((target, index) => ({
        id: `slot-${String.fromCharCode(97 + index)}`,
        ownerUserId: binder.ownerUserId,
        collectionId: binder.collectionId,
        target,
        inventoryItemId: index < 4 ? `item-${String.fromCharCode(97 + index)}` : null,
        wantedCards: [],
        status: index < 4 ? 'collected' : null,
        version: 1,
        presetOrigin: null,
      }));
  const inventory: InventorySnapshot = {
    ownerUserId: binder.ownerUserId,
    inventoryRevision: 1,
    collections: [
      {
        id: binder.collectionId,
        ownerUserId: binder.ownerUserId,
        name: 'Synthetic binder',
        kind: 'binder',
        defaultPresentation: 'binder',
        version: 1,
      },
    ],
    binders: [binder],
    items: empty
      ? []
      : ['synthetic-snorlax-a', 'synthetic-snorlax-b', 'synthetic-trainer', 'synthetic-energy'].map(
          (cardId, index) => ({
            id: `item-${String.fromCharCode(97 + index)}`,
            ownerUserId: binder.ownerUserId,
            identity: { kind: 'card', cardId, language: 'en', finish: 'normal' },
            grading:
              index === 1
                ? {
                    provider: { kind: 'known', id: 'psa' },
                    grade: '9',
                    scale: null,
                    designation: null,
                    subgrades: [],
                    certificate: null,
                    holder: null,
                    label: { variant: null, assetIds: [] },
                  }
                : null,
            acquiredAt: null,
            version: 1,
          }),
        ),
    placements: binder.slots.flatMap((s) =>
      s.inventoryItemId
        ? [{ inventoryItemId: s.inventoryItemId, collectionId: binder.collectionId, slotId: s.id, version: 1 }]
        : [],
    ),
  };
  const catalog: Record<string, { name: string; image?: string }> = Object.fromEntries(
    ['Snorlax A', 'Snorlax B', 'Trainer', 'Energy'].map((name, index) => [
      inventory.items[index]?.identity.kind === 'card' ? inventory.items[index].identity.cardId : '',
      { name, image: `https://assets.tcgdex.net/en/synthetic/display/${index}/high.webp` },
    ]),
  );
  return { binder, inventory, catalog };
}
