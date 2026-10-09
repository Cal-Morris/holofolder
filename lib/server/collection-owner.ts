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
  const { data: partnership, error } = await client
    .from("partnerships")
    .select("owner_user_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    if (options.fallbackOnError) return userId
    throw error
  }

  return (partnership as { owner_user_id?: string | null } | null)?.owner_user_id || userId
}
