import { isStorageCommandRejection } from "@/lib/collection/storage-command-rejection"
import { appPath } from "@/lib/app-path"
import { parseSlotIntent, type SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
import { sameInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { SlotReplayResult } from "@/lib/collection/slot-offline-queue"
import { isContractRecord, isSlotRevision, isSlotContractId } from "@/lib/domain/binder-slots"

/** Exact request replay. Queued provenance stays local; authenticated server context is authoritative.
 * A receipt is never a complete snapshot. The queue must start its own fresh read after this returns. */
export async function sendStorageCommand(intent: SlotOfflineIntent, currentScope: () => InventoryReadScope | null,
  signal: AbortSignal, localHarness = false): Promise<SlotReplayResult> {
  const current = currentScope()
  if (!current || signal.aborted) return { status: 0 }
  const scope = { ...current }, parsed = parseSlotIntent(intent)
  const valid = () => !signal.aborted && sameInventoryReadScope(currentScope(), scope)
  try {
    const path = localHarness ? `/e2e-harness/storage/${parsed.kind}` : parsed.kind === "creation" ? "/api/storage-collections" : parsed.kind === "slots" ? "/api/binder-slots" : "/api/inventory"
    const response = await fetch(appPath(path), { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Binder-Owner": scope.ownerUserId,
        "X-Binder-Auth-Session": scope.authSessionId, "X-Storage-Operation": parsed.request.operationId }, body: JSON.stringify(parsed.request) })
    if (!valid() || response.redirected) return { status: 0 }
    const body: unknown = await response.json()
    if (!valid()) return { status: 0 }
    const privateReply = response.headers.get("cache-control")?.split(/\s*,\s*/)
    if (parsed.kind !== "creation" && response.status === 409 && privateReply?.includes("private") && privateReply.includes("no-store")
      && response.headers.get("content-type")?.startsWith("application/json")
      && isContractRecord(body, ["version", "operationId", "rejection"]) && Object.keys(body).length === 3
      && body.version === 1 && body.operationId === parsed.request.operationId && isStorageCommandRejection(body.rejection, parsed.request.operationId)) {
      return { status: 409, code: body.rejection.code, operationId: parsed.request.operationId, rejection: body.rejection }
    }
    if (response.status !== 200) {
      const code = isContractRecord(body, ["error"]) && isContractRecord(body.error, ["code", "message", "requestId"])
        && typeof body.error.code === "string" ? body.error.code : undefined
      return { status: response.status, code }
    }
    const cache = response.headers.get("cache-control")?.split(/\s*,\s*/)
    if (!cache?.includes("private") || !cache.includes("no-store") || !response.headers.get("content-type")?.startsWith("application/json")
      || !isContractRecord(body, ["version", "operationId", "receipt"]) || body.version !== 1 || body.operationId !== parsed.request.operationId
      || !validReceipt(body.receipt, parsed)) return { status: 0 }
    return { status: 200, operationId: parsed.request.operationId, inventoryRevision: (body.receipt as { inventoryRevision: number }).inventoryRevision }
  } catch { return { status: 0 } }
}
function validReceipt(value: unknown, intent: SlotOfflineIntent) {
  const kind = intent.kind
  if (kind === "creation") {
    const fields = ["inventoryRevision", "collectionId", "collectionVersion", "layoutRevision", "changed", "slotIds", "recoverySupported"]
    return isContractRecord(value, fields) && Object.keys(value).length === fields.length
      && isSlotRevision(value.inventoryRevision) && isSlotRevision(value.collectionVersion) && isSlotRevision(value.layoutRevision)
      && value.collectionId === intent.request.collectionId && value.changed === true && value.recoverySupported === false
      && JSON.stringify(value.slotIds) === JSON.stringify(intent.request.slotIds)
  }
  const fields = kind === "slots" ? ["inventoryRevision", "changed", "collectionVersion", "layoutRevision", "removedSlotIds"]
    : ["inventoryRevision", "changed", "selectedItemIds", "acquiredItemIds"]
  if (!isContractRecord(value, fields) || Object.keys(value).length !== fields.length || !isSlotRevision(value.inventoryRevision) || typeof value.changed !== "boolean") return false
  const list = (v: unknown) => Array.isArray(v) && v.length <= 16384 && v.every(isSlotContractId)
  return kind === "slots" ? isSlotRevision(value.collectionVersion) && isSlotRevision(value.layoutRevision) && list(value.removedSlotIds)
    : list(value.selectedItemIds) && list(value.acquiredItemIds)
}
