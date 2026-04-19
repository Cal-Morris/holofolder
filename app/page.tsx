import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import BinderApp from "@/components/binder-app"
import type { BinderSettings } from "@/hooks/use-settings"
import { DEFAULT_BINDER_COLOR_ID } from "@/lib/binder-colors"

const DEFAULT_BINDER_SETTINGS: BinderSettings = {
  binderRows: 4,
  binderCols: 4,
  binderColorId: DEFAULT_BINDER_COLOR_ID,
  binderPageColors: {},
  binderSlotGlareEnabled: true,
  darkMode: true,
}
const THEME_COOKIE = "binderdex_theme"

export const dynamic = "force-dynamic"

export default async function Page() {
  const supabase = await createClient()
  const cookieStore = await cookies()

  const { data: { user } } = await supabase.auth.getUser()

  const partnershipResult = user
    ? await supabase
        .from("partnerships")
        .select("owner_user_id")
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .limit(1)
        .maybeSingle()
    : { data: null as any }

  const collectionOwnerUserId = user
    ? partnershipResult.data?.owner_user_id ?? user.id
    : null

  const [collectionResult, settingsResult] = user
    ? await Promise.all([
        supabase
          .from("pokemon_collection")
          .select("*")
          .eq("user_id", collectionOwnerUserId)
          .order("pokemon_id", { ascending: true }),
        supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", collectionOwnerUserId)
          .maybeSingle(),
      ])
    : [{ data: [] as any[] }, { data: null as any }]

  const initialCollection = collectionResult.data ?? []
  const settingsRow = settingsResult?.data
  const initialSettings: BinderSettings = settingsRow
    ? {
        binderRows: settingsRow.binder_rows ?? DEFAULT_BINDER_SETTINGS.binderRows,
        binderCols: settingsRow.binder_cols ?? DEFAULT_BINDER_SETTINGS.binderCols,
        binderColorId: settingsRow.binder_color_id ?? DEFAULT_BINDER_SETTINGS.binderColorId,
        binderPageColors: settingsRow.binder_page_colors ?? DEFAULT_BINDER_SETTINGS.binderPageColors,
        binderSlotGlareEnabled: settingsRow.binder_slot_glare_enabled ?? DEFAULT_BINDER_SETTINGS.binderSlotGlareEnabled,
        darkMode: settingsRow.dark_mode ?? DEFAULT_BINDER_SETTINGS.darkMode,
      }
    : DEFAULT_BINDER_SETTINGS

  const themeCookie = cookieStore.get(THEME_COOKIE)?.value
  const initialDarkMode = settingsRow?.dark_mode ?? (themeCookie ? themeCookie !== "light" : true)

  return (
    <BinderApp
      initialUser={user}
      initialCollection={initialCollection}
      initialCollectionOwnerUserId={collectionOwnerUserId}
      initialSettings={initialSettings}
      initialHasStoredSettings={Boolean(settingsRow)}
      initialDarkMode={initialDarkMode}
    />
  )
}
