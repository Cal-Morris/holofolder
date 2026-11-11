import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { InventoryItemRef } from '@/lib/domain/inventory-commands';
import type { OperationIntentContext } from '@/lib/domain/audit-context';
import { parseSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';
import { gradingEditCommand, type GradingEditCommand } from './draft';

/** Capture the original complete private copy and every placement/collection predicate. */
export function inventoryGradingReference(snapshot: InventorySnapshot, itemId: string): InventoryItemRef {
  const item = snapshot.items.find((i) => i.id === itemId && i.ownerUserId === snapshot.ownerUserId);
  if (!item || item.identity.kind !== 'card') throw new Error('grading-copy-unavailable');
  const placement = snapshot.placements.find((p) => p.inventoryItemId === itemId);
  if (!placement) return { itemId, itemVersion: item.version, placement: null };
  const slot = snapshot.binders
    .find((b) => b.collectionId === placement.collectionId)
    ?.slots.find((s) => s.id === placement.slotId);
  if (!slot || slot.inventoryItemId !== itemId) throw new Error('grading-placement-unavailable');
  return {
    itemId,
    itemVersion: item.version,
    placement: {
      collectionId: placement.collectionId,
      slot: {
        id: slot.id,
        version: slot.version,
        inventoryItemId: itemId,
        itemVersion: item.version,
        placementVersion: placement.version,
      },
    },
  };
}

/** Full first-party edit, never rebuild private grading from a developer/browse DTO. */
export function prepareInventoryGradingIntent(
  snapshot: InventorySnapshot,
  command: GradingEditCommand,
  context: OperationIntentContext,
): SlotOfflineIntent {
  const item = snapshot.items.find((i) => i.id === command.item.itemId);
  const original = inventoryGradingReference(snapshot, command.item.itemId);
  if (!item || JSON.stringify(command.item) !== JSON.stringify(original)) throw new Error('grading-copy-changed');
  const collectionId = original.placement?.collectionId;
  const collection = snapshot.collections.find((c) => c.id === collectionId);
  const binder = snapshot.binders.find((b) => b.collectionId === collectionId);
  if (collectionId && (!collection || !binder)) throw new Error('grading-placement-unavailable');
  return parseSlotIntent({
    kind: 'inventory',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collections:
        collection && binder
          ? [{ collectionId: collection.id, version: collection.version, layoutRevision: binder.layoutRevision }]
          : [],
      commands: [gradingEditCommand(item, original, command.grading)],
    },
  });
}
