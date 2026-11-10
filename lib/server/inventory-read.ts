import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { readTrustedInventoryState, InventoryReadError, type InventoryReadOptions } from "./inventory-read-core"
export { InventoryReadError, type InventoryReadOptions } from "./inventory-read-core"

/** Cookie/RLS boundary only. Never pass an admin client or developer credentials here.
 * Invoke freshly after successful ledger replay; retained snapshots cannot prove a fresh-read ACK. */
export async function readOwnerInventorySnapshot(client?: SupabaseClient, options: InventoryReadOptions = {}) {
  return (await readOwnerInventoryState(client, options)).snapshot
}
export async function readOwnerInventoryState(client?: SupabaseClient, options: InventoryReadOptions = {}) {
  const db = client ?? await (await import("@/lib/supabase/server")).createClient()
  const fail = (code: InventoryReadError["code"], status: InventoryReadError["status"]): never => { throw new InventoryReadError(code, status) }
  const unavailable = (): never => fail("inventory_read_unavailable", 503)
  const rows = (value: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(value) || value.some(r => !r || typeof r !== "object" || Array.isArray(r))) return unavailable()
    return value
  }
  const result = await readTrustedInventoryState(db, { privateSettings: false, scope: async (check, signal) => {
    check()
    const claims = await db.auth.getClaims()
    if (claims.error || !claims.data?.claims.sub || claims.data.claims.client_id || claims.data.claims.role !== "authenticated") fail("inventory_sign_in_required", 401)
    const authSessionId = claims.data!.claims.session_id
    if (!isSlotContractId(authSessionId)) return fail("inventory_sign_in_required", 401)
    check()
    const user = await db.auth.getUser()
    const actor = user.data.user?.id
    if (user.error || !actor || actor !== claims.data!.claims.sub) return fail("inventory_sign_in_required", 401)
    check()
    const membership = await db.from("partnerships").select("id,owner_user_id,user1_id,user2_id")
      .or(`user1_id.eq.${actor},user2_id.eq.${actor}`).limit(2).abortSignal(signal)
    if (membership.error) return unavailable()
    const partners = rows(membership.data)
    if (partners.length > 1) return unavailable()
    const p = partners[0]
    if (p && (p.user1_id !== actor && p.user2_id !== actor || p.owner_user_id !== p.user1_id && p.owner_user_id !== p.user2_id)) return fail("inventory_read_forbidden", 403)
    const owner = p ? p.owner_user_id : actor
    if (!isSlotContractId(owner)) return unavailable()
    check()
    const access = await db.rpc("billing_partner_allowed", { owner_id: owner, actor_id: actor }).abortSignal(signal)
    // Unlike legacy compatibility, missing billing policy never silently allows new reads.
    if (access.error || typeof access.data !== "boolean") return unavailable()
    if (!access.data) return fail("inventory_read_forbidden", 403)
    return { actor, owner, authorityId: authSessionId, partnership: p ?? null }
  } }, options)
  const { authorityId, slotPositions: _slotPositions, collectionMetadata: _collectionMetadata, ...state } = result
  return { ...state, authSessionId: authorityId }
}
