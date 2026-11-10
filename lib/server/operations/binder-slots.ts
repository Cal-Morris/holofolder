import { readStorageAuthority } from "@/lib/legacy-binder-transition"
import { isSlotContractId, isSlotRevision } from "@/lib/domain/binder-slots"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"
export { SLOT_LIMITS, parseSlotCommand } from "@/lib/domain/slot-commands"
export type { SlotPrecondition, SlotCommand, SlotCommandRequest } from "@/lib/domain/slot-commands"

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
function invalid(): never { throw new Error("Invalid or oversized slot command") }

export interface SlotPageInput {
  actorId: string
  ownerUserId: string
  collectionId: string
  limit: number
  afterPosition?: number
  inventoryRevision?: number
  collectionVersion?: number
  layoutRevision?: number
}
export type { SlotPage } from "@/lib/domain/slot-commands"
import type { SlotPage } from "@/lib/domain/slot-commands"
/** Internal transport-independent adapter. Reader is a trusted RPC binding, never supplied by HTTP. */
export async function readSlotPage(reader: (input: SlotPageInput) => Promise<SlotPage>, input: SlotPageInput): Promise<SlotPage> {
  if (!uuid(input.collectionId) || !isSlotContractId(input.actorId) || !isSlotContractId(input.ownerUserId)
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > SLOT_LIMITS.page
    || (input.afterPosition !== undefined && !isSlotRevision(input.afterPosition))
    || ([input.afterPosition, input.inventoryRevision, input.collectionVersion, input.layoutRevision].some(v => v !== undefined)
      && ![input.inventoryRevision, input.collectionVersion, input.layoutRevision].every(isSlotRevision))) invalid()
  return reader(input)
}

/** Migration 073 rejects species-keyed writes after conversion, including stale service callers. */
export function legacySlotCompatibilityResponse(error: unknown): Response | null {
  if (error instanceof Error && error.cause) return legacySlotCompatibilityResponse(error.cause)
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "55000"
    || !("message" in error) || typeof error.message !== "string" || !error.message.includes("binder_converted_requires_slot_commands")) return null
  return Response.json({ error: "This binder uses stable slots. Reload with a slot-compatible client before editing.",
    code: "binder_converted_requires_slot_commands", requiredCapability: "binder_slots_v1", slotOperationsEnabled: false },
  { status: 409, headers: { "Cache-Control": "private, no-store" } })
}


/** Check before a legacy query: UPDATE/DELETE of zero rows never fires the SQL authority trigger. */
export function legacySlotAuthorityResponse(row: unknown, error: { code?: string } | null): Response | null {
  try {
    return readStorageAuthority(row, error) === "slots"
      ? legacySlotCompatibilityResponse({ code: "55000", message: "binder_converted_requires_slot_commands" }) : null
  } catch {
    return Response.json({ error: "Binder storage authority is temporarily unavailable", code: "storage_authority_unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } })
  }
}
