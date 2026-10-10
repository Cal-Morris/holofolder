"use client"

import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import BinderApp from "@/components/binder-app"
import { createClient } from "@/lib/supabase/client"
import { readOfflineShellState, type OfflineShellState } from "@/lib/offline-shell"

type ShellBoot = OfflineShellState & { user: User | null }

/**
 * The binder booted from this device only: the session from the auth cookie (no network),
 * the collection snapshot and stored settings. The service worker serves this page when a
 * navigation can't reach the server, so the app opens offline or on a dead card-show Wi-Fi.
 */
export default function OfflineAppShell() {
  const [boot, setBoot] = useState<ShellBoot | null>(null)

  useEffect(() => {
    let cancelled = false

    const start = async () => {
      let user: User | null = null
      try {
        const { data } = await createClient().auth.getSession()
        user = data.session?.user ?? null
      } catch {
        user = null
      }
      if (cancelled) return
      setBoot({ ...readOfflineShellState(window.localStorage, document.cookie, user?.id ?? null), user })
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [])

  if (!boot) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground" aria-busy="true">
        Opening your binder…
      </main>
    )
  }

  return (
    <BinderApp
      initialUser={boot.user}
      initialCollection={boot.collection}
      initialCollectionOwnerUserId={boot.collectionOwnerUserId}
      initialSettings={boot.settings}
      initialHasStoredSettings={false}
      initialDarkMode={boot.darkMode}
    />
  )
}
