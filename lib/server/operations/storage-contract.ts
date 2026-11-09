import { DeveloperAccessError } from "@/lib/developer-api/permissions"
import { isContractRecord, isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { parseInventoryCommand, type InventoryCommandRequest, type InventoryCommand } from "@/lib/domain/inventory-commands"
import { parseCollectionCreation, COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { isBinderId } from "@/lib/binders/model"
import { parseSlotCommand } from "@/lib/domain/slot-commands"
import { isAuditId } from "./audit"

export type StorageOperation = "inventory" | "slots" | "collection.create" | "recovery.preview" | "recovery.apply" | "recovery.preview.v2" | "recovery.apply.v2"
export const STORAGE_RESULT_BYTES = 16777216
const invalid = (): never => { throw new DeveloperAccessError("invalid_input", "Invalid or oversized storage request.", 400) }
const ids = (v: unknown, limit = 16384): v is string[] => Array.isArray(v) && v.length <= limit && v.every(isSlotContractId)
export function parseStorageRequest(operation: StorageOperation, input: unknown) {
  try {
    if (operation === "collection.create") return parseCollectionCreation(input)
    if (operation === "inventory") return parseInventoryCommand(input)
    if (operation === "slots") return parseSlotCommand(input)
    const v2 = operation === "recovery.preview.v2" || operation === "recovery.apply.v2"
    const applying = operation === "recovery.apply" || operation === "recovery.apply.v2"
    if (!v2 && operation !== "recovery.preview" && operation !== "recovery.apply") return invalid()
    const keys = ["eventId", "restoreUnassignedItemIds"]
    if (v2) keys.push("planVersion", "replacementDefaultCollectionId", "inventoryRevision", "collections")
    if (applying) keys.push("operationId", ...(v2 ? [] : ["planVersion"]), "planToken", "confirmed")
    if (Buffer.byteLength(JSON.stringify(input) ?? "") > 1048576 || !isContractRecord(input, keys)
      || Object.keys(input).length !== keys.length || !isAuditId(input.eventId)
      || !ids(input.restoreUnassignedItemIds) || new Set(input.restoreUnassignedItemIds).size !== input.restoreUnassignedItemIds.length) return invalid()
    if (v2) {
      if (input.planVersion !== 2 || input.restoreUnassignedItemIds.length !== 0 || !Array.isArray(input.collections) || input.collections.length !== 1
        || !isContractRecord(input.collections[0], ["collectionId", "version", "layoutRevision"]) || Object.keys(input.collections[0]).length !== 3
        || input.collections[0].collectionId !== input.replacementDefaultCollectionId) return invalid()
      // Reuse the canonical 075 deletion intent and collection preconditions.
      const command: Extract<InventoryCommand, { kind: "deleteCollection" }> = { kind: "deleteCollection", collectionId: String(input.replacementDefaultCollectionId), slots: [], replacementDefaultCollectionId: null }
      const canonical: InventoryCommandRequest = parseInventoryCommand({ operationId: "recovery-preview-v2", inventoryRevision: input.inventoryRevision, collections: input.collections, commands: [command] })
      if (canonical.collections.length !== 1) return invalid()
    }
    if (applying && (!isSlotContractId(input.operationId) || input.operationId.length < 8 || input.operationId.length > 100
      || input.planVersion !== (v2 ? 2 : 1) || input.confirmed !== true || typeof input.planToken !== "string" || !/^[a-f0-9]{64}$/.test(input.planToken))) return invalid()
    return structuredClone(input)
  } catch { return invalid() }
}

export function storageExecutionError(error: unknown): DeveloperAccessError {
  const message = error && typeof error === "object" && "message" in error ? error.message : null
  const code = error && typeof error === "object" && "code" in error ? error.code : null
  if (code === "P0001" && message === "binder_limit_reached") return new DeveloperAccessError("binder_limit_reached", "You have reached your current collection allowance.", 402)
  if (code === "P0001" && message === "binder_safety_limit_reached") return new DeveloperAccessError("binder_safety_limit_reached", "You have reached the maximum number of collections.", 409)
  if (code === "P0001" && message === "upgrade_required") return new DeveloperAccessError("premium_required", "This custom grid requires Premium access.", 402)
  if (code === "P0001" && message === "card_limit_reached") return new DeveloperAccessError("card_limit_reached", "You have reached your current saved card allowance.", 402)
  if (code === "40001" || code === "23505") return new DeveloperAccessError("storage_conflict", "Storage changed or the operation ID was already used. Refresh and review before retrying.", 409)
  if (code === "42501") return new DeveloperAccessError("storage_access_denied", "This operation is not allowed for the current collection.", 403)
  if (code === "HF402") return new DeveloperAccessError("premium_required", "API and MCP access require a Premium subscription or lifetime access.", 402)
  if (code === "22023" || code === "23514") return new DeveloperAccessError("invalid_input", "The storage request does not satisfy current constraints.", 400)
  if (code === "0A000") return new DeveloperAccessError("recovery_unsupported", "This event cannot be recovered automatically.", 409)
  return new DeveloperAccessError("storage_unavailable", "Storage execution is temporarily unavailable.", 503)
}

/** Project receipts, never return executor context, certificates, evidence or frozen source rows. */
export function normalizeStorageResult(operation: StorageOperation, value: unknown): Record<string, unknown> {
  const unavailable = (): never => { throw storageExecutionError(null) }
  if (Buffer.byteLength(JSON.stringify(value) ?? "") > STORAGE_RESULT_BYTES || !value || typeof value !== "object" || Array.isArray(value)) return unavailable()
  const row = value as Record<string, unknown>
  const revision = (key: string) => { if (!isSlotRevision(row[key])) return unavailable(); return row[key] }
  const list = (key: string) => { if (!ids(row[key])) return unavailable(); return [...row[key]] }
  if (operation === "recovery.preview" || operation === "recovery.preview.v2") {
    if (row.planVersion !== (operation === "recovery.preview.v2" ? 2 : 1) || !isAuditId(row.eventId) || typeof row.supported !== "boolean" || row.rootRevisionsAdvance !== true
      || !(row.planToken === null || typeof row.planToken === "string" && /^[a-f0-9]{64}$/.test(row.planToken))
      || !ids(row.restoreUnassignedItemIds) || !Array.isArray(row.unsupported) || row.unsupported.length > 16384
      || !row.unsupported.every(v => typeof v === "string" && v.length <= 200)
      || !Array.isArray(row.conflicts) || row.conflicts.length > 16384 || !Array.isArray(row.changes) || row.changes.length > 16384) return unavailable()
    // SQL's maintained redactor is authoritative. Reject private keys if a mismatched deployment leaks them.
    const safe = (v: unknown, depth = 0): boolean => {
      if (depth > 24) return false
      if (Array.isArray(v)) return v.length <= 16384 && v.every(x => safe(x, depth + 1))
      if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => !["certificate", "assetIds", "legacy_source", "source_row", "token", "access_token", "refresh_token", "jwt", "secret", "credentials", "artworkRef", "label"].includes(k) && safe(x, depth + 1))
      return v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)
    }
    if (!safe(row.changes) || !safe(row.conflicts)) return unavailable()
    return Object.fromEntries(["planVersion", "eventId", "supported", "unsupported", "conflicts", "planToken", "restoreUnassignedItemIds", "changes", "rootRevisionsAdvance"].map(k => [k, row[k]]))
  }
  const result: Record<string, unknown> = { inventoryRevision: revision("inventoryRevision") }
  if (operation === "collection.create") {
    if (!isBinderId(row.collectionId) || row.changed !== true || row.recoverySupported !== false
      || !ids(row.slotIds, COLLECTION_CREATION_LIMITS.capacity) || new Set(row.slotIds).size !== row.slotIds.length) return unavailable()
    return { ...result, collectionId: row.collectionId, collectionVersion: revision("collectionVersion"),
      layoutRevision: revision("layoutRevision"), changed: true, slotIds: [...row.slotIds], recoverySupported: false }
  }
  if (operation === "recovery.apply" || operation === "recovery.apply.v2") {
    if (!isAuditId(row.eventId) || !isAuditId(row.recoveredEventId) || !Array.isArray(row.collections) || row.collections.length > 4096) return unavailable()
    result.eventId = row.eventId; result.recoveredEventId = row.recoveredEventId
    result.collections = row.collections.map(c => {
      if (!isContractRecord(c, ["collectionId", "version", "layoutRevision"]) || !isSlotContractId(c.collectionId) || !isSlotRevision(c.version) || !isSlotRevision(c.layoutRevision)) return unavailable()
      return { collectionId: c.collectionId, version: c.version, layoutRevision: c.layoutRevision }
    })
  } else {
    if (typeof row.changed !== "boolean") return unavailable()
    result.changed = row.changed
    if (operation === "slots") {
      result.collectionVersion = revision("collectionVersion"); result.layoutRevision = revision("layoutRevision")
      result.removedSlotIds = list("removedSlotIds")
    } else { result.selectedItemIds = list("selectedItemIds"); result.acquiredItemIds = list("acquiredItemIds") }
  }
  return result
}
