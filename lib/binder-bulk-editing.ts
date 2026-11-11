import type { OperationIntentContext } from '@/lib/domain/audit-context';
import type { BinderSlot } from '@/lib/domain/binder-slots';
import type { InventoryCatalogResolver, InventorySnapshot } from '@/lib/domain/inventory';
import { SLOT_LIMITS, type SlotCommand } from '@/lib/domain/slot-commands';
import { parseSlotIntent, projectSlotIntent, sameValue } from '@/lib/collection/slot-optimistic';
import type { StagedSlotCommandIntent } from '@/lib/binder-slot-editing';

type Scope = StagedSlotCommandIntent['scope'];
export type BulkDestination = { kind: 'beginning' | 'end' } | { kind: 'before' | 'after'; slotId: string };
export type BulkLayoutAction =
  { kind: 'move'; destination: BulkDestination } | { kind: 'insert'; ids: string[]; destination: BulkDestination };
export interface BulkSelection {
  ownerUserId: string;
  collectionId: string;
  inventoryRevision: number;
  collectionVersion: number;
  layoutRevision: number;
  slots: Array<{
    slot: BinderSlot;
    item: InventorySnapshot['items'][number] | null;
    placement: InventorySnapshot['placements'][number] | null;
  }>;
}
function layout(snapshot: InventorySnapshot, scope: Scope) {
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId);
  const collection = snapshot.collections.find((c) => c.id === scope.collectionId);
  if (
    snapshot.ownerUserId !== scope.ownerUserId ||
    !binder ||
    !collection ||
    binder.ownerUserId !== scope.ownerUserId ||
    collection.ownerUserId !== scope.ownerUserId
  )
    throw new Error('layout-scope-changed');
  return { binder, collection };
}
/** Page is zero-based. Implicit final-page padding never becomes selectable. */
export function savedPageSlotIds(snapshot: InventorySnapshot, scope: Scope, page: number, rows: number, cols: number) {
  if (
    ![rows, cols].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 8) ||
    !Number.isSafeInteger(page) ||
    page < 0
  )
    throw new Error('invalid-grid');
  return layout(snapshot, scope)
    .binder.slots.slice(page * rows * cols, (page + 1) * rows * cols)
    .map((s) => s.id);
}
/** Keep evidence, not just IDs, so a partner's replacement cannot silently become selected. */
export function captureBulkSelection(snapshot: InventorySnapshot, scope: Scope, ids: readonly string[]): BulkSelection {
  const { binder, collection } = layout(snapshot, scope);
  if (ids.length > SLOT_LIMITS.affected) throw new Error('selection-limit');
  const slots = binder.slots.filter((s) => ids.includes(s.id));
  if (new Set(ids).size !== ids.length || slots.length !== ids.length) throw new Error('invalid-selection');
  return structuredClone({
    ownerUserId: scope.ownerUserId,
    collectionId: scope.collectionId,
    inventoryRevision: snapshot.inventoryRevision,
    collectionVersion: collection.version,
    layoutRevision: binder.layoutRevision,
    slots: slots.map((slot) => ({
      slot,
      item: snapshot.items.find((i) => i.id === slot.inventoryItemId) ?? null,
      placement: snapshot.placements.find((p) => p.inventoryItemId === slot.inventoryItemId) ?? null,
    })),
  });
}
export function bulkSelectionState(
  snapshot: InventorySnapshot,
  scope: Scope,
  selection: BulkSelection,
): 'current' | 'layout-changed' | 'selection-changed' {
  if (scope.ownerUserId !== selection.ownerUserId || scope.collectionId !== selection.collectionId)
    return 'selection-changed';
  const current = captureBulkSelection(snapshot, scope, []);
  const { binder } = layout(snapshot, scope);
  for (const evidence of selection.slots) {
    const slot = binder.slots.find((s) => s.id === evidence.slot.id);
    if (
      !slot ||
      !sameValue(slot, evidence.slot) ||
      !sameValue(snapshot.items.find((i) => i.id === slot.inventoryItemId) ?? null, evidence.item) ||
      !sameValue(
        snapshot.placements.find((p) => p.inventoryItemId === slot.inventoryItemId) ?? null,
        evidence.placement,
      )
    )
      return 'selection-changed';
  }
  return current.inventoryRevision === selection.inventoryRevision &&
    current.collectionVersion === selection.collectionVersion &&
    current.layoutRevision === selection.layoutRevision
    ? 'current'
    : 'layout-changed';
}
/** Exactly one bounded existing command. No splitting, rebasing, acceptance or remote execution here. */
export function prepareBulkLayoutIntent(
  snapshot: InventorySnapshot,
  scope: Scope,
  selection: BulkSelection,
  action: BulkLayoutAction,
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
) {
  const state = bulkSelectionState(snapshot, scope, selection);
  if (state !== 'current')
    throw new Error(state === 'selection-changed' ? 'selection-changed' : 'layout-review-required');
  const { binder, collection } = layout(snapshot, scope);
  const ids = selection.slots.map((s) => s.slot.id);
  if (action.kind === 'move' && !ids.length) throw new Error('selection-required');
  const destination = action.destination;
  const rest = action.kind === 'move' ? binder.slots.filter((s) => !ids.includes(s.id)) : binder.slots;
  let beforeSlotId: string | null;
  if ('slotId' in destination) {
    if (action.kind === 'move' && ids.includes(destination.slotId)) throw new Error('selected-anchor');
    const index = rest.findIndex((s) => s.id === destination.slotId);
    if (index < 0) throw new Error('invalid-anchor');
    beforeSlotId = destination.kind === 'before' ? destination.slotId : (rest[index + 1]?.id ?? null);
  } else beforeSlotId = destination.kind === 'beginning' ? (rest[0]?.id ?? null) : null;
  let command: SlotCommand;
  if (action.kind === 'insert') {
    if (!action.ids.length || action.ids.length > SLOT_LIMITS.inserted) throw new Error('insert-limit');
    if (binder.slots.length + action.ids.length > SLOT_LIMITS.capacity) throw new Error('layout-capacity');
    command = { kind: 'create', ids: action.ids, beforeSlotId };
  } else
    command = {
      kind: 'move',
      beforeSlotId,
      slots: selection.slots.map(({ slot, item, placement }) => ({
        id: slot.id,
        version: slot.version,
        inventoryItemId: slot.inventoryItemId,
        itemVersion: item?.version ?? null,
        placementVersion: placement?.version ?? null,
      })),
    };
  const intent = parseSlotIntent({
    kind: 'slots',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collectionId: scope.collectionId,
      collectionVersion: collection.version,
      layoutRevision: binder.layoutRevision,
      commands: [command],
    },
  });
  return { scope: { ...scope, slotId: null }, intent, preview: projectSlotIntent(snapshot, intent, catalog) };
}
