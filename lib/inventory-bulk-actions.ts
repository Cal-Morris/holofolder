import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';
import { INVENTORY_LIMITS } from '@/lib/domain/inventory-commands';
import { inventoryActionDestinations, prepareInventoryAction } from '@/lib/inventory-actions';
import { parseSlotIntent, projectSlotIntent } from '@/lib/collection/slot-optimistic';

export type InventoryBulkAction =
  | { kind: 'unassign'; itemIds: readonly string[] }
  | { kind: 'move'; mapping: readonly { itemId: string; collectionId: string; slotId: string }[] };

/** One bounded request from one base, never a sequence of per-copy writes. */
export function prepareInventoryBulkAction(
  snapshot: InventorySnapshot,
  action: InventoryBulkAction,
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
) {
  const ids = action.kind === 'unassign' ? action.itemIds : action.mapping.map((m) => m.itemId);
  if (!ids.length || ids.length > INVENTORY_LIMITS.commands || new Set(ids).size !== ids.length)
    throw new Error('distinct-bounded-selection-required');
  // Bulk review remains raw-only; graded copies use the individual exact-copy review.
  if (ids.some((id) => snapshot.items.find((i) => i.id === id)?.grading !== null)) throw new Error('raw-copy-required');
  const destinations = new Set<string>();
  const plans = ids.map((itemId, index) => {
    if (action.kind === 'unassign')
      return prepareInventoryAction(snapshot, { kind: 'unassign', itemId }, context, catalog);
    const mapping = action.mapping[index];
    const key = JSON.stringify([mapping.collectionId, mapping.slotId]);
    if (
      destinations.has(key) ||
      !inventoryActionDestinations(snapshot, itemId, catalog).some(
        (d) =>
          d.collectionId === mapping.collectionId && d.slot.id === mapping.slotId && d.slot.inventoryItemId === null,
      )
    )
      throw new Error('distinct-empty-destination-required');
    destinations.add(key);
    return prepareInventoryAction(snapshot, { kind: 'place', ...mapping }, context, catalog);
  });
  const collections = [
    ...new Map(plans.flatMap((p) => p.intent.request.collections.map((c) => [c.collectionId, c] as const))).values(),
  ];
  // The existing parser enforces command, work, collection and byte budgets for the whole selection.
  const intent = parseSlotIntent({
    kind: 'inventory',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collections,
      commands: plans.flatMap((p) => p.intent.request.commands),
    },
  });
  return { intent, preview: projectSlotIntent(snapshot, intent, catalog), before: structuredClone(snapshot) };
}
