import type { SupabaseClient } from "@supabase/supabase-js"
import { settingsFromRow, type BinderSettings, type UserSettingsRow } from "@/lib/settings"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

export interface BinderBootstrap {
  settingsRow: UserSettingsRow | null
  settings: BinderSettings
  hasStoredSettings: boolean
}

/** The owner's settings. Callers apply the active binder's grid from the binder list they already read. */
export async function loadBinderBootstrap(client: AnySupabaseClient, ownerUserId: string): Promise<BinderBootstrap> {
  const { data } = await client.from("user_settings").select("*").eq("user_id", ownerUserId).maybeSingle()
  const settingsRow = (data ?? null) as UserSettingsRow | null

  return {
    settingsRow,
    settings: settingsFromRow(settingsRow),
    hasStoredSettings: Boolean(settingsRow),
  }
}
