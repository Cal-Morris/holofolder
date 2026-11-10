"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ActivityButton } from "@/components/collection-activity-context"
import dynamic from "next/dynamic"
import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
import { inventoryGradingReference, prepareInventoryGradingIntent } from "@/lib/grading/inventory-edit"
import CollectionNavigationHost, { type NavigationSurface } from "./navigation-host"
import { useSlotOfflineQueue } from "@/hooks/use-slot-offline-queue"
import { readCurrentCollectionNavigation } from "@/lib/collection/inventory-navigation-read"
import { parseNavigationEvidence, sameInventoryReadScope, type InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { CollectionNavigationRead } from "@/lib/collection-navigation"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { browserHostCatalog, browserHostDisplayCatalog } from "@/lib/collection/browser-host-catalog"
import type { NativeRecoveryBinding } from "@/components/native-activity-recovery"
import type { SlotDisplayInput } from "@/lib/binder-display-model"
import type { SlotCommandSink } from "@/lib/binder-slot-editing"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { sendStorageCommand } from "@/lib/collection/storage-command-browser"
import type { NativePageScanAdmission } from "@/components/native-page-scanner"
import type { ScanDestinationAdmission } from "@/lib/scan-destinations"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import type { InventoryCatalogResolver } from "@/lib/domain/inventory"

const GradingEditor = dynamic(() => import("@/components/grading/grading-editor"), { ssr: false })

export interface BrowserSurfaceBinding {
  analytics: { scope: import("@/lib/collection-navigation").CollectionNavigationScope; read: CollectionNavigationRead }
  surface: NavigationSurface
  display?: SlotDisplayInput
  catalog: InventoryCatalogResolver
  receive: SlotCommandSink
  pending: number

  bulkFill?: { available: boolean; receive: SlotCommandSink }


  recovery?: NativeRecoveryBinding


  scan?: { detectPage?: NativePageScanAdmission["detectPage"]; available: boolean; online: boolean; rows?: number; cols?: number; sessionId: string; getOfflineCards: () => Promise<SearchCardResult[]>; receive: ScanDestinationAdmission["onCommandIntent"] }

}
export default function BrowserCollectionSession({ scope, currentScope, renderSurface, renderFallback, initialBinderId, localHarness = false }: {
  initialBinderId: string | null
  localHarness?: boolean
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
    {...{ scope, currentScope, renderSurface, deviceId, initialBinderId, localHarness }} />
}
function ScopedBrowserSession({ scope, currentScope, renderSurface, deviceId, initialBinderId, localHarness }: {
  initialBinderId: string | null
  localHarness: boolean
  scope: InventoryReadScope; currentScope: () => InventoryReadScope | null; deviceId: string
  renderSurface: (binding: BrowserSurfaceBinding) => ReactNode
}) {
  const navigationScope = useMemo(() => ({ accountUserId: scope.actorUserId, ownerUserId: scope.ownerUserId, sessionId: scope.sessionId }), [scope])
  const queue = useSlotOfflineQueue({ deviceId, workspaceId: "holofolder", accountId: scope.actorUserId, ownerUserId: scope.ownerUserId }, scope.sessionId)
  const latest = useRef({ currentScope, queue, catalog: browserHostCatalog([]) })
  const [read, setRead] = useState<CollectionNavigationRead>({ scope: navigationScope, evidence: { kind: "unavailable" }, catalog: [], layouts: [] })
  const [grading, setGrading] = useState<{ snapshot: InventorySnapshot; itemId: string; intent: SlotOfflineIntent | null } | null>(null)
  const [notice, setNotice] = useState("")
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(true)
  const alive = useRef(false), sequence = useRef(0), refreshing = useRef(0), sending = useRef(false)
  const transport = useRef<AbortController | null>(null)
  useLayoutEffect(() => () => { alive.current = false; sequence.current++; transport.current?.abort() }, [])
  const metadataKey = `slot-navigation-v1:${JSON.stringify([deviceId, scope.actorUserId, scope.ownerUserId])}`
  const valid = () => alive.current && sameInventoryReadScope(latest.current.currentScope(), scope)
  const catalog = useMemo(() => browserHostCatalog(read.catalog), [read.catalog])
  useLayoutEffect(() => { latest.current = { currentScope, queue, catalog } })
  const refresh = async () => {
    if (sending.current) throw new Error("pending-command-read")
    const request = ++sequence.current
    refreshing.current++
    try {
      const fresh = await readCurrentCollectionNavigation(() => valid() ? latest.current.currentScope() : null, localHarness)
      if (!valid() || request !== sequence.current || fresh.evidence.kind !== "complete") throw new Error("inventory_read_scope_changed")
      // Persist through the canonical queue, which reapplies every unresolved local intent.
      const resolver = browserHostCatalog(fresh.catalog)
      const record = await latest.current.queue.queue?.read()
      const pending = record?.pending.length || record?.recovery?.some(r => !r.synchronized)
      if (!pending) await latest.current.queue.saveSnapshot(fresh.evidence.snapshot, resolver)
      if (!valid() || request !== sequence.current) throw new Error("inventory_read_scope_changed")
      setRead(fresh); setNotice("")
      await getOfflineStore()?.set(metadataKey, { catalog: fresh.catalog, layouts: fresh.layouts })
      return fresh
    } finally { refreshing.current--; if (valid() && request === sequence.current) setReady(true) }
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
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    transport.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const active = () => !controller.signal.aborted && valid()
    const tick = async () => {
      try {
        if (!active() || sending.current || refreshing.current || (await latest.current.queue.queue?.read())?.recovery?.some(r => !r.synchronized) || !navigator.onLine || document.visibilityState === "hidden") return
        const head = (await latest.current.queue.queue?.read())?.pending[0]
        if (!active() || !head || ["blocked", "billing", "conflict"].includes(head.status)
          || head.attempts >= 5 || head.nextAttemptAt > Date.now() || head.lease && head.lease.until > Date.now()) return
        sending.current = true
        await latest.current.queue.replay(intent => sendStorageCommand(intent, () => active() ? latest.current.currentScope() : null, controller.signal, localHarness), latest.current.catalog, async () => {
          const fresh = await readCurrentCollectionNavigation(() => active() ? latest.current.currentScope() : null, localHarness)
          if (!active() || fresh.evidence.kind !== "complete") throw new Error("inventory_read_scope_changed")
          setRead(fresh)
          await getOfflineStore()?.set(metadataKey, { catalog: fresh.catalog, layouts: fresh.layouts })
          if (!active()) throw new Error("inventory_read_scope_changed")
          return fresh.evidence.snapshot
        }, active)
      } catch { if (active()) setNotice("Sync unavailable. Pending edits are retained.") }
      finally { sending.current = false; if (active()) timer = setTimeout(() => { void tick() }, 1000) }
    }
    void tick()
    return () => { controller.abort(); clearTimeout(timer) }
    // One sender belongs to this session, independent of view/record refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  const reviewConflict = async (decision?: "keep-remote" | "rebase") => {
    const q = latest.current.queue.queue, head = (await q?.read())?.pending[0]
    if (!q || !head?.conflict?.rejected || !valid() || sending.current) return
    refreshing.current++
    try {
      await q.refreshConflict(head.intent.request.operationId, async () => {
        const fresh = await readCurrentCollectionNavigation(() => valid() ? latest.current.currentScope() : null, localHarness)
        if (!valid() || fresh.evidence.kind !== "complete") throw new Error("fresh-scoped-read-required")
        setRead(fresh)
        return fresh.evidence.snapshot
      }, () => valid() ? { deviceId, workspaceId: "holofolder", accountId: scope.actorUserId, ownerUserId: scope.ownerUserId } : null)
      if (!valid()) return
      if (decision === "keep-remote") await q.reconcile(head.intent.request.operationId, { kind: "keep-remote" }, latest.current.catalog)
      if (decision === "rebase") await q.rebase(head.intent.request.operationId, crypto.randomUUID(), latest.current.catalog)
      if (valid()) { await latest.current.queue.refresh(); setNotice(decision ? "Saved edit reviewed." : "Current storage loaded. The saved edit is still retained.") }
    } catch { if (valid()) setNotice("Could not reconcile this edit. Structural, overlapping or dependent edits need a separately reviewed replacement. The original is retained.") }
    finally { refreshing.current-- }
  }
  const scanAllowed = useRef(false)
  useLayoutEffect(() => { scanAllowed.current = online && read.evidence.kind === "complete" && !!queue.record && !queue.record.pending.length && !queue.record.recovery?.some(r => !r.synchronized) })
  const receiveScan: ScanDestinationAdmission["onCommandIntent"] = async (draft, scanCatalog) => {
    if (!valid() || refreshing.current || !scanAllowed.current || !navigator.onLine
      || draft.scope.ownerUserId !== scope.ownerUserId || draft.intent.kind !== "inventory"
      || read.evidence.kind !== "complete"
      || !read.evidence.snapshot.binders.some(b => b.collectionId === draft.scope.collectionId)) throw new Error("fresh-scoped-read-required")
    const record = await latest.current.queue.queue?.read()
    if (!valid() || !scanAllowed.current || !navigator.onLine || !record || record.pending.length || record.recovery?.some(r => !r.synchronized)) throw new Error("fresh-scoped-read-required")
    return latest.current.queue.enqueue(draft.intent, scanCatalog)
  }
  const getOfflineCards = async () => {
    const { buildOfflineCardIndex } = await import("@/lib/offline-card-index")
    const cached = await buildOfflineCardIndex([])
    if (!valid()) throw new Error("inventory_read_scope_changed")
    const cards = read.catalog.map(c => ({ ...c.card, dexIds: [...(c.pokemonIds ?? [])] }))
    return [...cards, ...cached.filter(c => !cards.some(known => known.id === c.id && known.language === c.language))]
  }
  const receive: SlotCommandSink = async draft => {
    if (refreshing.current || !valid() || draft.scope.ownerUserId !== scope.ownerUserId) throw new Error("inactive-or-unavailable-session")
    return latest.current.queue.enqueue(draft.intent, catalog)
  }

  const receiveBulkFill: SlotCommandSink = async draft => {
    if (refreshing.current || !valid() || draft.scope.ownerUserId !== scope.ownerUserId || draft.intent.kind !== "inventory") throw new Error("inactive-or-unavailable-session")
    // #469 adds recovery to this same record; unresolved recovery must fence new work.
    const record: { pending: unknown[]; recovery?: { synchronized: boolean }[] } | undefined = await latest.current.queue.queue?.read()
    if (!valid() || !navigator.onLine || read.evidence.kind !== "complete" || !record || record.pending.length || record.recovery?.some(r => !r.synchronized)) throw new Error("fresh-scoped-read-required")
    return latest.current.queue.enqueue(draft.intent, catalog)
  }

  const recoveryRead = useRef<CollectionNavigationRead | null>(null)
  const recovery: NativeRecoveryBinding = {
    queue: queue.queue, deviceId, localHarness, scope,
    currentScope: () => valid() ? latest.current.currentScope() : null,
    activeQueueScope: () => valid() ? { deviceId, workspaceId: "holofolder", accountId: scope.actorUserId, ownerUserId: scope.ownerUserId } : null,
    snapshot: read.evidence.kind === "unavailable" ? null : read.evidence.snapshot,
    refresh: async () => {
      await latest.current.queue.refresh()
      const record = await latest.current.queue.queue?.read()
      if (!record?.recovery?.some(r => !r.synchronized)) {
        if (valid() && recoveryRead.current) { setRead(recoveryRead.current); recoveryRead.current = null }
        else await refresh()
      }
    },
    readCurrent: async () => {
      if (sending.current || refreshing.current || !valid()) throw new Error("Storage is busy. Retry when current reads finish.")
      refreshing.current++
      try {
        const fresh = await readCurrentCollectionNavigation(() => valid() ? latest.current.currentScope() : null, localHarness)
        if (!valid() || fresh.evidence.kind !== "complete") throw new Error("fresh-scoped-read-required")
        // Publish only after the queue accepts this fresh snapshot; preview does not alter display.
        recoveryRead.current = fresh
        return fresh.evidence.snapshot
      } finally { refreshing.current-- }
    },

  }
  // An optimistic projection is cached evidence, never a complete remote read or ACK.
  const visibleRead: CollectionNavigationRead = queue.record?.optimistic && queue.record.pending.length
    ? { ...read, evidence: { kind: "cached", snapshot: queue.record.optimistic }, layouts: read.layouts.map(layout => {
      const base = queue.record?.snapshot?.binders.find(b => b.collectionId === layout.collectionId)
      const projected = queue.record?.optimistic?.binders.find(b => b.collectionId === layout.collectionId)
      return base?.layoutRevision === layout.layoutRevision && projected ? { ...layout, layoutRevision: projected.layoutRevision } : layout
    }) } : !online && read.evidence.kind === "complete" ? { ...read, evidence: { kind: "cached", snapshot: read.evidence.snapshot } } : read
  const inventoryRecord: { pending: unknown[]; recovery?: { synchronized: boolean }[] } | null = queue.record
  const bulkFillAvailable = Boolean(online && read.evidence.kind === "complete" && inventoryRecord && !inventoryRecord.pending.length && !inventoryRecord.recovery?.some(r => !r.synchronized))
  if (!ready) return <p role="status">Opening saved storage…</p>
  const gradingItem = grading?.snapshot.items.find(i => i.id === grading.itemId)
  const canEditGrading = read.evidence.kind === "complete" && !queue.record?.pending.length && !queue.record?.recovery?.some(r => !r.synchronized)
  return <><CollectionNavigationHost onEditGrading={canEditGrading ? itemId => {
    if (!valid() || read.evidence.kind !== "complete" || latest.current.queue.record?.pending.length || latest.current.queue.record?.recovery?.some(r => !r.synchronized)) return
    try {
      inventoryGradingReference(read.evidence.snapshot, itemId)
      setGrading({ snapshot: structuredClone(read.evidence.snapshot), itemId, intent: null })
    } catch { setNotice("This copy needs a current complete inventory read before grading can be edited.") }
  } : undefined} stagedSlabs={localHarness} scope={navigationScope} fallbackCollectionId={initialBinderId} read={visibleRead} readCurrent={async () => { const fresh = await refresh(); const record = await latest.current.queue.queue?.read(); if (record?.pending.length || record?.recovery?.some(r => !r.synchronized)) throw new Error("pending-layout-reconciliation"); return fresh }} scrollContainerId="collection-browser-scroll"
      renderNationalDex={() => null} renderCollection={() => null} renderSurface={surface => {
        const snapshot = visibleRead.evidence.kind === "unavailable" ? null : visibleRead.evidence.snapshot
        const binder = snapshot?.binders.find(b => b.collectionId === surface.collection?.collectionId)
        // Cached slots may be displayed, but current pages require a matching saved grid.
        const layout = binder && visibleRead.layouts.find(l => l.collectionId === binder.collectionId && l.layoutRevision === binder.layoutRevision)
        const display = snapshot && binder && layout ? { inventory: snapshot, binder,
          catalog: {}, resolveCard: browserHostDisplayCatalog(visibleRead.catalog) } : undefined
        return renderSurface({ analytics: { scope: navigationScope, read: visibleRead }, surface: { ...surface, header: <>
          <div className="px-4"><ActivityButton /></div>
          {queue.record?.recovery?.some(r => !r.synchronized) && <p role="status" className="px-4 text-sm">Recovery saved on this device. Open Activity to retry the original request or verify current storage.</p>}
          {Boolean(queue.record?.pending.length) && <p role="status" className="px-4 text-sm">Saved on device · Pending sync.</p>}
          {queue.record?.pending[0] && ["conflict", "blocked", "billing"].includes(queue.record.pending[0].status) && <p role="status" className="px-4 text-sm">
            {queue.record.pending[0].status === "conflict" ? "Storage changed. The original edit is retained; confirmed rejections can be reviewed, unknown outcomes need an exact retry."
              : queue.record.pending[0].status === "billing" ? "Sync is paused by billing. Your edit is retained; retry after restoring access."
              : "Sync is paused. Your edit is retained; check account access before retrying."}
          </p>}
          {queue.record?.pending[0]?.conflict?.rejected && <div className="px-4 text-sm">
            <p>This command was not applied. Load current storage to review it. Use current storage cancels this saved edit.</p>
            <button type="button" className="min-h-9 pr-4 underline" onClick={() => { void reviewConflict() }}>Refresh current storage</button>
            {queue.record.pending[0].conflict.current && queue.record.pending.length === 1 && <>
              <button type="button" className="min-h-9 pr-4 underline" onClick={() => { void reviewConflict("keep-remote") }}>Use current storage</button>
              <button type="button" className="min-h-9 pr-4 underline" onClick={() => { void reviewConflict("rebase") }}>Rebase saved edit</button>
            </>}
          </div>}
          {queue.record?.pending[0] && !queue.record.pending[0].conflict?.rejected && <button type="button" className="min-h-9 px-4 text-sm underline" onClick={() => {
            const head = latest.current.queue.record?.pending[0]
            if (!head || !valid()) return
            void latest.current.queue.queue?.resume(head.intent.request.operationId).then(() => latest.current.queue.refresh()).catch(() => { if (valid()) setNotice("This edit needs reconciliation, or a send is still in progress. The original command is retained.") })
          }}>Retry pending sync</button>}
          {(notice || queue.error) && <p role="status" className="px-4 text-sm">{notice || queue.error}</p>}

          {surface.state.main !== "inventory" && surface.notice && <p role="status" className="px-4 text-sm">{surface.notice}</p>}{surface.header}</> }, display, catalog, receive, recovery, bulkFill: { available: bulkFillAvailable, receive: receiveBulkFill }, pending: queue.record?.pending.length ?? 0,

          scan: { detectPage: localHarness && new URLSearchParams(location.search).get("scanFixture") === "1"
            ? async (...args) => (await import("@/tests/fixtures/native-scanner-host")).syntheticPageDetection(...args) : undefined,
            available: bulkFillAvailable, online, rows: layout?.rows, cols: layout?.cols, sessionId: scope.sessionId, getOfflineCards, receive: receiveScan } })

      }} />
    {grading && gradingItem && read.evidence.kind === "complete" && read.evidence.snapshot.inventoryRevision === grading.snapshot.inventoryRevision && <GradingEditor
      key={`${scope.sessionId}:${grading.itemId}:${gradingItem.version}`} item={gradingItem}
      itemRef={inventoryGradingReference(grading.snapshot, grading.itemId)} ownerEvidence={grading.snapshot.items}
      onClose={() => setGrading(current => current === grading ? null : current)} onQueue={async command => {
        if (!valid() || refreshing.current) throw new Error("The authenticated storage session changed. Your accepted edits remain on this device.")
        // Allocate once before touching IDB. An aborted/lost local reply retries these exact bytes.
        grading.intent ??= prepareInventoryGradingIntent(grading.snapshot, command, { source: "app", clientId: deviceId,
          operationId: crypto.randomUUID(), batchId: null, clientOccurredAt: new Date().toISOString() })
        return latest.current.queue.enqueue(grading.intent, latest.current.catalog)
      }} />}
  </>
}
