import type { SupabaseClient } from "@supabase/supabase-js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

interface ResolveCollectionOwnerOptions {
  /** When the partnership lookup fails, use the user's own id instead of throwing. */
  fallbackOnError?: boolean
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
    if (options.fallbackOnError) return { ownerUserId: userId, memberIds: [userId], partnershipId: null }
    throw error
  }

  return {
    ownerUserId: typeof partnership?.owner_user_id === "string" ? partnership.owner_user_id : userId,
    memberIds: [...new Set([userId, partnership?.user1_id, partnership?.user2_id].filter((id): id is string => typeof id === "string"))],
    partnershipId: typeof partnership?.id === "string" ? partnership.id : null,
  }
}
