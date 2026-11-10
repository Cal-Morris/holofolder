import { parseRawRestoreCommand, isRawRestoreReceipt } from '@/lib/domain/raw-restore'
import { parseNativeRecoveryRequest } from "@/lib/domain/native-recovery"
import { parseBackupArrangementCommand, BACKUP_IMPORT_LIMITS } from "@/lib/domain/backup-import-command"
import { DeveloperAccessError } from "@/lib/developer-api/permissions"
import { isContractRecord, isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { parseInventoryCommand } from "@/lib/domain/inventory-commands"
import { parseCollectionCreation, COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { isBinderId } from "@/lib/binders/model"
import { parseSlotCommand } from "@/lib/domain/slot-commands"
import { isAuditId } from "./audit"

export type StorageOperation = "backup.restore.raw" | "backup.arrangement" | "inventory" | "slots" | "collection.create" | "recovery.preview" | "recovery.apply" | "recovery.preview.v2" | "recovery.apply.v2"
export const STORAGE_RESULT_BYTES = 16777216
const invalid = (): never => { throw new DeveloperAccessError("invalid_input", "Invalid or oversized storage request.", 400) }
const ids = (v: unknown, limit = 16384): v is string[] => Array.isArray(v) && v.length <= limit && v.every(isSlotContractId)
export function parseStorageRequest(operation: StorageOperation, input: unknown) {
  try {
    if (operation === "backup.restore.raw") return parseRawRestoreCommand(input)
    if (operation === "backup.arrangement") return parseBackupArrangementCommand(input)
    if (operation === "collection.create") return parseCollectionCreation(input)
    if (operation === "inventory") return parseInventoryCommand(input)
    if (operation === "slots") return parseSlotCommand(input)
    return parseNativeRecoveryRequest(operation, input)
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
  if (operation === "backup.restore.raw") {
    if (!isRawRestoreReceipt(row)) return unavailable()
    return { ...row, slotIds: [...row.slotIds], releasedItemIds: [...row.releasedItemIds] }
  }
  if (operation === "backup.arrangement") {
    if (!isBinderId(row.collectionId) || row.changed !== true || !ids(row.slotIds, BACKUP_IMPORT_LIMITS.slots)
      || new Set(row.slotIds).size !== row.slotIds.length || !ids(row.addedItemIds, BACKUP_IMPORT_LIMITS.items) || !ids(row.removedEmptySlotIds, BACKUP_IMPORT_LIMITS.slots)) return unavailable()
    return { ...result, collectionId: row.collectionId, collectionVersion: revision("collectionVersion"), layoutRevision: revision("layoutRevision"), changed: true,
      slotIds: [...row.slotIds], addedItemIds: [...row.addedItemIds], removedEmptySlotIds: [...row.removedEmptySlotIds] }
  }
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
