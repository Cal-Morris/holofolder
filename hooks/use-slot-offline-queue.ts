"use client"

import { useEffect, useMemo, useState } from "react"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { createSlotOfflineQueue, type SlotOfflineScope, type SlotOfflineRecord, type SlotReplayResult } from "@/lib/collection/slot-offline-queue"
import type { SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"

function sessionLifetime() {
  let active = false, epoch = 0
  return { activate: () => { active = true; return ++epoch }, close: () => { active = false; epoch++ },
    token: () => epoch, isActive: (token = epoch) => active && token === epoch }
}

/** Staged adapter only. No current browse/bootstrap path imports this hook, and no automatic upload.
 * Remount on session changes, including unlink/relink to the same owner. */
export function useSlotOfflineQueue(scope: SlotOfflineScope, sessionId: string) {
  const { deviceId, workspaceId, accountId, ownerUserId } = scope
  const session = useMemo(() => {
    const store = getOfflineStore()
    return { queue: store ? createSlotOfflineQueue(store, { deviceId, workspaceId, accountId, ownerUserId }) : null,
      ...sessionLifetime(), scope: { deviceId, workspaceId, accountId, ownerUserId }, sessionId }
  }, [deviceId, workspaceId, accountId, ownerUserId, sessionId])
  const [loaded, setLoaded] = useState<{ session: typeof session; record: SlotOfflineRecord | null; error: string | null } | null>(null)
  useEffect(() => {
    const token = session.activate()
    const refresh = async () => {
      try {
        const record = await session.queue?.read() ?? null
        if (session.isActive(token)) setLoaded({ session, record, error: session.queue ? null : "durable-storage-unavailable" })
      } catch (error) {
        if (session.isActive(token)) setLoaded({ session, record: null, error: error instanceof Error ? error.message : "durable-storage-unavailable" })
      }
    }
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("binderdex-slot-intent-v1")
    if (channel) channel.onmessage = () => { void refresh() }
    window.addEventListener("focus", refresh)
    void refresh()
    return () => { session.close(); channel?.close(); window.removeEventListener("focus", refresh) }
  }, [session])
  const refresh = async () => {
    if (!session.isActive() || !session.queue) throw new Error("inactive-or-unavailable-session")
    const record = await session.queue.read()
    if (session.isActive()) setLoaded({ session, record, error: null })
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("binderdex-slot-intent-v1")
    channel?.postMessage("changed"); channel?.close() // No private state in cross-tab messages.
  }
  return {
    record: loaded?.session === session ? loaded.record : null,
    error: loaded?.session === session ? loaded.error : null,
    queue: session.queue,
    async enqueue(intent: SlotOfflineIntent, catalog: InventoryCatalogResolver) {
      if (!session.isActive() || !session.queue) throw new Error("inactive-or-unavailable-session")
      await session.queue.enqueue(intent, catalog); await refresh()
    },
    async replay(send: (intent: SlotOfflineIntent) => Promise<SlotReplayResult>, catalog: InventoryCatalogResolver) {
      if (!session.isActive() || !session.queue) return
      const token = session.token()
      await session.queue.replay(send, () => session.isActive(token) ? session.scope : null, Date.now(), catalog)
      if (session.isActive(token)) await refresh()
    },
    refresh,
  }
}
