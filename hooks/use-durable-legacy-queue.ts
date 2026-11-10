"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { createLegacyQueueRuntime, type LegacyQueueRuntime } from "@/lib/collection/legacy-queue-runtime"
import type { CollectionOrigin } from "@/lib/collection/recipient"

/** The caller is admitted by the existing server-only loopback harness gate. Production passes false. */
export function useDurableLegacyQueue(enabled: boolean, origin: CollectionOrigin | null, identity: string, authenticatedActor: { current: string | null }, onError: (message: string) => void) {
  const [runtime, setRuntime] = useState<LegacyQueueRuntime | null>(null)
  const [scopeGeneration, setScopeGeneration] = useState(0)
  const [guest, setGuest] = useState<Extract<CollectionOrigin, { kind: "guest" }> | null>(null)
  const [, update] = useState(0)
  const originKey = JSON.stringify(origin)
  const context = useRef<{ session: string; origin: CollectionOrigin } | null>(null)
  const errors = useRef(onError)
  useLayoutEffect(() => { errors.current = onError })
  useLayoutEffect(() => {
    context.current = enabled && originKey !== "null" ? { session: crypto.randomUUID(), origin: JSON.parse(originKey) } : null
    return () => { context.current = null }
  }, [enabled, identity, originKey, scopeGeneration])
  useEffect(() => {
    if (!enabled) return
    const invalidate = () => { context.current = null; setScopeGeneration(n => n + 1) }
    window.addEventListener("holofolder-legacy-scope-changed", invalidate)
    return () => window.removeEventListener("holofolder-legacy-scope-changed", invalidate)
  }, [enabled])
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let ready = false
    const store = getOfflineStore()
    if (!store) { errors.current("Device storage is unavailable. Changes cannot be saved or sent."); return }
    const instance = createLegacyQueueRuntime(store, () => {
      const value = context.current
      return value && (value.origin.kind === "guest" ? authenticatedActor.current === null : authenticatedActor.current === value.origin.actorUserId) ? value : null
    }, fetch, () => {
      if (stopped) return
      window.dispatchEvent(new Event("holofolder-legacy-queue-changed"))
      try { channel?.postMessage("changed") } catch { /* Notifications never authorize a mutation. */ }
    })
    let channel: BroadcastChannel | null = null
    try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel("holofolder-legacy-queue-v2") } catch { /* IDB fences remain authoritative without notifications. */ }
    const failed = (error: unknown) => { if (error instanceof Error && error.message === "queue_session_changed") return; if (!stopped) errors.current("Device storage could not save these changes. The original data is retained; no new request was sent.") }
    const initialized = instance.initialize(window.localStorage)
    const reload = () => { void instance.refresh().then(() => { if (!stopped) { update(n => n + 1); window.dispatchEvent(new Event("holofolder-legacy-view-changed")) } }).catch(failed) }
    const observe = (values: (string | null)[] = []) => {
      try {
        const captured = [...values, window.localStorage.getItem("pokemon_collection_pending_ops_v1")]
        void initialized.then(() => instance.observe(window.localStorage, captured)).catch(failed)
      } catch (error) { failed(error) }
    }
    const storage = (event: StorageEvent) => { if (!event.key || event.key === "pokemon_collection_pending_ops_v1") observe([event.oldValue, event.newValue]) }
    const resume = () => { if (document.visibilityState !== "hidden") observe() }
    void (async () => {
      await initialized
      const guestOrigin = await instance.queue.guestOrigin(null, window.localStorage.getItem("pokemon_collection_guest_workspace_v1"))
      if (stopped) return
      setGuest(guestOrigin); setRuntime(instance); ready = true
      await instance.observe(window.localStorage)
      if (stopped) return
      update(n => n + 1); window.dispatchEvent(new Event("holofolder-legacy-view-changed"))
    })().catch(failed)
    const changed = () => { if (ready) reload() }
    window.addEventListener("storage", storage)
    window.addEventListener("pageshow", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("holofolder-legacy-queue-changed", changed)
    if (channel) channel.onmessage = reload
    return () => {
      stopped = true; channel?.close()
      window.removeEventListener("storage", storage); window.removeEventListener("pageshow", resume); window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", resume); window.removeEventListener("holofolder-legacy-queue-changed", changed)
    }
  }, [enabled, authenticatedActor])
  useEffect(() => { if (runtime) void runtime.refresh().then(() => { update(n => n + 1); window.dispatchEvent(new Event("holofolder-legacy-view-changed")) }).catch(() => {}) }, [runtime, identity, originKey, scopeGeneration])
  return { runtime, guest, view: runtime?.view() ?? null }
}
