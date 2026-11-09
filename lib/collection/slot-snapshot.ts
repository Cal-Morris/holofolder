import { normalizeInventorySnapshot, type InventorySnapshot } from "@/lib/domain/inventory"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"
import type { SlotPage } from "@/lib/domain/slot-commands"
import { isSlotRevision } from "@/lib/domain/binder-slots"

declare const completeSnapshot: unique symbol
export type CompleteInventorySnapshot = InventorySnapshot & { readonly [completeSnapshot]: true }
const completeReads = new WeakSet<object>()
export function isCompleteInventorySnapshot(value: unknown): value is CompleteInventorySnapshot {
  return !!value && typeof value === "object" && completeReads.has(value)
}

/** Internal read adapter, not an enabled HTTP/MCP schema. Readers must bind authenticated scope,
 * stable keyset ordering and one owner revision across every entity stream. */
export interface SnapshotPage<T> {
  inventoryRevision: number
  total: number
  rows: T[]
  next: string | null
}
export async function readCompleteSnapshotRows<T>(
  read: (after: string | null, revision: number) => Promise<SnapshotPage<T>>,
  revision: number,
  identity: (row: T) => string,
): Promise<T[]> {
  if (!isSlotRevision(revision)) throw new Error("invalid-snapshot-revision")
  const rows: T[] = [], ids = new Set<string>(), cursors = new Set<string>()
  let after: string | null = null, total: number | null = null
  do {
    const page = await read(after, revision)
    if (page.inventoryRevision !== revision || !isSlotRevision(page.total) || !Array.isArray(page.rows)
      || (total !== null && page.total !== total) || !(page.next === null || typeof page.next === "string" && page.next.length > 0)) throw new Error("partial-or-changing-snapshot")
    total = page.total
    for (const row of page.rows) {
      const id = identity(row)
      if (typeof id !== "string" || !id || ids.has(id)) throw new Error("duplicate-snapshot-row")
      ids.add(id); rows.push(row)
    }
    if (rows.length > total || (page.next !== null && (!page.rows.length || cursors.has(page.next)))) throw new Error("invalid-snapshot-page")
    if (page.next !== null) cursors.add(page.next)
    after = page.next
  } while (after !== null)
  if (rows.length !== total) throw new Error("partial-snapshot")
  return rows
}

export type InventorySnapshotReaders = {
  [K in "items" | "placements" | "collections" | "binders"]: (after: string | null, revision: number) => Promise<SnapshotPage<InventorySnapshot[K][number]>>
}
/** Fetch all private streams before publishing any snapshot. The binder reader must itself collect
 * every slot page under inventory+collection+layout revisions, never return a partial BinderSnapshot.
 * A server reader may fence the completed streams before branding; failed fences publish nothing. */
export async function readCompleteInventorySnapshot(ownerUserId: string, inventoryRevision: number, readers: InventorySnapshotReaders, beforeBrand?: () => Promise<void>): Promise<CompleteInventorySnapshot> {
  const [items, placements, collections, binders] = await Promise.all([
    readCompleteSnapshotRows(readers.items, inventoryRevision, i => i.id),
    readCompleteSnapshotRows(readers.placements, inventoryRevision, p => p.inventoryItemId),
    readCompleteSnapshotRows(readers.collections, inventoryRevision, c => c.id),
    readCompleteSnapshotRows(readers.binders, inventoryRevision, b => b.collectionId),
  ])
  const snapshot = normalizeInventorySnapshot({ ownerUserId, inventoryRevision, items, placements, collections, binders })
  if (!snapshot) throw new Error("invalid-complete-snapshot")
  await beforeBrand?.()
  completeReads.add(snapshot)
  return snapshot as CompleteInventorySnapshot
}

/** Consume the actual 074 slot_page_v1 continuation contract. Do not publish accumulated pages. */
export async function readAllSlotPages(
  read: (continuation: { afterPosition: number; inventoryRevision: number; collectionVersion: number; layoutRevision: number } | null) => Promise<SlotPage>,
): Promise<SlotPage> {
  let continuation: Parameters<typeof read>[0] = null
  let revision: Pick<SlotPage, "inventoryRevision" | "collectionVersion" | "layoutRevision"> | null = null
  const slots: SlotPage["slots"] = [], ids = new Set<string>()
  let lastPosition = -1
  do {
    const page: SlotPage = await read(continuation)
    const current = { inventoryRevision: page.inventoryRevision, collectionVersion: page.collectionVersion, layoutRevision: page.layoutRevision }
    if (!Object.values(current).every(isSlotRevision) || !Array.isArray(page.slots) || page.slots.length > 500
      || revision && JSON.stringify(current) !== JSON.stringify(revision)) throw new Error("slot-page-revision-conflict")
    revision = current
    for (const slot of page.slots) {
      if (typeof slot.id !== "string" || !slot.id || ids.has(slot.id) || !isSlotRevision(slot.position) || slot.position <= lastPosition) throw new Error("invalid-slot-page")
      ids.add(slot.id); lastPosition = slot.position; slots.push(slot)
    }
    if (slots.length > SLOT_LIMITS.capacity) throw new Error("slot-capacity-exceeded")
    if (page.nextPosition !== null && (!page.slots.length || page.nextPosition !== lastPosition)) throw new Error("partial-slot-page")
    continuation = page.nextPosition === null ? null : { ...revision, afterPosition: lastPosition }
  } while (continuation !== null)
  return { ...revision!, slots, nextPosition: null }
}
