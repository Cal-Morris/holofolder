import { appPath } from "@/lib/app-path"
import { readCompleteInventorySnapshot, type CompleteInventorySnapshot, type InventorySnapshotReaders } from "@/lib/collection/slot-snapshot"
import { isInventoryReadScope, parseInventoryReadEnvelope, sameInventoryReadScope, type InventoryNavigationEvidence, type InventoryReadEnvelope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"

const errorCodes = new Set(["inventory_sign_in_required", "inventory_read_forbidden", "inventory_read_unavailable",
  "inventory_not_initialized", "legacy_inventory_incomplete", "inventory_read_conflict", "inventory_read_deadline",
  "inventory_operations_staged", "inventory_read_scope_changed", "inventory_read_invalid_response"])

export type BrowserInventoryReadResult =
  | { status: "complete"; scope: InventoryReadScope; snapshot: CompleteInventorySnapshot; navigation: InventoryNavigationEvidence }
  | { status: "conflict" | "unavailable"; code: string }

/** Call with the auth host's LIVE scope getter, never IDs from saved UI state.
 * Each invocation starts its process-local complete-read identity BEFORE fetch/JSON awaits.
 * No cached response, retained snapshot or generic JSON reconstruction entry point is accepted. */
export async function fetchCurrentInventorySnapshot(currentScope: () => InventoryReadScope | null, localHarness = false): Promise<BrowserInventoryReadResult> {
  const current = currentScope()
  if (!isInventoryReadScope(current)) return { status: "unavailable", code: "inventory_sign_in_required" }
  const scope = { ...current }, requestId = crypto.randomUUID()
  const assertCurrent = () => { if (!sameInventoryReadScope(currentScope(), scope)) throw new Error("inventory_read_scope_changed") }
  let resolve!: (value: InventoryReadEnvelope) => void, reject!: (reason: unknown) => void
  const responseBody = new Promise<InventoryReadEnvelope>((yes, no) => { resolve = yes; reject = no })
  function stream<K extends keyof InventorySnapshotReaders>(key: K): InventorySnapshotReaders[K] {
    return (async () => {
      const body = await responseBody
      assertCurrent()
      return { inventoryRevision: body.evidence.inventoryRevision, total: body.evidence[key], rows: body.snapshot[key], next: null }
    }) as InventorySnapshotReaders[K]
  }
  // This starts synchronously before any HTTP work, preserving PR427's post-command fence.
  const complete = readCompleteInventorySnapshot(scope.ownerUserId, responseBody.then(body => body.evidence.inventoryRevision), {
    items: stream("items"), placements: stream("placements"), collections: stream("collections"), binders: stream("binders"),
  }, async () => { assertCurrent() })
  // Install a rejection handler while HTTP is pending, retaining the actual failure for the caller.
  void complete.catch(() => {})
  try {
    const response = await fetch(`${appPath(localHarness ? "/e2e-harness/storage/inventory" : "/api/inventory")}?${new URLSearchParams({ requestId, sessionId: scope.sessionId })}`, {
      credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000),
    })
    assertCurrent()
    if (!response.ok) {
      const body: unknown = await response.json()
      assertCurrent()
      const reported = body && typeof body === "object"
        ? "code" in body ? body.code : "error" in body ? body.error : undefined : undefined
      const code = typeof reported === "string" && errorCodes.has(reported) ? reported : "inventory_read_unavailable"
      throw new Error(code)
    }
    if (response.redirected || !response.headers.get("cache-control")?.split(/\s*,\s*/).includes("no-store")
      || !response.headers.get("cache-control")?.split(/\s*,\s*/).includes("private")
      || !response.headers.get("content-type")?.startsWith("application/json")) throw new Error("inventory_read_unavailable")
    const body = parseInventoryReadEnvelope(await response.json(), requestId, scope)
    assertCurrent()
    if (!body) throw new Error("inventory_read_invalid_response")
    resolve(body)
    const snapshot = await complete
    assertCurrent()
    return { status: "complete", scope, snapshot, navigation: body.navigation }
  } catch (error) {
    reject(error)
    await complete.catch(() => {})
    const code = error instanceof Error && errorCodes.has(error.message) ? error.message : "inventory_read_unavailable"
    return { status: code === "inventory_read_conflict" || code === "inventory_read_scope_changed" ? "conflict" : "unavailable", code }
  }
}
