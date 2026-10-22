import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

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
