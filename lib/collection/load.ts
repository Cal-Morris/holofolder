import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import {
  collectionDeltaSince,
  createCollectionBaseline,
  mergeCollectionDelta,
  type CollectionSyncBaseline,
} from "@/lib/collection/delta-sync"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * Every collection row for one owner, ordered by Pokémon. Pages past PostgREST's 1000-row cap
 * ((user_id, pokemon_id) is unique, so the order is stable between pages).
 */
export function loadCollectionRows(client: AnySupabaseClient, ownerUserId: string) {
  return fetchAllRows<Record<string, unknown>>((from, to) =>
    client
      .from("pokemon_collection")
      .select("*")
      .eq("user_id", ownerUserId)
      .order("pokemon_id", { ascending: true })
      .range(from, to),
  )
}

/** Rows changed after `since` plus the owner's total row count; see lib/collection/delta-sync.ts. */
export async function loadCollectionChanges(client: AnySupabaseClient, ownerUserId: string, since: string) {
  const [changes, total] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) =>
      client
        .from("pokemon_collection")
        .select("*")
        .eq("user_id", ownerUserId)
        .gt("updated_at", since)
        .order("pokemon_id", { ascending: true })
        .range(from, to),
    ),
    client
      .from("pokemon_collection")
      .select("pokemon_id", { count: "exact", head: true })
      .eq("user_id", ownerUserId),
  ])

  return {
    data: changes.data,
    count: typeof total.count === "number" ? total.count : null,
    error: changes.error ?? total.error ?? null,
  }
}

/**
 * Brings the owner's server rows up to date: a delta read when the baseline allows it, otherwise (first load,
 * another owner, deletes, migration 035 not applied, any delta error) a full paged read. Throws on full-read errors.
 */
export async function syncCollectionRows(
  client: AnySupabaseClient,
  ownerUserId: string,
  baseline: CollectionSyncBaseline | null,
): Promise<CollectionSyncBaseline> {
  const since = collectionDeltaSince(baseline, ownerUserId)
  if (baseline && since) {
    const changes = await loadCollectionChanges(client, ownerUserId, since)
    if (!changes.error && changes.count !== null) {
      const merged = mergeCollectionDelta(baseline, changes.data, changes.count)
      if (merged) return merged
    }
  }

  const full = await loadCollectionRows(client, ownerUserId)
  if (full.error) throw full.error
  return createCollectionBaseline(ownerUserId, full.data)
}
