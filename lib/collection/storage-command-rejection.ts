import { isContractRecord, isSlotRevision } from "@/lib/domain/binder-slots"

export const STORAGE_REJECTION_CODES = ["slot_revision_conflict", "inventory_revision_conflict", "inventory_collection_conflict", "slot_conflict", "item_conflict", "placement_conflict", "inventory_want_conflict", "inventory_copy_choice_required", "inventory_destination_empty", "inventory_destination_occupied"] as const
export interface StorageCommandRejection { outcome: "rejected"; operationId: string; code: string; inventoryRevision: number }
/** Only 089's committed terminal ledger result is a rejection proof. SQL/HTTP errors are not. */
export function isStorageCommandRejection(value: unknown, operationId: string): value is StorageCommandRejection {
  return isContractRecord(value, ["outcome", "operationId", "code", "inventoryRevision"]) && Object.keys(value).length === 4
    && value.outcome === "rejected" && value.operationId === operationId && isSlotRevision(value.inventoryRevision)
    && STORAGE_REJECTION_CODES.includes(value.code as typeof STORAGE_REJECTION_CODES[number])
}
