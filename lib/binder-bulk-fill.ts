import type { OperationIntentContext } from '@/lib/domain/audit-context';
import { matchesSlotTarget, type BinderSlot, type BinderSnapshot } from '@/lib/domain/binder-slots';
import { inventoryItemCandidate, type InventoryCatalogResolver, type InventorySnapshot } from '@/lib/domain/inventory';
import { INVENTORY_LIMITS, type InventoryCommand } from '@/lib/domain/inventory-commands';
import { bulkSelectionState, type BulkSelection } from '@/lib/binder-bulk-editing';
import { parseSlotIntent, projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { StagedSlotCommandIntent } from '@/lib/binder-slot-editing';

type Scope = StagedSlotCommandIntent['scope'];
export type BulkFillChoices = Record<string, string | null>;
const smaller =
  'Choose a smaller selection, at most 100 copies within the command, work and byte limits. Nothing was saved.';

/** Only copied preset entries identify deliberate spacers. Plain empty free pockets remain explicit manual destinations. */
export function isFillSpacer(binder: BinderSnapshot, slot: BinderSlot) {
  const origin = slot.presetOrigin,
    manifest = binder.presetManifest;
  return Boolean(
    slot.target === null &&
    origin &&
    manifest &&
    origin.source.id === manifest.source.id &&
    origin.source.version === manifest.source.version &&
    manifest.entries.some((e) => e.id === origin.entryId && e.target === null),
  );
}
function copyReason(snapshot: InventorySnapshot, slot: BinderSlot, itemId: string, catalog: InventoryCatalogResolver) {
  const item = snapshot.items.find((i) => i.id === itemId && i.ownerUserId === snapshot.ownerUserId);
  if (!item) return 'Copy unavailable. Choose a recorded copy.';
  if (snapshot.placements.some((p) => p.inventoryItemId === item.id))
    return 'Copy already assigned. Its location is preserved.';
  if (slot.target) {
    const candidate = inventoryItemCandidate(item, catalog);
    if (!candidate) return 'Unresolved catalog identity. Cannot verify this target.';
    if (!matchesSlotTarget(candidate, slot.target)) return 'Target mismatch, including recorded language or finish.';
  }
  return null;
}
/** Read-only composition of existing assignment contracts. Every selected destination stays visible, including refusals/skips. */
export function previewBulkFill(
  snapshot: InventorySnapshot,
  scope: Scope,
  selection: BulkSelection,
  choices: BulkFillChoices,
  catalog: InventoryCatalogResolver,
) {
  const state = bulkSelectionState(snapshot, scope, selection);
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId)!;
  const rows = selection.slots.map(({ slot }) => {
    const itemId = choices[slot.id] ?? null,
      skipped = choices[slot.id] === null;
    const reason = isFillSpacer(binder, slot)
      ? 'Spacer preserved.'
      : slot.inventoryItemId
        ? 'Occupied destination preserved.'
        : !itemId
          ? 'Choose an actual Unassigned copy, or explicitly skip this destination.'
          : Object.values(choices).filter((id) => id === itemId).length > 1
            ? 'Copy selected more than once. Each copy can fill one pocket.'
            : copyReason(snapshot, slot, itemId, catalog);
    return { slotId: slot.id, position: binder.slots.findIndex((s) => s.id === slot.id) + 1, itemId, skipped, reason };
  });
  const assignments = rows.filter((r) => !r.skipped && !r.reason);
  const error =
    state !== 'current'
      ? 'Storage changed. Close and review a fresh selection before filling.'
      : assignments.length > INVENTORY_LIMITS.commands || assignments.length * 2 > INVENTORY_LIMITS.affected
        ? smaller
        : null;
  return { rows, error, ready: !error && assignments.length > 0 && rows.every((r) => r.skipped || !r.reason) };
}
/** Opt-in proposals only, stable copy IDs, no catalog-based creation and no free-pocket guesses. */
export function automaticBulkFillChoices(
  snapshot: InventorySnapshot,
  scope: Scope,
  selection: BulkSelection,
  catalog: InventoryCatalogResolver,
): BulkFillChoices {
  const choices: BulkFillChoices = {},
    used = new Set<string>();
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId)!;
  const items = snapshot.items.toSorted((a, b) => a.id.localeCompare(b.id));
  for (const { slot } of selection.slots) {
    if (slot.inventoryItemId || isFillSpacer(binder, slot)) {
      choices[slot.id] = null;
      continue;
    }
    if (!slot.target) continue;
    const item = items.find((i) => !used.has(i.id) && !copyReason(snapshot, slot, i.id, catalog));
    choices[slot.id] = item?.id ?? null;
    if (item) used.add(item.id);
  }
  return choices;
}
/** One parsed existing inventory batch and canonical projection, no alternative execution/queue/planning model. */
export function prepareBulkFillIntent(
  snapshot: InventorySnapshot,
  scope: Scope,
  selection: BulkSelection,
  choices: BulkFillChoices,
  context: OperationIntentContext,
  catalog: InventoryCatalogResolver,
): StagedSlotCommandIntent {
  const preview = previewBulkFill(snapshot, scope, selection, choices, catalog);
  if (!preview.ready) throw new Error(preview.error ?? 'Review all copy and destination choices before filling.');
  const collection = snapshot.collections.find((c) => c.id === scope.collectionId)!;
  const binder = snapshot.binders.find((b) => b.collectionId === scope.collectionId)!;
  const commands: InventoryCommand[] = preview.rows
    .filter((r) => !r.skipped)
    .map((row) => {
      const slot = binder.slots.find((s) => s.id === row.slotId)!,
        item = snapshot.items.find((i) => i.id === row.itemId)!;
      return {
        kind: 'assign',
        selection: { kind: 'existing', inventoryItemId: item.id, itemVersion: item.version },
        destination: {
          collectionId: collection.id,
          slot: {
            id: slot.id,
            version: slot.version,
            inventoryItemId: null,
            itemVersion: null,
            placementVersion: null,
          },
        },
        occupied: 'cancel',
        fulfillWant: null,
      };
    });
  const intent = parseSlotIntent({
    kind: 'inventory',
    context,
    request: {
      operationId: context.operationId,
      inventoryRevision: snapshot.inventoryRevision,
      collections: [
        { collectionId: collection.id, version: collection.version, layoutRevision: binder.layoutRevision },
      ],
      commands,
    },
  });
  if (new TextEncoder().encode(JSON.stringify(intent)).length > INVENTORY_LIMITS.bytes) throw new Error(smaller);
  projectSlotIntent(snapshot, intent, catalog);
  return { scope: { ...scope, slotId: null }, intent };
}
