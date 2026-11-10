import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import { SLOT_LIMITS, type SlotCommand } from '@/lib/domain/slot-commands';
import { parseSlotIntent, projectSlotIntent, type SlotOfflineIntent } from '@/lib/collection/slot-optimistic';

/** Shared private draft sink for picker and layout preparation, not a transport or acceptance receipt. */
export interface StagedSlotCommandIntent {
  /** Normalized selected printing facts, never a resolver or remote authority. */
  localCatalog?: readonly import('@/lib/domain/inventory-browse').InventoryCatalogEvidence[];
  scope: { ownerUserId: string; collectionId: string; slotId: string | null };
  intent: Exclude<SlotOfflineIntent, { kind: 'creation' | 'raw-restore' }>;
}
/** Resolves at local transaction commit, never at remote execution or audit success. */
export interface SlotLocalAcceptance {
  status: 'saved-on-device';
  operationId: string;
  refreshError: string | null;
}
/** `selected` is the picker's evidence for a printing it just chose, which the host read catalog may not hold yet. */
/** `picked` is the chosen card as the picker showed it, so the pocket keeps its name and artwork until the next read has it. */
export type SlotCommandSink = (
  draft: StagedSlotCommandIntent,
  selected?: InventoryCatalogResolver,
  picked?: InventoryCatalogEvidence,
) => void | Promise<SlotLocalAcceptance>;

export type LayoutDestination = { kind: 'position'; position: number } | { kind: 'before' | 'after'; slotId: string };
export type LayoutAction =
  | { kind: 'append'; newSlotId: string }
  | { kind: 'insert'; anchorId: string; side: 'before' | 'after'; newSlotId: string }
  | { kind: 'move'; destination: LayoutDestination };

/** Resolve anchors in the complete saved layout. The caller must guard the deliberate edit session. */
export function prepareLayoutIntent(
  snapshot: InventorySnapshot,
  scope: StagedSlotCommandIntent['scope'],
  action: LayoutAction,
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
) {
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId);
  const collection = snapshot.collections.find((c) => c.id === scope.collectionId);
  const slot = binder?.slots.find((s) => s.id === scope.slotId);
  if (
    snapshot.ownerUserId !== scope.ownerUserId ||
    !binder ||
    !collection ||
    binder.ownerUserId !== scope.ownerUserId ||
    (scope.slotId !== null && !slot)
  )
    throw new Error('layout-scope-changed');
  const anchor = (id: string, side: 'before' | 'after') => {
    const index = binder.slots.findIndex((s) => s.id === id);
    if (index < 0) throw new Error('invalid-anchor');
    return side === 'before' ? id : (binder.slots[index + 1]?.id ?? null);
  };
  let command: SlotCommand;
  if (action.kind === 'append' || action.kind === 'insert') {
    if (binder.slots.length >= SLOT_LIMITS.capacity) throw new Error('layout-capacity');
    command = {
      kind: 'create',
      ids: [action.newSlotId],
      beforeSlotId: action.kind === 'append' ? null : anchor(action.anchorId, action.side),
    };
  } else {
    if (!slot) throw new Error('layout-selection-required');
    const destination = action.destination;
    let beforeSlotId: string | null;
    if (destination.kind === 'position') {
      if (
        !Number.isSafeInteger(destination.position) ||
        destination.position < 1 ||
        destination.position > binder.slots.length
      )
        throw new Error('invalid-position');
      const rest = binder.slots.filter((s) => s.id !== slot.id);
      beforeSlotId = rest[destination.position - 1]?.id ?? null;
    } else {
      if (destination.slotId === slot.id) throw new Error('invalid-anchor');
      beforeSlotId = anchor(destination.slotId, destination.kind);
      // Moving to just after the preceding slot is a no-op, not a self anchor.
      if (beforeSlotId === slot.id) beforeSlotId = binder.slots[binder.slots.indexOf(slot) + 1]?.id ?? null;
    }
    const item = snapshot.items.find((i) => i.id === slot.inventoryItemId);
    const placement = snapshot.placements.find((p) => p.inventoryItemId === slot.inventoryItemId);
    command = {
      kind: 'move',
      slots: [
        {
          id: slot.id,
          version: slot.version,
          inventoryItemId: slot.inventoryItemId,
          itemVersion: item?.version ?? null,
          placementVersion: placement?.version ?? null,
        },
      ],
      beforeSlotId,
    };
  }
  const intent = parseSlotIntent({
    kind: 'slots',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collectionId: collection.id,
      collectionVersion: collection.version,
      layoutRevision: binder.layoutRevision,
      commands: [command],
    },
  });
  return { scope: { ...scope }, intent, preview: projectSlotIntent(snapshot, intent, catalog) };
}
