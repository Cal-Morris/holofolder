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

/** Loads the owner's collection and binder settings in parallel for the initial page render. */
export async function loadBinderBootstrap(client: AnySupabaseClient, ownerUserId: string): Promise<BinderBootstrap> {
  const [collectionResult, settingsResult] = await Promise.all([
    loadCollectionRows(client, ownerUserId),
    client
      .from("user_settings")
      .select("*")
      .eq("user_id", ownerUserId)
      .maybeSingle(),
  ])

  const settingsRow = (settingsResult?.data ?? null) as UserSettingsRow | null

  return {
    collection: collectionResult.data ?? [],
    collectionError: collectionResult.error ?? null,
    settingsRow,
    settings: settingsFromRow(settingsRow),
    hasStoredSettings: Boolean(settingsRow),
  }
}
