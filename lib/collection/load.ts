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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CollectionQuery = any

/**
 * Rows of one binder (or, with no binder id, every row of the owner: the pre-039 single-binder layout).
 * Rows are always filtered by owner too, so a binder id can never reach another owner's rows.
 */
export function scopeCollectionQuery<Query>(query: Query, ownerUserId: string, binderId?: string | null): Query {
  const owned = (query as CollectionQuery).eq("user_id", ownerUserId)
  return binderId ? owned.eq("binder_id", binderId) : owned
}

/**
 * Every collection row of one binder, ordered by Pokémon. Pages past PostgREST's 1000-row cap
 * ((binder_id, pokemon_id) is unique, so the order is stable between pages).
 */
export function loadCollectionRows(client: AnySupabaseClient, ownerUserId: string, binderId?: string | null) {
  return fetchAllRows<Record<string, unknown>>((from, to) =>
    scopeCollectionQuery(client.from("pokemon_collection").select("*"), ownerUserId, binderId)
      .order("pokemon_id", { ascending: true })
      .range(from, to),
  )
}

/** Rows changed after `since` plus the owner's total row count; see lib/collection/delta-sync.ts. */
export async function loadCollectionChanges(client: AnySupabaseClient, ownerUserId: string, since: string, binderId?: string | null) {
  const [changes, total] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) =>
      scopeCollectionQuery(client.from("pokemon_collection").select("*"), ownerUserId, binderId)
        .gt("updated_at", since)
        .order("pokemon_id", { ascending: true })
        .range(from, to),
    ),
    scopeCollectionQuery(client.from("pokemon_collection").select("pokemon_id", { count: "exact", head: true }), ownerUserId, binderId),
  ])

  return {
    data: changes.data,
    count: typeof total.count === "number" ? total.count : null,
    error: changes.error ?? total.error ?? null,
  }
}

/**
 * Brings the owner's server rows up to date: a delta read when the baseline allows it, otherwise (first load,
 * another owner or binder, deletes, migration 035 not applied, any delta error) a full paged read. Throws on full-read errors.
 */
export async function syncCollectionRows(
  client: AnySupabaseClient,
  ownerUserId: string,
  baseline: CollectionSyncBaseline | null,
  binderId: string | null = null,
): Promise<CollectionSyncBaseline> {
  const since = collectionDeltaSince(baseline, ownerUserId, binderId)
  if (baseline && since) {
    const changes = await loadCollectionChanges(client, ownerUserId, since, binderId)
    if (!changes.error && changes.count !== null) {
      const merged = mergeCollectionDelta(baseline, changes.data, changes.count)
      if (merged) return merged
    }
  }

  const full = await loadCollectionRows(client, ownerUserId, binderId)
  if (full.error) throw full.error
  return createCollectionBaseline(ownerUserId, full.data, binderId)
}
