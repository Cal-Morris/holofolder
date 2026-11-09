import { isContractRecord, isSlotContractId, isSlotRevision, normalizeBinderSlot } from "@/lib/domain/binder-slots"
import { normalizeGradingRecord, normalizeInventoryIdentity } from "@/lib/domain/inventory"
import type { GradingRecord, InventoryIdentity } from "@/lib/domain/inventory"
import type { InventorySelection } from "@/lib/inventory-plans"
import type { SlotPrecondition } from "@/lib/domain/slot-commands"
import type { WantedCard } from "@/lib/domain/cards"

export interface InventorySlotRef { collectionId: string; slot: SlotPrecondition }
export interface InventoryItemRef { itemId: string; itemVersion: number; placement: InventorySlotRef | null }
export type SelectedWant = { index: number; expected: WantedCard } | null
export type InventoryCommand =
  | { kind: "add"; itemId: string; identity: InventoryIdentity; grading: GradingRecord | null; acquiredAt: string | null }
  | { kind: "edit"; item: InventoryItemRef; grading: GradingRecord | null }
  | { kind: "removeOwned" | "unassign"; item: InventoryItemRef }
  | { kind: "assign"; selection: InventorySelection; destination: InventorySlotRef; occupied: "cancel" | "unassign"; fulfillWant: SelectedWant }
  | { kind: "move"; item: InventoryItemRef; destination: InventorySlotRef; occupied: "cancel" | "unassign" | "swap"; fulfillWant: SelectedWant }
  | { kind: "removeSlots"; slots: InventorySlotRef[] }
  | { kind: "deleteCollection"; collectionId: string; slots: SlotPrecondition[]; replacementDefaultCollectionId: string | null }
export interface InventoryCommandRequest {
  operationId: string
  inventoryRevision: number
  collections: { collectionId: string; version: number; layoutRevision: number }[]
  commands: InventoryCommand[]
}
export const INVENTORY_LIMITS = { commands: 100, collections: 32, affected: 256, bytes: 262144, resultBytes: 1048576 } as const
export const INVENTORY_COLLECTION_DELETE_LIMITS = { slots: 4096, collections: 2, affected: 8192, bytes: 8388608, resultBytes: 16777216 } as const
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const exact = (v: unknown, keys: string[]) => isContractRecord(v, keys) && Object.keys(v).length === keys.length
const ref = (v: unknown): v is SlotPrecondition => isContractRecord(v, ["id", "version", "inventoryItemId", "itemVersion", "placementVersion"])
  && exact(v, ["id", "version", "inventoryItemId", "itemVersion", "placementVersion"]) && isSlotContractId(v.id) && isSlotRevision(v.version)
  && (v.inventoryItemId === null ? v.itemVersion === null && v.placementVersion === null
    : isSlotContractId(v.inventoryItemId) && isSlotRevision(v.itemVersion) && isSlotRevision(v.placementVersion))
const slot = (v: unknown): v is InventorySlotRef => isContractRecord(v, ["collectionId", "slot"]) && uuid(v.collectionId) && ref(v.slot)
const item = (v: unknown): v is InventoryItemRef => isContractRecord(v, ["itemId", "itemVersion", "placement"])
  && isSlotContractId(v.itemId) && isSlotRevision(v.itemVersion) && (v.placement === null || (slot(v.placement)
    && v.placement.slot.inventoryItemId === v.itemId && v.placement.slot.itemVersion === v.itemVersion))
function invalid(): never { throw new Error("Invalid or oversized inventory command") }

/** Body contains intent/preconditions only, never actor, owner, source or catalog evidence. */
export function parseInventoryCommand(value: unknown): InventoryCommandRequest {
  const wholeCollection = isContractRecord(value, ["operationId", "inventoryRevision", "collections", "commands"])
    && Array.isArray(value.commands) && value.commands.length === 1
    && isContractRecord(value.commands[0], ["kind", "collectionId", "slots", "replacementDefaultCollectionId"])
    && value.commands[0].kind === "deleteCollection"
  const limits = wholeCollection ? INVENTORY_COLLECTION_DELETE_LIMITS : INVENTORY_LIMITS
  if (new TextEncoder().encode(JSON.stringify(value) ?? "").length > limits.bytes
    || !isContractRecord(value, ["operationId", "inventoryRevision", "collections", "commands"])
    || !isSlotContractId(value.operationId) || value.operationId.length < 8 || value.operationId.length > 100 || !isSlotRevision(value.inventoryRevision)
    || !Array.isArray(value.collections) || value.collections.length > limits.collections
    || !Array.isArray(value.commands) || !value.commands.length || value.commands.length > INVENTORY_LIMITS.commands) return invalid()
  const collections = new Set<string>()
  for (const c of value.collections) {
    if (!isContractRecord(c, ["collectionId", "version", "layoutRevision"]) || !uuid(c.collectionId) || !isSlotRevision(c.version)
      || !isSlotRevision(c.layoutRevision) || collections.has(c.collectionId)) return invalid()
    collections.add(c.collectionId)
  }
  let affected = 0
  const checkSlot = (s: unknown) => slot(s) && collections.has(s.collectionId)
  const checkItem = (i: unknown) => item(i) && (i.placement === null || checkSlot(i.placement))
  for (const c of value.commands) {
    if (!isContractRecord(c, ["kind", "itemId", "identity", "grading", "acquiredAt", "item", "selection", "destination", "occupied", "fulfillWant", "slots", "collectionId", "replacementDefaultCollectionId"])) return invalid()
    if (c.kind === "add") {
      affected += 2
      const identity = normalizeInventoryIdentity(c.identity)
      if (!exact(c, ["kind", "itemId", "identity", "grading", "acquiredAt"]) || !isSlotContractId(c.itemId) || !identity || normalizeGradingRecord(c.grading) === undefined
        || (identity.kind === "pokemon" && c.grading !== null) || (c.acquiredAt !== null && (typeof c.acquiredAt !== "string" || !Number.isFinite(Date.parse(c.acquiredAt))))) return invalid()
    } else if (c.kind === "edit" || c.kind === "removeOwned" || c.kind === "unassign") {
      affected += 2
      if (!exact(c, c.kind === "edit" ? ["kind", "item", "grading"] : ["kind", "item"]) || !checkItem(c.item)
        || (c.kind === "edit" && normalizeGradingRecord(c.grading) === undefined)) return invalid()
    } else if (c.kind === "move" || c.kind === "assign") {
      if (!exact(c, c.kind === "move" ? ["kind", "item", "destination", "occupied", "fulfillWant"] : ["kind", "selection", "destination", "occupied", "fulfillWant"])
        || !checkSlot(c.destination) || !(c.kind === "move" ? ["cancel", "unassign", "swap"] : ["cancel", "unassign"]).includes(c.occupied as string)) return invalid()
      affected += (c.kind === "move" ? 3 : 2) + ((c.destination as InventorySlotRef).slot.inventoryItemId === null ? 0 : 1)
      if (c.kind === "move") { if (!checkItem(c.item) || (c.item as InventoryItemRef).placement === null) return invalid() }
      else {
        const s = c.selection
        if (!isContractRecord(s, ["kind", "identity", "newItemId", "inventoryItemId", "itemVersion"])) return invalid()
        if (s.kind === "existing") {
          if (!exact(s, ["kind", "inventoryItemId", "itemVersion"]) || !isSlotContractId(s.inventoryItemId) || !isSlotRevision(s.itemVersion)) return invalid()
        } else if (s.kind !== "catalog" || !exact(s, ["kind", "identity", "newItemId"]) || normalizeInventoryIdentity(s.identity)?.kind !== "card" || !isSlotContractId(s.newItemId)) return invalid()
      }
      if (c.fulfillWant !== null) {
        if (!isContractRecord(c.fulfillWant, ["index", "expected"]) || !isSlotRevision(c.fulfillWant.index) || c.fulfillWant.index >= 100) return invalid()
        if (!normalizeBinderSlot({ id: "validation", ownerUserId: "validation", collectionId: "validation", target: null,
          inventoryItemId: null, wantedCards: [c.fulfillWant.expected], status: null, version: 0, presetOrigin: null })) return invalid()
      }
    } else if (c.kind === "removeSlots") {
      if (!exact(c, ["kind", "slots"]) || !Array.isArray(c.slots) || !c.slots.length || !c.slots.every(checkSlot)) return invalid()
      affected += c.slots.length + c.slots.filter((s: InventorySlotRef) => s.slot.inventoryItemId !== null).length
    } else if (c.kind === "deleteCollection") {
      if (!exact(c, ["kind", "collectionId", "slots", "replacementDefaultCollectionId"]) || !uuid(c.collectionId) || !collections.has(c.collectionId) || !Array.isArray(c.slots) || c.slots.length > INVENTORY_COLLECTION_DELETE_LIMITS.slots || !c.slots.every(ref) || !(c.replacementDefaultCollectionId === null || (uuid(c.replacementDefaultCollectionId) && collections.has(c.replacementDefaultCollectionId) && c.replacementDefaultCollectionId !== c.collectionId))) return invalid()
      affected += Math.max(1, c.slots.length) + c.slots.filter((s: SlotPrecondition) => s.inventoryItemId !== null).length
    } else return invalid()
  }
  if (affected > limits.affected) return invalid()
  return structuredClone(value) as unknown as InventoryCommandRequest
}

