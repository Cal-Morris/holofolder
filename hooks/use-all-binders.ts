"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"
import { getOfflineStore } from "@/lib/offline-store/kv"
import {
  buildAllBindersLookup,
  groupRowsByBinder,
  readAllBindersCache,
  writeAllBindersCache,
  type AllBindersLookup,
} from "@/lib/binders/all-binders"
import type { Binder } from "@/lib/binders/model"
import type { CollectedPokemon } from "@/lib/domain/cards"

const REFRESH_AFTER_MS = 60_000
const FIRST_READ_DELAY_MS = 1_500
const CACHE_WRITE_DELAY_MS = 2_000

interface Options {
  ownerUserId: string | null
  binders: readonly Binder[]
  currentBinderId: string | null
  currentCollection: readonly CollectedPokemon[]
  isOnline: boolean
}

/**
 * Read-only lookup across every binder of the owner (a partner resolves to the owner, so sees the same).
 * Only runs with two or more binders. Other binders come from one read of their rows (never the open binder's,
 * which is live already), refreshed on focus at most once a minute, and are cached in IndexedDB for offline use.
 */
export function useAllBinders({ ownerUserId, binders, currentBinderId, currentCollection, isOnline }: Options): AllBindersLookup | null {
  const enabled = Boolean(ownerUserId && currentBinderId && binders.length > 1)
  const [others, setOthers] = useState<{ ownerUserId: string; collections: Record<string, CollectedPokemon[]> } | null>(null)
  const lastReadAt = useRef(0)
  const binderKey = binders.map(binder => binder.id).join(",")

  // Cached copy first, so the hints work offline and before the first read.
  useEffect(() => {
    if (!enabled || !ownerUserId) return
    let cancelled = false
    void readAllBindersCache(getOfflineStore(), ownerUserId).then(cache => {
      if (cancelled || !cache) return
      setOthers(previous => previous?.ownerUserId === ownerUserId ? previous : { ownerUserId, collections: cache.collections })
    })
    return () => { cancelled = true }
  }, [enabled, ownerUserId])

  const read = useCallback(async () => {
    if (!enabled || !ownerUserId || !currentBinderId) return
    lastReadAt.current = Date.now()
    const client = createClient()
    const { data, error } = await fetchAllRows<Record<string, unknown>>((from, to) =>
      client.from("pokemon_collection").select("*")
        .eq("user_id", ownerUserId)
        .neq("binder_id", currentBinderId)
        .order("binder_id", { ascending: true })
        .order("pokemon_id", { ascending: true })
        .range(from, to))
    if (error) return
    setOthers({ ownerUserId, collections: groupRowsByBinder(data) })
  }, [currentBinderId, enabled, ownerUserId])

  useEffect(() => {
    if (!enabled || !isOnline) return
    const timer = window.setTimeout(() => { void read() }, lastReadAt.current ? 0 : FIRST_READ_DELAY_MS)
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - lastReadAt.current > REFRESH_AFTER_MS) void read()
    }
    document.addEventListener("visibilitychange", onFocus)
    window.addEventListener("focus", onFocus)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("focus", onFocus)
    }
    // binderKey: a created or deleted binder is read again.
  }, [binderKey, enabled, isOnline, read])

  const lookup = useMemo(() => {
    if (!enabled) return null
    const collections = others?.ownerUserId === ownerUserId ? others.collections : null
    return buildAllBindersLookup({ binders, currentBinderId, currentCollection, others: collections })
  }, [binders, currentBinderId, currentCollection, enabled, others, ownerUserId])

  // Keep the offline copy current: the other binders as last read plus the open binder as it is now.
  useEffect(() => {
    if (!enabled || !ownerUserId || !currentBinderId || !others || others.ownerUserId !== ownerUserId) return
    const timer = window.setTimeout(() => {
      const collections: Record<string, CollectedPokemon[]> = {}
      for (const binder of binders) {
        collections[binder.id] = binder.id === currentBinderId ? [...currentCollection] : others.collections[binder.id] ?? []
      }
      void writeAllBindersCache(getOfflineStore(), { ownerUserId, savedAt: new Date().toISOString(), collections })
    }, CACHE_WRITE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [binders, currentBinderId, currentCollection, enabled, others, ownerUserId])

  return lookup
}
