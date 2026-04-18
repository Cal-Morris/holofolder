import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import BinderApp from "@/components/binder-app"
import type { BinderSettings } from "@/hooks/use-settings"

const DEFAULT_BINDER_SETTINGS: BinderSettings = { binderRows: 4, binderCols: 4 }
const THEME_COOKIE = "binderdex_theme"

export const dynamic = "force-dynamic"

export default async function Page() {
  const supabase = await createClient()
  const cookieStore = await cookies()

  const { data: { user } } = await supabase.auth.getUser()

  const [collectionResult, settingsResult] = user
    ? await Promise.all([
        supabase
          .from("pokemon_collection")
          .select("*")
          .eq("user_id", user.id)
          .order("pokemon_id", { ascending: true }),
        supabase
          .from("user_settings")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      ])
    : [{ data: [] as any[] }, { data: null as any }]

  const initialCollection = collectionResult.data ?? []
  const settingsRow = settingsResult?.data
  const initialSettings: BinderSettings = settingsRow
    ? {
        binderRows: settingsRow.binder_rows ?? DEFAULT_BINDER_SETTINGS.binderRows,
        binderCols: settingsRow.binder_cols ?? DEFAULT_BINDER_SETTINGS.binderCols,
      }
    : DEFAULT_BINDER_SETTINGS

  const themeCookie = cookieStore.get(THEME_COOKIE)?.value
  const initialDarkMode = themeCookie ? themeCookie !== "light" : true

  return (
    <BinderApp
      initialUser={user}
      initialCollection={initialCollection}
      initialSettings={initialSettings}
      initialDarkMode={initialDarkMode}
    />
  )
}
