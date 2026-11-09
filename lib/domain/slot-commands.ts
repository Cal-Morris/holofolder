import { isContractRecord, isSlotContractId, isSlotRevision, normalizeBinderSlot, normalizeSlotTarget } from "@/lib/domain/binder-slots"
import type { BinderSlot, SlotTarget } from "@/lib/domain/binder-slots"

export const SLOT_LIMITS = { commands: 100, affected: 256, inserted: 256, capacity: 4096, page: 500, bytes: 262144, wantsPerSlot: 100 } as const
export interface SlotPrecondition {
  id: string
  version: number
  inventoryItemId: string | null
  itemVersion: number | null
  placementVersion: number | null
}
export type SlotCommand =
  | { kind: "create"; ids: string[]; beforeSlotId: string | null }
  | { kind: "move"; slots: SlotPrecondition[]; beforeSlotId: string | null }
  | { kind: "clear" | "remove"; slots: SlotPrecondition[] }
  | { kind: "update"; slot: SlotPrecondition; target?: SlotTarget | null; wantedCards?: BinderSlot["wantedCards"] }
export interface SlotCommandRequest {
  collectionId: string
  operationId: string
  inventoryRevision: number
  collectionVersion: number
  layoutRevision: number
  commands: SlotCommand[]
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
function invalid(): never { throw new Error("Invalid or oversized slot command") }
function ref(value: unknown): value is SlotPrecondition {
  if (!isContractRecord(value, ["id", "version", "inventoryItemId", "itemVersion", "placementVersion"]) || !isSlotContractId(value.id) || !isSlotRevision(value.version)) return false
  return value.inventoryItemId === null ? value.itemVersion === null && value.placementVersion === null
    : isSlotContractId(value.inventoryItemId) && isSlotRevision(value.itemVersion) && isSlotRevision(value.placementVersion)
}
/** Strict transport contract. Actor, owner, source and catalog evidence never come from this body. */
export function parseSlotCommand(value: unknown): SlotCommandRequest {
  if (new TextEncoder().encode(JSON.stringify(value) ?? "").length > SLOT_LIMITS.bytes
    || !isContractRecord(value, ["collectionId", "operationId", "inventoryRevision", "collectionVersion", "layoutRevision", "commands"])
    || !uuid(value.collectionId) || !isSlotContractId(value.operationId) || value.operationId.length < 8 || value.operationId.length > 100
    || !isSlotRevision(value.inventoryRevision) || !isSlotRevision(value.collectionVersion) || !isSlotRevision(value.layoutRevision)
    || !Array.isArray(value.commands) || !value.commands.length || value.commands.length > SLOT_LIMITS.commands) return invalid()
  let affected = 0, inserted = 0
  for (const c of value.commands) {
    if (!isContractRecord(c, ["kind", "ids", "beforeSlotId", "slots", "slot", "target", "wantedCards"])) return invalid()
    if (c.kind === "create") {
      if (!isContractRecord(c, ["kind", "ids", "beforeSlotId"]) || !Array.isArray(c.ids) || !c.ids.length || !Array.from(c.ids).every(isSlotContractId)
        || new Set(c.ids).size !== c.ids.length || !(c.beforeSlotId === null || isSlotContractId(c.beforeSlotId))) return invalid()
      inserted += c.ids.length; affected += c.ids.length
    } else if (["clear", "remove", "move"].includes(c.kind as string)) {
      if (!isContractRecord(c, c.kind === "move" ? ["kind", "slots", "beforeSlotId"] : ["kind", "slots"])
        || !Array.isArray(c.slots) || !c.slots.length || !Array.from(c.slots).every(ref) || new Set(c.slots.map(s => s.id)).size !== c.slots.length
        || (c.kind === "move" && !(c.beforeSlotId === null || isSlotContractId(c.beforeSlotId)))) return invalid()
      affected += c.slots.length
    } else if (c.kind === "update") {
      if (!isContractRecord(c, ["kind", "slot", "target", "wantedCards"]) || !ref(c.slot) || !("target" in c || "wantedCards" in c)) return invalid()
      if ("target" in c && normalizeSlotTarget(c.target) === undefined) return invalid()
      if ("wantedCards" in c) {
        if (!Array.isArray(c.wantedCards) || c.wantedCards.length > SLOT_LIMITS.wantsPerSlot || !normalizeBinderSlot({ id: "validation", ownerUserId: "validation", collectionId: "validation", target: null,
          inventoryItemId: null, wantedCards: c.wantedCards, status: null, version: 0, presetOrigin: null })) return invalid()
      }
      affected++
    } else return invalid()
  }
  if (affected > SLOT_LIMITS.affected || inserted > SLOT_LIMITS.inserted) return invalid()
  return structuredClone(value) as unknown as SlotCommandRequest
}


export interface SlotPage {
  inventoryRevision: number
  collectionVersion: number
  layoutRevision: number
  slots: Array<{ id: string; position: number } & Record<string, unknown>>
  nextPosition: number | null
}
