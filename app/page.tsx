import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import BinderApp from "@/components/binder-app"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"

const THEME_COOKIE = "binderdex_theme"

export const instant = false

export default async function Page() {
  const supabase = await createClient()
  const cookieStore = await cookies()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/home")
  }

  const collectionOwnerUserId = await resolveCollectionOwnerUserId(supabase, user.id, { fallbackOnError: true })
  const {
    collection: initialCollection,
    settingsRow,
    settings: initialSettings,
    hasStoredSettings,
  } = await loadBinderBootstrap(supabase, collectionOwnerUserId)

  const themeCookie = cookieStore.get(THEME_COOKIE)?.value
  const initialDarkMode = settingsRow?.dark_mode ?? (themeCookie ? themeCookie !== "light" : true)

  return (
    <BinderApp
      initialUser={user}
      initialCollection={initialCollection}
      initialCollectionOwnerUserId={collectionOwnerUserId}
      initialSettings={initialSettings}
      initialHasStoredSettings={hasStoredSettings}
      initialDarkMode={initialDarkMode}
    />
  )
}
