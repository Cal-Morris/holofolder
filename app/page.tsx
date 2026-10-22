import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import BinderApp from "@/components/binder-app"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveActiveBinder } from "@/lib/server/binders"
import { ACTIVE_BINDER_COOKIE } from "@/lib/binders/model"

const THEME_COOKIE = "binderdex_theme"

export const instant = false

interface PageProps {
  searchParams: Promise<{ binder?: string | string[] }>
}

export default async function Page({ searchParams }: PageProps) {
  const supabase = await createClient()
  const cookieStore = await cookies()

  const user = await getSessionUser(supabase)

  if (!user) {
    redirect("/home")
  }

  const collectionOwnerUserId = await resolveCollectionOwnerUserId(supabase, user.id, { fallbackOnError: true })
  const requestedBinder = (await searchParams).binder
  const { binders, activeBinder } = await resolveActiveBinder(
    supabase,
    collectionOwnerUserId,
    typeof requestedBinder === "string" ? requestedBinder : null,
    cookieStore.get(ACTIVE_BINDER_COOKIE)?.value ?? null,
  )
  const {
    collection: initialCollection,
    settingsRow,
    settings: initialSettings,
    hasStoredSettings,
  } = await loadBinderBootstrap(supabase, collectionOwnerUserId, activeBinder?.id ?? null)

  const themeCookie = cookieStore.get(THEME_COOKIE)?.value
  const initialDarkMode = settingsRow?.dark_mode ?? (themeCookie ? themeCookie !== "light" : true)

  return (
    <BinderApp
      key={activeBinder?.id ?? "binder"}
      initialUser={user}
      initialBinders={binders}
      initialBinderId={activeBinder?.id ?? null}
      initialCollection={initialCollection}
      initialCollectionOwnerUserId={collectionOwnerUserId}
      initialSettings={initialSettings}
      initialHasStoredSettings={hasStoredSettings}
      initialDarkMode={initialDarkMode}
    />
  )
}
