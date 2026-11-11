import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { InventoryReadError, isRow, parseInventorySnapshot, rows, unavailable } from "./inventory-read-core"
import { buildInventoryCatalog } from "./inventory-read-catalog"
export { InventoryReadError } from "./inventory-read-core"

/** Cookie/RLS boundary only. Never pass an admin client or developer credentials here.
 * inventory_read_v2 checks the live session, user, partnership and billing, then reads everything in one snapshot. */
export async function readOwnerInventorySnapshot(client?: SupabaseClient) {
  return (await readOwnerInventoryState(client)).snapshot
}
export async function readOwnerInventoryState(client?: SupabaseClient) {
  const db = client ?? await (await import("@/lib/supabase/server")).createClient()
  const { data, error } = await db.rpc("inventory_read_v2").abortSignal(AbortSignal.timeout(15_000))
  if (error) {
    // Anonymous callers aren't granted the function at all; both are a sign-in problem.
    if (error.code === "42501") throw error.message === "inventory_read_forbidden"
      ? new InventoryReadError("inventory_read_forbidden", 403) : new InventoryReadError("inventory_sign_in_required", 401)
    return unavailable()
  }
  if (!isRow(data) || !isRow(data.scope) || !isRow(data.snapshot)) return unavailable()
  const { actor, owner, session_id: authSessionId, partnership, settings } = data.scope
  if (![actor, owner, authSessionId].every(isSlotContractId) || partnership !== null && !isRow(partnership)
    || settings !== null && !isRow(settings)) return unavailable()
  const members = partnership ? [partnership.user1_id, partnership.user2_id] : [actor]
  if (!members.includes(actor) || !members.includes(owner)) return unavailable()
  const partnerUserId = partnership ? (partnership.user1_id === owner ? partnership.user2_id : partnership.user1_id) : null
  if (partnerUserId !== null && (!isSlotContractId(partnerUserId) || partnerUserId === owner)) return unavailable()
  const { snapshot, evidence, layouts, collectionMetadata } = await parseInventorySnapshot(data.snapshot, owner as string, settings as Record<string, unknown> | null)
  const catalog = isRow(data.snapshot.catalog) ? buildInventoryCatalog({ cards: rows(data.snapshot.catalog.cards),
    dex: rows(data.snapshot.catalog.dex), sets: rows(data.snapshot.catalog.sets) }) : unavailable()
  const defaults = Object.entries(collectionMetadata).filter(([, c]) => c.isDefault === true)
  const defaultCollectionId = defaults.length === 1 && Object.values(collectionMetadata).every(c => typeof c.isDefault === "boolean") ? defaults[0][0] : undefined
  return { snapshot, evidence, navigation: { catalog, layouts }, actorUserId: actor as string, partnerUserId,
    authSessionId: authSessionId as string, ...(defaultCollectionId ? { defaultCollectionId } : {}) }
}
