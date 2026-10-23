"use client"

import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import BinderApp from "@/components/binder-app"
import { BinderSkeleton } from "@/components/binder-skeleton"
import { createClient } from "@/lib/supabase/client"
import { readLastOpenedBinder } from "@/lib/binders/client"
import { readOfflineBinderBoot, type OfflineBinderBoot } from "@/lib/offline-shell"

type ShellBoot = OfflineBinderBoot & { user: User | null }

/**
 * The binder booted from this device only: the session from the auth cookie (no network),
 * the collection snapshot and stored settings. The service worker serves this page when a
 * navigation can't reach the server, so the app opens offline or on a dead card-show Wi-Fi.
 * With several binders it opens the one in `?binder=` if it is saved on this device.
 */
export default function OfflineAppShell() {
  const [boot, setBoot] = useState<ShellBoot | null>(null)
  const [noticeVisible, setNoticeVisible] = useState(true)

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
      const requestedBinderId = new URLSearchParams(window.location.search).get("binder")
      setBoot({
        ...readOfflineBinderBoot(window.localStorage, document.cookie, user?.id ?? null, requestedBinderId, readLastOpenedBinder()),
        user,
      })
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!boot?.unavailableBinderName) return
    const timer = window.setTimeout(() => setNoticeVisible(false), 8000)
    return () => window.clearTimeout(timer)
  }, [boot?.unavailableBinderName])

  if (!boot) {
    return <BinderSkeleton />
  }

  return (
    <>
      <BinderApp
        key={boot.binderId ?? "binder"}
        initialUser={boot.user}
        initialBinders={boot.binders}
        initialBinderId={boot.binderId}
        initialCollection={boot.collection}
        initialCollectionOwnerUserId={boot.collectionOwnerUserId}
        initialSettings={boot.settings}
        initialHasStoredSettings={false}
        initialDarkMode={boot.darkMode}
      />
      {boot.unavailableBinderName && noticeVisible && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-clearance,5rem)+0.5rem)] z-50 flex justify-center px-3">
          <button
            type="button"
            role="status"
            onClick={() => setNoticeVisible(false)}
            className="pointer-events-auto max-w-sm rounded-2xl border border-amber-500/25 bg-card/95 px-3 py-2 text-left text-xs font-medium text-amber-700 shadow-lg backdrop-blur-xl dark:text-amber-200"
          >
            “{boot.unavailableBinderName}” isn&apos;t saved on this device yet, so it needs a connection. Showing your saved binder.
          </button>
        </div>
      )}
    </>
  )
}
