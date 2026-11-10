"use client"

import { useEffect, useMemo, useLayoutEffect, useState } from "react"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { createSlotOfflineQueue, type SlotOfflineScope, type SlotOfflineRecord, type SlotReplayResult } from "@/lib/collection/slot-offline-queue"
import type { SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
import type { SlotLocalAcceptance } from "@/lib/binder-slot-editing"
import type { InventoryCatalogResolver, InventorySnapshot } from "@/lib/domain/inventory"

function sessionLifetime() {
  let active = false, epoch = 0
  return { activate: () => { active = true; return ++epoch }, close: () => { active = false; epoch++ },
    token: () => epoch, isActive: (token = epoch) => active && token === epoch }
}

/** Shared durable adapter. The actual browser host binds it behind denied production admission; the admitted host supplies its sender.
 * Remount on session changes, including unlink/relink to the same owner. */
export function useSlotOfflineQueue(scope: SlotOfflineScope, sessionId: string, authSessionId?: string) {
  const { deviceId, workspaceId, accountId, ownerUserId } = scope
  const session = useMemo(() => {
    const store = getOfflineStore()
    return { queue: store ? createSlotOfflineQueue(store, { deviceId, workspaceId, accountId, ownerUserId }) : null,
      ...sessionLifetime(), scope: { deviceId, workspaceId, accountId, ownerUserId }, sessionId }
  }, [deviceId, workspaceId, accountId, ownerUserId, sessionId])
  useLayoutEffect(() => { session.activate(); return () => session.close() }, [session])
  const active = (token = session.token()) => session.isActive(token)
  const [loaded, setLoaded] = useState<{ session: typeof session; record: SlotOfflineRecord | null; error: string | null } | null>(null)
  useEffect(() => {
    const token = session.token()
    const refresh = async () => {
      try {
        const record = await session.queue?.read() ?? null
        if (session.isActive(token)) setLoaded({ session, record, error: session.queue ? null : "durable-storage-unavailable" })
      } catch (error) {
        if (session.isActive(token)) setLoaded(previous => ({ session, record: previous?.session === session ? previous.record : null, error: error instanceof Error ? error.message : "durable-storage-unavailable" }))
      }
    }
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("binderdex-slot-intent-v1")
    if (channel) channel.onmessage = () => { void refresh() }
    window.addEventListener("focus", refresh)
    void refresh()
    return () => { channel?.close(); window.removeEventListener("focus", refresh) }
  }, [session])
  const refresh = async () => {
    if (!active() || !session.queue) throw new Error("inactive-or-unavailable-session")
    const record = await session.queue.read()
    if (active()) setLoaded({ session, record, error: null })
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("binderdex-slot-intent-v1")
    try { channel?.postMessage("changed") } finally { channel?.close() } // No private state in cross-tab messages.
  }
  return {
    record: loaded?.session === session ? loaded.record : null,
    error: loaded?.session === session ? loaded.error : null,
    queue: session.queue,
    async enqueue(intent: SlotOfflineIntent, catalog: InventoryCatalogResolver, planningBase?: InventorySnapshot, isCurrent: () => boolean = () => true) {
      if (!active() || !session.queue) throw new Error("inactive-or-unavailable-session")
      const token = session.token()
      await session.queue.enqueue(intent, catalog, planningBase, () => active(token) && isCurrent() ? session.scope : null, authSessionId)
      // Commit is irreversible acceptance even when a later read/notification fails.
      let refreshError: string | null = null
      if (active(token)) {
        try { await refresh() } catch {
          refreshError = "Saved on device. Could not refresh the view. Reopen or retry refresh."
          if (active(token)) setLoaded(previous => ({ session, record: previous?.session === session ? previous.record : null, error: refreshError }))
        }
      }
      return { status: "saved-on-device", operationId: intent.request.operationId, refreshError } satisfies SlotLocalAcceptance
    },
    async replay(send: (intent: SlotOfflineIntent) => Promise<SlotReplayResult>, catalog: InventoryCatalogResolver, readCurrent: () => Promise<unknown>, isCurrent: () => boolean = () => true) {
      if (!active() || !session.queue) return
      const token = session.token()
      await session.queue.replay(send, () => session.isActive(token) && isCurrent() ? session.scope : null, Date.now(), catalog, readCurrent)
      if (session.isActive(token)) await refresh()
    },
    async saveSnapshot(snapshot: unknown, catalog: InventoryCatalogResolver) {
      if (!active() || !session.queue) throw new Error("inactive-or-unavailable-session")
      const token = session.token()
      await session.queue.saveSnapshot(snapshot, catalog)
      if (active(token)) await refresh()
    },
    refresh,
  }
}
