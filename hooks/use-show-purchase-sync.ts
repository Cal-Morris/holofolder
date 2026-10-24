"use client"

// Keeps this device's show purchases (hooks/use-show-session.ts) in step with the account's purchase log
// (public.show_purchases, lib/show-purchase-sync.ts). Purchases are queued on the device and sent when online;
// the log belongs to the collection owner, so a shared partner sees the same tally.
import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { SHOW_SESSION_EVENT } from "@/lib/show-session"
import { SHOW_PURCHASE_COLUMNS, syncShowPurchases, type ShowPurchaseRemote } from "@/lib/show-purchase-sync"
import { showPurchaseStore } from "@/hooks/use-show-session"

/** How often a partner's purchases are picked up while Show mode is on. */
const SHOW_MODE_POLL_MS = 60_000
const LOCAL_CHANGE_DELAY_MS = 400

function supabaseRemote(ownerUserId: string): ShowPurchaseRemote {
  const table = () => createClient().from("show_purchases")
  return {
    async insert(rows) {
      const { error } = await table().upsert(rows, { onConflict: "owner_user_id,client_id", ignoreDuplicates: true })
      if (error) throw error
    },
    async remove(clientIds) {
      const { error } = await table().delete().eq("owner_user_id", ownerUserId).in("client_id", clientIds)
      if (error) throw error
    },
    async listSince(sinceIso) {
      const { data, error } = await table()
        .select(SHOW_PURCHASE_COLUMNS)
        .eq("owner_user_id", ownerUserId)
        .gte("bought_at", sinceIso)
        .order("bought_at", { ascending: true })
        .limit(500)
      if (error) throw error
      return data ?? []
    },
  }
}

export function useShowPurchaseSync({ ownerUserId, isOnline, isShowModeOn }: {
  /** The collection owner (yourself, or the partner whose binders you share); null when signed out or read-only. */
  ownerUserId: string | null
  isOnline: boolean
  isShowModeOn: boolean
}) {
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  useEffect(() => {
    if (!ownerUserId || !isOnline) return
    let cancelled = false
    const remote = supabaseRemote(ownerUserId)
    const run = () => {
      if (cancelled) return
      if (running.current) {
        again.current = true
        return
      }
      running.current = (async () => {
        try {
          showPurchaseStore.ensureQueue(Date.now())
          await syncShowPurchases({ remote, store: showPurchaseStore, ownerUserId })
        } catch {
          // Offline, signed out or the table isn't there yet: the queue stays and the next sync retries.
        } finally {
          running.current = null
          if (again.current && !cancelled) {
            again.current = false
            run()
          }
        }
      })()
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(run, LOCAL_CHANGE_DELAY_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") run()
    }
    run()
    window.addEventListener(SHOW_SESSION_EVENT, soon)
    window.addEventListener("online", run)
    document.addEventListener("visibilitychange", onVisible)
    const poll = isShowModeOn ? setInterval(() => document.visibilityState === "visible" && run(), SHOW_MODE_POLL_MS) : undefined
    return () => {
      cancelled = true
      clearTimeout(timer)
      clearInterval(poll)
      window.removeEventListener(SHOW_SESSION_EVENT, soon)
      window.removeEventListener("online", run)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [isOnline, isShowModeOn, ownerUserId])
}
