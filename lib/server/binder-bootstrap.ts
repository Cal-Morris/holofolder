import { withBinderLayout } from "@/lib/binder-layout"
import type { SupabaseClient } from "@supabase/supabase-js"
import { loadCollectionRows } from "@/lib/collection/load"
import { settingsFromRow, type BinderSettings, type UserSettingsRow } from "@/lib/settings"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

export interface BinderBootstrap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collection: any[]
  collectionError: unknown
  settingsRow: UserSettingsRow | null
  settings: BinderSettings
  hasStoredSettings: boolean
}

/**
 * Loads one binder's collection and the owner's binder settings in parallel for the initial page render.
 * No binder id: every row of the owner (single-binder layout, before migration 039).
 */
export async function loadBinderBootstrap(client: AnySupabaseClient, ownerUserId: string, binderId: string | null = null, source: "native" | "legacy" = "legacy"): Promise<BinderBootstrap> {
  const [collectionResult, settingsResult, binderResult] = await Promise.all([
    // Native inventory is loaded only by the checked complete-read host, never legacy rows.
    source === "legacy" ? loadCollectionRows(client, ownerUserId, binderId) : { data: [], error: null },
    client
      .from("user_settings")
      .select("*")
      .eq("user_id", ownerUserId)
      .maybeSingle(),
    binderId ? client.from("binders").select("binder_rows,binder_cols").eq("owner_user_id", ownerUserId).eq("id", binderId).maybeSingle() : null,
  ])

  const settingsRow = (settingsResult?.data ?? null) as UserSettingsRow | null

  return {
    collection: collectionResult.data ?? [],
    collectionError: collectionResult.error ?? null,
    settingsRow,
    settings: withBinderLayout(settingsFromRow(settingsRow), binderResult?.data ? { rows: binderResult.data.binder_rows, cols: binderResult.data.binder_cols } : null),
    hasStoredSettings: Boolean(settingsRow),
  }
}
