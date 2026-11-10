"use client"

import { useEffect } from "react"
import { LOCAL_COLLECTION_PENDING_OPS_KEY, LOCAL_COLLECTION_SNAPSHOT_KEY } from "@/lib/collection/offline-queue"
import { flushCollectionMirror, holdCollectionMirrorUntil } from "@/lib/offline-store/collection-mirror"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { extractLastKnownPrices, migrateLocalStorageToOfflineStore, saveLastKnownPrices } from "@/lib/offline-store/records"

// The price hook's localStorage cache (hooks/use-card-prices.ts). Read-only here: we copy last-known
// prices out of it so they stay readable offline, and never write it.
export const CARD_PRICE_CACHE_STORAGE_KEY = "binderdex_card_price_cache_v7"
const PRICE_MIRROR_INTERVAL_MS = 2 * 60 * 1000

/**
 * Keeps the IndexedDB offline store filled: migrates the localStorage collection once, copies last-known
 * prices every couple of minutes, and flushes pending writes when the page is hidden.
 */
export function useOfflineStoreSync(enabled = true, durableQueue = false) {
  useEffect(() => {
    if (!enabled) return
    const store = getOfflineStore()
    if (!store) return

    holdCollectionMirrorUntil(migrateLocalStorageToOfflineStore(window.localStorage, store, {
      snapshot: LOCAL_COLLECTION_SNAPSHOT_KEY,
      pendingOperations: durableQueue ? undefined : LOCAL_COLLECTION_PENDING_OPS_KEY,
    }).catch((error) => console.error("[holofolder] IndexedDB migration failed:", error)))

    const mirrorPrices = () => {
      let raw: string | null = null
      try {
        raw = window.localStorage.getItem(CARD_PRICE_CACHE_STORAGE_KEY)
      } catch {
        return
      }
      void saveLastKnownPrices(store, extractLastKnownPrices(raw)).catch(() => undefined)
    }

    const handleHidden = () => {
      if (document.visibilityState === "hidden") {
        mirrorPrices()
        void flushCollectionMirror(store)
      }
    }
    const handlePageHide = () => {
      mirrorPrices()
      void flushCollectionMirror(store)
    }

    const initialTimer = window.setTimeout(mirrorPrices, 5_000)
    const interval = window.setInterval(mirrorPrices, PRICE_MIRROR_INTERVAL_MS)
    document.addEventListener("visibilitychange", handleHidden)
    window.addEventListener("pagehide", handlePageHide)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleHidden)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [enabled, durableQueue])
}
