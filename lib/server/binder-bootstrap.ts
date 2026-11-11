import { withBinderLayout } from "@/lib/binder-layout"
import type { SupabaseClient } from "@supabase/supabase-js"
import { settingsFromRow, type BinderSettings, type UserSettingsRow } from "@/lib/settings"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

export interface BinderBootstrap {
  settingsRow: UserSettingsRow | null
  settings: BinderSettings
  hasStoredSettings: boolean
}

/** The owner's settings and, with a binder id, that binder's grid. Inventory comes from the native read. */
export async function loadBinderBootstrap(client: AnySupabaseClient, ownerUserId: string, binderId: string | null = null): Promise<BinderBootstrap> {
  const [settingsResult, binderResult] = await Promise.all([
    client
      .from("user_settings")
      .select("*")
      .eq("user_id", ownerUserId)
      .maybeSingle(),
    binderId ? client.from("binders").select("binder_rows,binder_cols").eq("owner_user_id", ownerUserId).eq("id", binderId).maybeSingle() : null,
  ])

  const settingsRow = (settingsResult?.data ?? null) as UserSettingsRow | null

  return {
    settingsRow,
    settings: withBinderLayout(settingsFromRow(settingsRow), binderResult?.data ? { rows: binderResult.data.binder_rows, cols: binderResult.data.binder_cols } : null),
    hasStoredSettings: Boolean(settingsRow),
  }
}
