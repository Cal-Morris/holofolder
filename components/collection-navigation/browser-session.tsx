"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import CollectionNavigationHost, { type NavigationSurface } from "./navigation-host"
import { useSlotOfflineQueue } from "@/hooks/use-slot-offline-queue"
import { readCurrentCollectionNavigation } from "@/lib/collection/inventory-navigation-read"
import { parseNavigationEvidence, sameInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { CollectionNavigationRead } from "@/lib/collection-navigation"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { browserHostCatalog } from "@/lib/collection/browser-host-catalog"
import type { SlotDisplayInput } from "@/lib/binder-display-model"
import type { SlotCommandSink } from "@/lib/binder-slot-editing"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"

export interface BrowserSurfaceBinding {
  surface: NavigationSurface
  display?: SlotDisplayInput
  catalog: InventoryCatalogResolver
  receive: SlotCommandSink
  pending: number
}
export default function BrowserCollectionSession({ scope, currentScope, renderSurface, renderFallback, initialBinderId }: {
  initialBinderId: string | null
  renderFallback: () => ReactNode
  scope: InventoryReadScope
  currentScope: () => InventoryReadScope | null
  renderSurface: (binding: BrowserSurfaceBinding) => ReactNode
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  useEffect(() => {
    try {
      const key = "holofolder-slot-device-v1"
      let id = localStorage.getItem(key)
      if (!isSlotContractId(id)) { id = crypto.randomUUID(); localStorage.setItem(key, id) }
      queueMicrotask(() => setDeviceId(id))
    } catch { /* No durable identity means no native admission on this device. */ }
  }, [])
  if (!deviceId) return renderFallback()
  return <ScopedBrowserSession key={JSON.stringify([deviceId, scope.actorUserId, scope.ownerUserId, scope.authSessionId, scope.sessionId])}
    {...{ scope, currentScope, renderSurface, deviceId, initialBinderId }} />
}
function ScopedBrowserSession({ scope, currentScope, renderSurface, deviceId, initialBinderId }: {
  initialBinderId: string | null
  scope: InventoryReadScope; currentScope: () => InventoryReadScope | null; deviceId: string
  renderSurface: (binding: BrowserSurfaceBinding) => ReactNode
}) {
  const navigationScope = useMemo(() => ({ accountUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, sessionId: scope.sessionId }), [scope])
  const queue = useSlotOfflineQueue({ deviceId, workspaceId: "holofolder", accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }, scope.sessionId)
  const latest = useRef({ currentScope, queue })
  useLayoutEffect(() => { latest.current = { currentScope, queue } })
  const [read, setRead] = useState<CollectionNavigationRead>({ scope: navigationScope, evidence: { kind: "unavailable" }, catalog: [], layouts: [] })
  const [notice, setNotice] = useState("")
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(true)
  const alive = useRef(false), sequence = useRef(0)
  const metadataKey = `slot-navigation-v1:${JSON.stringify([deviceId, scope.actorUserId, scope.ownerUserId])}`
  const valid = () => alive.current && sameInventoryReadScope(latest.current.currentScope(), scope)
  const catalog = useMemo(() => browserHostCatalog(read.catalog), [read.catalog])
  const refresh = async () => {
    const request = ++sequence.current
    try {
      const fresh = await readCurrentCollectionNavigation(() => valid() ? latest.current.currentScope() : null)
      if (!valid() || request !== sequence.current || fresh.evidence.kind !== "complete") throw new Error("inventory_read_scope_changed")
      // Persist through the canonical queue, which reapplies every unresolved local intent.
      const resolver = browserHostCatalog(fresh.catalog)
      await latest.current.queue.saveSnapshot(fresh.evidence.snapshot, resolver)
      if (!valid() || request !== sequence.current) throw new Error("inventory_read_scope_changed")
      setRead(fresh); setNotice("")
      await getOfflineStore()?.set(metadataKey, { catalog: fresh.catalog, layouts: fresh.layouts })
      return fresh
    } finally { if (valid() && request === sequence.current) setReady(true) }
  }
  useEffect(() => {
    alive.current = true
    let cachedFinished = false, active = true
    const initial = async () => {
      const record = await latest.current.queue.queue?.read()
      const metadata = await getOfflineStore()?.get<{ catalog: CollectionNavigationRead["catalog"]; layouts: CollectionNavigationRead["layouts"] }>(metadataKey)
      if (!active || !valid()) return
      if (record?.optimistic) {
        const safeMetadata = record.snapshot ? parseNavigationEvidence(metadata, record.snapshot) : undefined
        setRead({ scope: navigationScope, evidence: { kind: "cached", snapshot: record.optimistic }, catalog: safeMetadata?.catalog ?? [], layouts: safeMetadata?.layouts ?? [] })
      }
      cachedFinished = true
      try { await refresh() } catch { if (valid()) setNotice("Could not refresh storage. Showing only saved copies; pending edits are retained.") }
    }
    void initial().catch(() => { if (active && valid()) { setNotice("Saved storage could not be opened. Pending edits have not been removed."); setReady(true) } })
    const disconnected = () => setOnline(false)
    const reconnect = () => { setOnline(navigator.onLine); if (cachedFinished && document.visibilityState !== "hidden") void refresh().catch(() => { if (valid()) setNotice("Storage refresh unavailable. Pending edits are retained.") }) }
    queueMicrotask(() => setOnline(navigator.onLine))
    window.addEventListener("offline", disconnected); window.addEventListener("online", reconnect); window.addEventListener("focus", reconnect); document.addEventListener("visibilitychange", reconnect)
    const invalidate = () => { alive.current = false; sequence.current++ }
    return () => { active = false; invalidate(); window.removeEventListener("offline", disconnected); window.removeEventListener("online", reconnect); window.removeEventListener("focus", reconnect); document.removeEventListener("visibilitychange", reconnect) }
    // A session remount owns the entire read/queue lifetime, never a view change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const receive: SlotCommandSink = async draft => {
    if (!valid() || draft.scope.ownerUserId !== scope.ownerUserId) throw new Error("inactive-or-unavailable-session")
    return latest.current.queue.enqueue(draft.intent, catalog)
  }
  // An optimistic projection is cached evidence, never a complete remote read or ACK.
  const visibleRead: CollectionNavigationRead = queue.record?.optimistic && queue.record.pending.length
    ? { ...read, evidence: { kind: "cached", snapshot: queue.record.optimistic }, layouts: read.layouts.map(layout => {
      const base = queue.record?.snapshot?.binders.find(b => b.collectionId === layout.collectionId)
      const projected = queue.record?.optimistic?.binders.find(b => b.collectionId === layout.collectionId)
      return base?.layoutRevision === layout.layoutRevision && projected ? { ...layout, layoutRevision: projected.layoutRevision } : layout
    }) } : !online && read.evidence.kind === "complete" ? { ...read, evidence: { kind: "cached", snapshot: read.evidence.snapshot } } : read
  if (!ready) return <p role="status">Opening saved storage…</p>
  return <CollectionNavigationHost scope={navigationScope} fallbackCollectionId={initialBinderId} read={visibleRead} readCurrent={async () => { const fresh = await refresh(); const record = await latest.current.queue.queue?.read(); if (record?.pending.length) throw new Error("pending-layout-reconciliation"); return fresh }} scrollContainerId="collection-browser-scroll"
      renderNationalDex={() => null} renderCollection={() => null} renderSurface={surface => {
        const snapshot = visibleRead.evidence.kind === "unavailable" ? null : visibleRead.evidence.snapshot
        const binder = snapshot?.binders.find(b => b.collectionId === surface.collection?.collectionId)
        // Cached slots may be displayed, but current pages require a matching saved grid.
        const layout = binder && visibleRead.layouts.find(l => l.collectionId === binder.collectionId && l.layoutRevision === binder.layoutRevision)
        const display = snapshot && binder && layout ? { inventory: snapshot, binder,
          catalog: Object.fromEntries(visibleRead.catalog.flatMap(c => [c.card.id, c.card.canonicalId, ...(c.card.aliasIds ?? [])].filter((id): id is string => Boolean(id)).map(id => [id, c.card]))) } : undefined
        return renderSurface({ surface: { ...surface, header: <>
          {Boolean(queue.record?.pending.length) && <p role="status" className="px-4 text-sm">Saved on device · Pending sync. Remote commands remain unavailable.</p>}
          {(notice || queue.error) && <p role="status" className="px-4 text-sm">{notice || queue.error}</p>}
          {surface.state.main !== "inventory" && surface.notice && <p role="status" className="px-4 text-sm">{surface.notice}</p>}{surface.header}</> }, display, catalog, receive, pending: queue.record?.pending.length ?? 0 })
      }} />
}
