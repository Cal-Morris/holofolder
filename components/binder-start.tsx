"use client"

import { Suspense, use, useEffect, useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { readDeviceStartupSession } from "@/lib/collection/native-startup"
import BinderApp from "@/components/binder-app"
import { BinderSkeleton } from "@/components/binder-skeleton"
import { readLocalBinderStart, writeBinderStartMarker, type LocalBinderStart } from "@/lib/binder-start"

type BinderAppProps = ComponentProps<typeof BinderApp>
export type ServerBinderBoot = Pick<
  BinderAppProps,
  "initialCollection" | "initialCollectionOwnerUserId" | "initialSettings" | "initialHasStoredSettings" | "initialDarkMode"
> &
  Required<Pick<BinderAppProps, "initialBinders" | "initialBinderId">> & { initialUser: User | null }

type LocalStart = LocalBinderStart & { user: User }

/**
 * Starts the binder from whichever arrives first: this device's saved binder (for the account and binder
 * the server last opened here) or the server's collection. The choice is kept, so the binder does not
 * remount; a local start then syncs with the server like /app-shell does. Until then, a skeleton.
 * Only the first render races: a later server boot (switching binder, a refresh) always comes from the server.
 */
export function BinderStart({ serverBoot }: { serverBoot: Promise<ServerBinderBoot> }) {
  const [firstBoot] = useState(serverBoot)
  const [start, setStart] = useState<{ source: "local"; boot: LocalStart } | { source: "server" } | null>(null)

  useEffect(() => {
    // Remember what the server opened, for the next start.
    let active = true
    serverBoot.then(
      (boot) => {
        if (boot.initialUser && boot.initialCollectionOwnerUserId) {
          writeBinderStartMarker(window.localStorage, {
            userId: boot.initialUser.id,
            ownerUserId: boot.initialCollectionOwnerUserId,
            binderId: boot.initialBinderId,
            binders: boot.initialBinders,
          })
        }
        if (active) setStart((current) => current ?? { source: "server" })
      },
      () => {
        if (active) setStart((current) => current ?? { source: "server" })
      },
    )
    return () => {
      active = false
    }
  }, [serverBoot])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        // The session from the auth cookie: no network unless the token needs a refresh.
        const { createClient } = await import("@/lib/supabase/client")
        const session = await readDeviceStartupSession(() => createClient().auth.getSession())
        const user = session?.user
        if (!active || !user) return
        const requestedBinderId = new URLSearchParams(window.location.search).get("binder")
        const local = readLocalBinderStart(window.localStorage, document.cookie, user.id, requestedBinderId)
        if (local) setStart((current) => current ?? { source: "local", boot: { ...local, user } })
      } catch {
        // Fall back to the server's collection.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  if (start?.source === "local" && serverBoot === firstBoot) {
    const { boot } = start
    const legacyProps = { initialUser: boot.user, initialBinders: boot.binders, initialBinderId: boot.binderId, initialCollection: boot.collection,
      initialCollectionOwnerUserId: boot.collectionOwnerUserId, initialSettings: boot.settings, initialHasStoredSettings: false, initialDarkMode: boot.darkMode }
    return (
      <BinderApp {...legacyProps} key={boot.binderId ?? "binder"} />
    )
  }

  if (start || serverBoot !== firstBoot) {
    return (
      <Suspense fallback={<BinderSkeleton />}>
        <ServerStartedBinder serverBoot={serverBoot} />
      </Suspense>
    )
  }

  return <BinderSkeleton />
}

function ServerStartedBinder({ serverBoot }: { serverBoot: Promise<ServerBinderBoot> }) {
  const boot = use(serverBoot)
  const router = useRouter()
  const signedOut = !boot.initialUser

  useEffect(() => {
    // The proxy redirects signed-out visitors before this page; this covers a session that ended in between.
    if (signedOut) router.replace("/auth/login")
  }, [router, signedOut])

  if (signedOut) return <BinderSkeleton />
  return <BinderApp key={boot.initialBinderId ?? "binder"} {...boot} />
}
