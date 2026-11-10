import { isContractRecord, isSlotContractId } from "@/lib/domain/binder-slots"
import { parseInventoryCommand, type InventoryCommandRequest, type InventoryCommand } from "@/lib/domain/inventory-commands"

export type NativeRecoveryOperation = "recovery.preview" | "recovery.apply" | "recovery.preview.v2" | "recovery.apply.v2"
const isAuditId = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= BigInt("9223372036854775807")
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 16384 && v.every(isSlotContractId)
const invalid = (): never => { throw new Error("invalid-native-recovery-request") }
/** Canonical parser shared by the authoritative bridge and durable browser intent. */
export function parseNativeRecoveryRequest(operation: NativeRecoveryOperation, input: unknown): Record<string, unknown> {
  try {
    const v2 = operation === "recovery.preview.v2" || operation === "recovery.apply.v2"
    const applying = operation === "recovery.apply" || operation === "recovery.apply.v2"
    if (!v2 && operation !== "recovery.preview" && operation !== "recovery.apply") return invalid()
    const keys = ["eventId", "restoreUnassignedItemIds"]
    if (v2) keys.push("planVersion", "replacementDefaultCollectionId", "inventoryRevision", "collections")
    if (applying) keys.push("operationId", ...(v2 ? [] : ["planVersion"]), "planToken", "confirmed")
    if (new TextEncoder().encode(JSON.stringify(input) ?? "").length > 1048576 || !isContractRecord(input, keys)
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
