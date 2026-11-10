import type { OperationIntentContext } from "@/lib/domain/audit-context"
import type { InventorySnapshot } from "@/lib/domain/inventory"
import { INVENTORY_LIMITS } from "@/lib/domain/inventory-commands"
import { bulkSelectionState, type BulkSelection } from "@/lib/binder-bulk-editing"
import type { StagedSlotCommandIntent } from "@/lib/binder-slot-editing"
import { parseSlotIntent, projectSlotIntent } from "@/lib/collection/slot-optimistic"

/** One reviewed removeSlots request. Ownership and original preset provenance survive. */
export function prepareSlotRemoval(snapshot: InventorySnapshot, scope: StagedSlotCommandIntent["scope"], selection: BulkSelection, context: OperationIntentContext) {
  if (bulkSelectionState(snapshot, scope, selection) !== "current" || !selection.slots.length
    || (scope.slotId !== null && (selection.slots.length !== 1 || selection.slots[0].slot.id !== scope.slotId))) throw new Error("removal-review-required")
  const work = selection.slots.length + selection.slots.filter(s => s.item).length
  if (work > INVENTORY_LIMITS.affected) throw new Error("removal-work-bound")
  const binder = snapshot.binders.find(b => b.collectionId === scope.collectionId)!
  const rows = selection.slots.map(evidence => ({ ...evidence, position: binder.slots.findIndex(s => s.id === evidence.slot.id) + 1 }))
  const intent = parseSlotIntent({ kind: "inventory", context, request: {
    operationId: context.operationId, inventoryRevision: selection.inventoryRevision,
    collections: [{ collectionId: scope.collectionId, version: selection.collectionVersion, layoutRevision: selection.layoutRevision }],
    commands: [{ kind: "removeSlots", slots: rows.map(({ slot, item, placement }) => ({ collectionId: scope.collectionId,
      slot: { id: slot.id, version: slot.version, inventoryItemId: slot.inventoryItemId, itemVersion: item?.version ?? null, placementVersion: placement?.version ?? null } })) }],
  } })
  // Removal does not need catalog guesses, including for unknown or graded owned copies.
  const preview = projectSlotIntent(snapshot, intent, () => undefined)
  return { scope: { ...scope }, intent, preview, rows: structuredClone(rows), counts: {
    slots: rows.length, targets: rows.filter(r => r.slot.target).length,
    wants: rows.reduce((n, r) => n + r.slot.wantedCards.length, 0), unassigned: rows.filter(r => r.item).length,
  } }
}
