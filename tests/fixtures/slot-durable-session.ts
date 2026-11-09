import { readCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import type { InventorySnapshot } from "@/lib/domain/inventory"

/** Synthetic all-stream transport for the isolated session harness, not a production reader. */
export async function readSyntheticComplete(snapshot: InventorySnapshot, partial = false) {
  const s = structuredClone(snapshot)
  const page = <T>(rows: T[]) => async () => ({ inventoryRevision: s.inventoryRevision, total: rows.length, rows, next: null })
  return readCompleteInventorySnapshot(s.ownerUserId, s.inventoryRevision, {
    items: page(s.items), placements: page(s.placements), collections: page(s.collections),
    binders: partial ? async () => ({ inventoryRevision: s.inventoryRevision, total: s.binders.length + 1, rows: s.binders, next: null }) : page(s.binders),
  })
}
