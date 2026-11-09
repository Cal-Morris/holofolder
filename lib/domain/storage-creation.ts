import { isBinderId, normalizeBinderName } from "@/lib/binders/model"
import { instantiatePreset, normalizePresetManifest, type PresetManifest } from "@/lib/domain/binder-presets"
import { isContractRecord, isSlotContractId, isSlotRevision, type BinderSnapshot } from "@/lib/domain/binder-slots"
import { getStoragePresentationDefault, type StorageKind, type StoragePresentation } from "@/lib/domain/inventory"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"

export const COLLECTION_CREATION_LIMITS = { capacity: SLOT_LIMITS.capacity, bytes: 2097152, location: 200 } as const
/** Intent only. Authentication resolves the owner; never copy the UI draft's owner into this command. */
export interface CollectionCreationCommand {
  version: 1
  operationId: string
  inventoryRevision: number
  collectionId: string
  name: string
  kind: StorageKind
  defaultPresentation: StoragePresentation
  location: string | null
  grid: { rows: number; cols: number } | null
  manifest: PresetManifest
  slotIds: string[]
}
const invalid = (): never => { throw new Error("Invalid or oversized collection creation") }
/** Names must already be normalized, so the retained command is identical across all adapters/retries. */
export function parseCollectionCreation(value: unknown): CollectionCreationCommand {
  if (new TextEncoder().encode(JSON.stringify(value) ?? "").length > COLLECTION_CREATION_LIMITS.bytes
    || !isContractRecord(value, ["version", "operationId", "inventoryRevision", "collectionId", "name", "kind", "defaultPresentation", "location", "grid", "manifest", "slotIds"])
    || Object.keys(value).length !== 11 || value.version !== 1
    || !isSlotContractId(value.operationId) || value.operationId.length < 8 || value.operationId.length > 100
    || !isSlotRevision(value.inventoryRevision) || !isBinderId(value.collectionId)
    || !normalizeBinderName(value.name) || normalizeBinderName(value.name) !== value.name
    || typeof value.kind !== "string" || !["binder", "slab", "custom"].includes(value.kind)) return invalid()
  const kind = value.kind as StorageKind
  if (value.defaultPresentation !== getStoragePresentationDefault(kind)
    || !(value.location === null || kind === "custom" && isSlotContractId(value.location))
    || !(value.grid === null || isContractRecord(value.grid, ["rows", "cols"])
      && [value.grid.rows, value.grid.cols].every(n => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 8))) return invalid()
  const manifest = normalizePresetManifest(value.manifest)
  if (!manifest || manifest.name.length > 200 || manifest.entries.length > COLLECTION_CREATION_LIMITS.capacity
    || manifest.entries.some(e => e.target?.kind === "pokemon" && e.target.pokemonId > 1025)
    || !Array.isArray(value.slotIds) || value.slotIds.length !== manifest.entries.length
    || !value.slotIds.every(isSlotContractId) || new Set(value.slotIds).size !== value.slotIds.length) return invalid()
  return structuredClone({ ...value, manifest }) as unknown as CollectionCreationCommand
}
/** Detached optimistic projection, not a save/ACK. Versions/default/order are authoritative only after SQL. */
export function projectCollectionCreation(input: unknown, ownerUserId: string): BinderSnapshot {
  const command = parseCollectionCreation(input)
  if (!isBinderId(ownerUserId)) return invalid()
  const snapshot = instantiatePreset(command.manifest, { ownerUserId, collectionId: command.collectionId }, command.slotIds)
  if (!snapshot) return invalid()
  return snapshot
}
