import { createBinderBackupV2, freezeBackupPlan, parseBinderBackupV2, type BinderBackupV2 } from "@/lib/binder-backup-v2"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
import { IMPORT_MAX_BYTES } from "@/lib/collection-import"
import { captureCompleteInventoryReadFence, isCompleteInventoryReadAfter } from "@/lib/collection/slot-snapshot"
import { sameInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { CollectionNavigationRead } from "@/lib/collection-navigation"

export interface NativeBackupBinding {
  scope: InventoryReadScope
  currentScope: () => InventoryReadScope | null
  available: boolean
  revisionKey: string
  readCurrent: () => Promise<CollectionNavigationRead>
  assertReady: () => Promise<void>
}

/** A fresh private first-party read, never a developer DTO or saved/optimistic mirror. */
export async function readNativeBackup(binding: NativeBackupBinding, active: () => boolean) {
  const assertCurrent = () => {
    if (!active() || !sameInventoryReadScope(binding.currentScope(), binding.scope)) throw new Error("The collection session changed. Reopen Backup.")
  }
  assertCurrent()
  await binding.assertReady()
  assertCurrent()
  const fence = captureCompleteInventoryReadFence()
  const read = await binding.readCurrent()
  assertCurrent()
  if (read.scope.accountUserId !== binding.scope.actorUserId || read.scope.ownerUserId !== binding.scope.ownerUserId
    || read.scope.sessionId !== binding.scope.sessionId || read.evidence.kind !== "complete"
    || !isCompleteInventoryReadAfter(read.evidence.snapshot, fence)
    || read.evidence.snapshot.ownerUserId !== binding.scope.ownerUserId || read.partnerUserId === undefined) {
    throw new Error("A fresh complete authorized collection read is required.")
  }
  await binding.assertReady()
  assertCurrent()
  return { read, snapshot: read.evidence.snapshot, assertCurrent }
}

export async function prepareNativeBackup(binding: NativeBackupBinding, scope: BinderBackupV2["scope"], collectionId: string | undefined, active: () => boolean) {
  const { read, snapshot, assertCurrent } = await readNativeBackup(binding, active)
  const selected = snapshot.collections.filter(c => scope === "all-inventory" || c.id === collectionId)
  if (selected.some(c => !read.layouts.some(l => l.collectionId === c.id))) throw new Error("Collection grids are unavailable. No backup was downloaded.")
  const backup = createBinderBackupV2({ snapshot, completeness: "complete-owner", scope, collectionId,
    layouts: [...read.layouts], partnerUserId: read.partnerUserId ?? undefined })
  const blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" })
  // Validate the actual artifact bytes, including the finite import bound, before offering it.
  parseBinderBackupV2(await blob.text())
  await binding.assertReady()
  assertCurrent()
  return { backup, blob, assertCurrent }
}

/** Device-local inspection only. File identity never proves provenance or authorizes restore. */
export function inspectNativeBackup(text: string, read: CollectionNavigationRead) {
  const backup = parseBinderBackupV2(text)
  if (read.evidence.kind !== "complete") throw new Error("A fresh complete collection read is required.")
  const current = read.evidence.snapshot
  const ids = new Set(current.items.map(i => i.id))
  const slots = backup.binders.flatMap(b => b.slots)
  const printings = new Set([
    ...backup.items.flatMap(i => i.identity.kind === "card" ? [i.identity.cardId] : []),
    ...slots.flatMap(s => [...(s.target?.kind === "card" ? [s.target.cardId] : []), ...s.wantedCards.map(w => w.card_id)]),
  ])
  const resolveCatalog = browserHostCatalog([...read.catalog])
  const known = [...printings].filter(id => resolveCatalog(id)).length
  return freezeBackupPlan({
    collections: backup.collections.length, copies: backup.items.length, placements: backup.placements.length,
    unassigned: backup.items.length - backup.placements.length, slots: slots.length,
    spacers: slots.filter(s => !s.target && !s.inventoryItemId && !s.status && !s.wantedCards.length).length,
    targets: slots.filter(s => s.target).length, wants: slots.reduce((n, s) => n + s.wantedCards.length, 0),
    manifests: backup.binders.filter(b => b.presetManifest).length, grids: backup.layouts?.length ?? 0,
    graded: backup.items.filter(i => i.grading).length, appearance: backup.appearance.length,
    overlappingCopies: backup.items.filter(i => ids.has(i.id)).length,
    overlappingCollections: backup.collections.filter(c => current.collections.some(v => v.id === c.id)).length,
    knownPrintings: known, unknownPrintings: printings.size - known,
    partnerResolution: slots.some(s => s.wantedCards.some(w => w.wantedRoles?.includes("partner"))) && !read.partnerUserId,
    scope: backup.scope,
  })
}

export async function readNativeBackupFile(file: Pick<File, "size" | "text">) {
  if (file.size > IMPORT_MAX_BYTES) throw new Error("Maximum file size is 10 MiB")
  const text = await file.text()
  // Check actual UTF-8 bytes too; File.size alone is not the parser boundary.
  parseBinderBackupV2(text)
  return text
}
