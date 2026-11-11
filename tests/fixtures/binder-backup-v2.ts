import type { InventorySnapshot } from '@/lib/domain/inventory';

// Synthetic identities and catalog cards only.
export function snapshot(): InventorySnapshot {
  const collectionId = '11111111-1111-4111-8111-111111111111';
  return {
    ownerUserId: 'synthetic-owner',
    inventoryRevision: 8,
    collections: [
      {
        id: collectionId,
        ownerUserId: 'synthetic-owner',
        name: 'Synthetic',
        kind: 'binder',
        defaultPresentation: 'binder',
        version: 2,
      },
    ],
    binders: [
      {
        collectionId,
        ownerUserId: 'synthetic-owner',
        layoutRevision: 3,
        presetManifest: {
          source: { id: 'synthetic-dex', version: '1' },
          name: 'Synthetic Dex',
          entries: Array.from({ length: 1025 }, (_, i) => ({
            id: `entry-${i}`,
            target: { kind: 'pokemon' as const, pokemonId: i + 1 },
          })),
        },
        slots: Array.from({ length: 1028 }, (_, i) => ({
          id: `slot-${i}`,
          collectionId,
          ownerUserId: 'synthetic-owner',
          target:
            i < 1025
              ? { kind: 'pokemon' as const, pokemonId: i + 1 }
              : i === 1026
                ? { kind: 'pokemon' as const, pokemonId: 1 }
                : i === 1027
                  ? { kind: 'card' as const, cardId: 'synthetic-trainer' }
                  : null,
          inventoryItemId: i < 2 ? `item-${i}` : null,
          status: i < 2 ? ('collected' as const) : null,
          wantedCards:
            i === 3
              ? [
                  {
                    card_id: 'synthetic-trainer',
                    card_name: 'Synthetic Trainer',
                    added_at: '2026-01-01T00:00:00Z',
                    card_language: 'en' as const,
                  },
                ]
              : [],
          version: 4,
          presetOrigin: i < 1025 ? { source: { id: 'synthetic-dex', version: '1' }, entryId: `entry-${i}` } : null,
        })),
      },
    ],
    items: Array.from({ length: 4 }, (_, i) => ({
      id: `item-${i}`,
      ownerUserId: 'synthetic-owner',
      identity: {
        kind: 'card' as const,
        cardId: i < 2 ? 'synthetic-pokemon' : 'synthetic-trainer',
        language: 'en' as const,
        finish: 'normal' as const,
      },
      version: 1,
      acquiredAt: null,
      grading:
        i === 3
          ? {
              provider: { kind: 'known' as const, id: 'psa' as const },
              grade: '9',
              scale: null,
              designation: null,
              subgrades: [],
              certificate: '0000123',
              holder: null,
              label: { variant: null, assetIds: [] },
            }
          : null,
    })),
    placements: [0, 1].map((i) => ({ inventoryItemId: `item-${i}`, collectionId, slotId: `slot-${i}`, version: 2 })),
  };
}
