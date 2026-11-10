import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { BinderStart, type ServerBinderBoot } from "@/components/binder-start"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveActiveBinder } from "@/lib/server/binders"
import { ACTIVE_BINDER_COOKIE } from "@/lib/binders/model"
import { getDefaultBinderSettings } from "@/lib/settings"

const THEME_COOKIE = "binderdex_theme"

export const instant = false

interface PageProps {
  searchParams: Promise<{ binder?: string | string[] }>
}

async function loadServerBoot(searchParams: PageProps["searchParams"]): Promise<ServerBinderBoot> {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const user = await getSessionUser(supabase)

  // Signed-out visitors are redirected by the proxy; the client handles a session that ended since.
  if (!user) {
    return {
      initialUser: null,
      initialBinders: [],
      initialBinderId: null,
      initialCollection: [],
      initialCollectionOwnerUserId: null,
      initialSettings: getDefaultBinderSettings(),
      initialHasStoredSettings: false,
      initialDarkMode: true,
    }
  }

  const collectionOwnerUserId = await resolveCollectionOwnerUserId(supabase, user.id, { strictBilling: true })
  const requestedBinder = (await searchParams).binder
  const { binders, activeBinder } = await resolveActiveBinder(
    supabase,
    collectionOwnerUserId,
    typeof requestedBinder === "string" ? requestedBinder : null,
    cookieStore.get(ACTIVE_BINDER_COOKIE)?.value ?? null,
  )
  const { collection, settingsRow, settings, hasStoredSettings } = await loadBinderBootstrap(supabase, collectionOwnerUserId, activeBinder?.id ?? null, "native")
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value

  return {
    initialUser: user,
    initialBinders: binders,
    initialBinderId: activeBinder?.id ?? null,
    initialCollection: collection,
    initialCollectionOwnerUserId: collectionOwnerUserId,
    initialSettings: settings,
    initialHasStoredSettings: hasStoredSettings,
    initialDarkMode: settingsRow?.dark_mode ?? (themeCookie ? themeCookie !== "light" : true),
  }
}

// Not async: the binder skeleton is in the prerendered shell and paints at once. BinderStart then shows
// this device's saved binder, or the server's collection when it streams in.
export default function Page({ searchParams }: PageProps) {
  return <BinderStart serverBoot={loadServerBoot(searchParams)} />
}
