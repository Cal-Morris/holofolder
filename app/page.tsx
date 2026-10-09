import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import BinderApp from "@/components/binder-app"
import { settingsFromRow, type BinderSettings } from "@/lib/settings"

const THEME_COOKIE = "binderdex_theme"

export const instant = false

export default async function Page() {
  const supabase = await createClient()
  const cookieStore = await cookies()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/home")
  }

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
  const initialSettings: BinderSettings = settingsFromRow(settingsRow)

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
