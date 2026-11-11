import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { BinderStart, type ServerBinderBoot } from "@/components/binder-start"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveActiveBinder } from "@/lib/server/binders"
import { ACTIVE_BINDER_COOKIE } from "@/lib/binders/model"
import { getDefaultBinderSettings } from "@/lib/settings"
import { withBinderLayout } from "@/lib/binder-layout"

const THEME_COOKIE = "binderdex_theme"

export const instant = false

interface PageProps {
  // binderSlug/view/page come from the /<slug>/binder/<page> rewrite in next.config.mjs.
  searchParams: Promise<{ binder?: string | string[]; binderSlug?: string | string[] }>
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
  const { binder: requestedId, binderSlug } = await searchParams
  const requested = typeof requestedId === "string" ? requestedId : typeof binderSlug === "string" ? binderSlug : null
  // Settings don't depend on which binder opens; the binder list already carries each grid.
  const [{ binders, activeBinder }, bootstrap] = await Promise.all([
    resolveActiveBinder(supabase, collectionOwnerUserId, requested, cookieStore.get(ACTIVE_BINDER_COOKIE)?.value ?? null),
    loadBinderBootstrap(supabase, collectionOwnerUserId),
  ])
  const { settingsRow, hasStoredSettings } = bootstrap
  const settings = withBinderLayout(bootstrap.settings, activeBinder)
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value

  return {
    initialUser: user,
    initialBinders: binders,
    initialBinderId: activeBinder?.id ?? null,
    initialCollection: [],
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
