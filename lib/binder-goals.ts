import { getBinderCompletion, type BinderSnapshot } from '@/lib/domain/binder-slots';
import {
  getInventoryCounts,
  inventoryItemCandidate,
  type InventorySnapshot,
  type InventoryCatalogResolver,
} from '@/lib/domain/inventory';

/** Presentation of current targets, using the canonical matcher and primary placements only. */
export function getBinderGoalPresentation(
  inventory: InventorySnapshot,
  binder: BinderSnapshot,
  catalog: InventoryCatalogResolver,
) {
  const items = new Map(
    inventory.items
      .filter((i) => i.ownerUserId === binder.ownerUserId && i.ownerUserId === inventory.ownerUserId)
      .map((i) => [i.id, i]),
  );
  const placed = new Set(
    inventory.placements
      .filter(
        (p) =>
          p.collectionId === binder.collectionId &&
          binder.slots.some((s) => s.id === p.slotId && s.inventoryItemId === p.inventoryItemId),
      )
      .map((p) => p.inventoryItemId),
  );
  const resolve = (id: string) => {
    const item = placed.has(id) ? items.get(id) : undefined;
    return item ? inventoryItemCandidate(item, catalog) : undefined;
  };
  const completion = getBinderCompletion(binder, resolve);
  const assigned = new Set(
    binder.slots.flatMap((s) =>
      s.inventoryItemId && placed.has(s.inventoryItemId) && items.has(s.inventoryItemId) ? [s.inventoryItemId] : [],
    ),
  );
  const unknownTargetCount = binder.slots.filter(
    (s) => s.target !== null && s.inventoryItemId && assigned.has(s.inventoryItemId) && !resolve(s.inventoryItemId),
  ).length;
  const freeSlots = binder.slots.filter((s) => s.target === null);
  return {
    ...completion,
    percentage: completion.targetCount
      ? Math.floor((100 * completion.completedTargetCount) / completion.targetCount)
      : null,
    unknownTargetCount,
    assignedCount: assigned.size,
    freeSlotCount: freeSlots.length,
    filledFreeSlotCount: freeSlots.filter((s) => s.inventoryItemId && assigned.has(s.inventoryItemId)).length,
    speciesTargetCount: new Set(binder.slots.flatMap((s) => (s.target?.kind === 'pokemon' ? [s.target.pokemonId] : [])))
      .size,
    ownerCounts: getInventoryCounts(inventory),
  };
}
