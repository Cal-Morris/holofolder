import { fetchCurrentInventorySnapshot } from "@/lib/collection/inventory-read-browser"
import { sameInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { CollectionNavigationRead } from "@/lib/collection-navigation"

/** Real current-session host adapter. Failures stay failures; no cached fallback is branded complete. */
export async function fetchCurrentCollectionNavigationRead(currentScope: () => InventoryReadScope | null, localHarness = false): Promise<
  | { status: "complete"; read: CollectionNavigationRead }
  | { status: "conflict" | "unavailable"; code: string }
> {
  const result = await fetchCurrentInventorySnapshot(currentScope, localHarness)
  if (result.status !== "complete") return result
  if (!sameInventoryReadScope(currentScope(), result.scope)) return { status: "conflict", code: "inventory_read_scope_changed" }
  return { status: "complete", read: {
    scope: { accountUserId: result.scope.actorUserId, ownerUserId: result.scope.ownerUserId, sessionId: result.scope.sessionId },
    partnerUserId: result.partnerUserId,
    evidence: { kind: "complete", snapshot: result.snapshot }, catalog: result.navigation.catalog, layouts: result.navigation.layouts,
  } }
}

/** Pass () => readCurrentCollectionNavigation(liveScope) to the existing host's readCurrent. */
export async function readCurrentCollectionNavigation(currentScope: () => InventoryReadScope | null, localHarness = false): Promise<CollectionNavigationRead> {
  const current = currentScope(), started = current ? { ...current } : null
  const result = await fetchCurrentCollectionNavigationRead(currentScope, localHarness)
  if (result.status !== "complete") throw new CollectionNavigationReadError(result.status, result.code)
  if (!started || !sameInventoryReadScope(currentScope(), started)) throw new CollectionNavigationReadError("conflict", "inventory_read_scope_changed")
  return result.read
}
export class CollectionNavigationReadError extends Error {
  constructor(readonly status: "conflict" | "unavailable", readonly code: string) { super(code) }
}
