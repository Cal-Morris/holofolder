import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { BinderStart, type ServerBinderBoot } from "@/components/binder-start"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveActiveBinder } from "@/lib/server/binders"
import { Suspense } from "react"
import { BinderSkeleton } from "@/components/binder-skeleton"
import { ACTIVE_BINDER_COOKIE, BINDER_GRID_COOKIE, parseBinderGrid } from "@/lib/binders/model"
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

  const empty = {
    initialUser: null,
    initialBinders: [],
    initialBinderId: null,
    initialCollection: [],
    initialCollectionOwnerUserId: null,
    initialSettings: getDefaultBinderSettings(),
    initialHasStoredSettings: false,
    initialDarkMode: true,
  } satisfies ServerBinderBoot
  // Signed-out visitors are redirected by the proxy; the client handles a session that ended since.
  if (!user) return empty

  let collectionOwnerUserId: string
  try {
    // A paused partner opens their own collection, as storage_execute_v1 does.
    collectionOwnerUserId = (await resolveCollectionMembership(supabase, user.id, { strictBilling: true, ownWhenDenied: true })).ownerUserId
  } catch {
    // No owner hint: the client's own fresh check opens the right scope, or offers a retry.
    return { ...empty, initialUser: user, initialDarkMode: cookieStore.get(THEME_COOKIE)?.value !== "light" }
  }
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

// Not async: the binder skeleton is in the prerendered shell and paints at once. The request then streams
// it again with the pockets of the binder this device opened last (a cookie, so no data is read for it), and
// BinderStart shows this device's saved binder, or the server's collection when that arrives.
export default function Page({ searchParams }: PageProps) {
  const startGrid = cookies().then(store => parseBinderGrid(store.get(BINDER_GRID_COOKIE)?.value))
  return <Suspense fallback={<BinderSkeleton />}><BinderStart serverBoot={loadServerBoot(searchParams)} startGrid={startGrid} /></Suspense>
}
