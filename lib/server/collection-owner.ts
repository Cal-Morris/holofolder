import { BillingAccessError } from "@/lib/billing"
import type { SupabaseClient } from "@supabase/supabase-js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

interface ResolveCollectionOwnerOptions {
  /** When the partnership lookup fails, use the user's own id instead of throwing. */
  fallbackOnError?: boolean
  /** First-party recipient checks require a working current entitlement authority. */
  strictBilling?: boolean
  /** A definite partner billing denial opens the actor's own collection, as storage_execute_v1 does.
   * Read and RPC errors still throw: only a fresh answer can select the actor's own scope. */
  ownWhenDenied?: boolean
}

/**
 * Partner mode: both partners read and write the owner's collection and settings.
 * Returns the partnership owner's user id, or the user's own id when they have no partner.
 * Pass the same client the call site used before (anon/server client vs admin) so RLS is unchanged.
 */
export async function resolveCollectionOwnerUserId(
  client: AnySupabaseClient,
  userId: string,
  options: ResolveCollectionOwnerOptions = {},
): Promise<string> {
  return (await resolveCollectionMembership(client, userId, options)).ownerUserId
}

export async function resolveCollectionMembership(client: AnySupabaseClient, userId: string, options: ResolveCollectionOwnerOptions = {}) {
  const { data: partnership, error } = await client
    .from("partnerships")
    .select("id,owner_user_id,user1_id,user2_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (options.fallbackOnError) return { ownerUserId: userId, memberIds: [userId], partnershipId: null, partnerAccessDenied: false }
    throw error
  }

  if (partnership?.owner_user_id && typeof client.rpc === "function") {
    const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: partnership.owner_user_id, actor_id: userId })
    if (accessError && (options.strictBilling || !["PGRST202", "42883"].includes(accessError.code))) throw accessError
    if (!accessError && options.ownWhenDenied && typeof allowed !== "boolean") throw new Error("billing_access_check_unavailable")
    if (!accessError && !allowed) {
      if (options.strictBilling && !options.ownWhenDenied) throw new BillingAccessError()
      return { ownerUserId: userId, memberIds: [userId], partnershipId: null, partnerAccessDenied: true }
    }
  }

  return {
    ownerUserId: typeof partnership?.owner_user_id === "string" ? partnership.owner_user_id : userId,
    memberIds: [...new Set([userId, partnership?.user1_id, partnership?.user2_id].filter((id): id is string => typeof id === "string"))],
    partnershipId: typeof partnership?.id === "string" ? partnership.id : null,
    partnerAccessDenied: false,
  }
}

/** Preserve edits for a suspended shared binder as billing pauses, rather than unrelated-binder 404s. */
export async function assertCollectionWriteAccess(client: AnySupabaseClient, userId: string, requestedBinderId: unknown) {
  const { data: membership, error } = await client.from("partnerships").select("owner_user_id").or(`user1_id.eq.${userId},user2_id.eq.${userId}`).limit(1).maybeSingle()
  if (error) throw error
  const owner = membership?.owner_user_id
  if (!owner || owner === userId) return
  const { data: allowed, error: accessError } = await client.rpc("billing_partner_allowed", { owner_id: owner, actor_id: userId })
  if (accessError) {
    if (["PGRST202", "42883"].includes(accessError.code)) return
    throw accessError
  }
  if (allowed) return
  if (typeof requestedBinderId === "string" && requestedBinderId) {
    const { data: binder, error: binderError } = await client.from("binders").select("owner_user_id").eq("id", requestedBinderId).maybeSingle()
    if (binderError) throw binderError
    if (binder?.owner_user_id === userId) return
  }
  throw new BillingAccessError()
}
