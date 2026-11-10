"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import SlabsGallery from "@/components/slabs/slabs-gallery"
import { slabCollectionCopies } from "@/lib/slabs/collection"
import InventoryView from "@/components/inventory/inventory-view"
import { closeAllOverlays, isOverlayHistoryCleanup, runAfterOverlayHistory } from "@/hooks/use-overlay"
import type { InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { captureNavigationScroll, defaultCollectionView, navigationIndex, navigationLocation, navigationScroll, navigationStorageKey,
  normalizeNavigationState, resolveNavigation, type CollectionNavigationRead, type CollectionNavigationFocus, type CollectionNavigationScope, type CollectionNavigationState, type CollectionViewState, type InventoryViewState } from "@/lib/collection-navigation"
import type { InventoryOwnershipBinding } from "@/lib/inventory-actions"
import styles from "./navigation.module.css"

export interface NavigationSurface {
  notice: string
  visit: number
  content: ReactNode
  header: ReactNode
  state: CollectionNavigationState
  collection: Parameters<CollectionNavigationHostProps["renderCollection"]>[0] | null
  openCreated: (collectionId: string, fresh: CollectionNavigationRead) => boolean
  onInventory: () => void
  onCollection: () => void
  onDex: () => void
  onLegacyView: (view: "wanted" | "sets" | "pokemon" | "analytics") => void
}

export interface CollectionNavigationHostProps {
  ownership?: InventoryOwnershipBinding
  /** The host enables the existing Slabs renderer after its own admission. */
  stagedSlabs?: boolean
  onEditGrading?: (itemId: string) => void
  renderSurface?: (surface: NavigationSurface) => ReactNode
  fallbackCollectionId?: string | null
  scrollContainerId?: string
  /** Current authenticated session scope, null while signed out/rechecking membership. */
  scope: CollectionNavigationScope | null
  read: CollectionNavigationRead
  /** Authenticated fresh complete read, fenced by current session/membership. Never retained queue replies. */
  readCurrent: () => Promise<CollectionNavigationRead>
  renderCollection: (context: { read: CollectionNavigationRead; collectionId: string; state: CollectionViewState; highlight: CollectionNavigationFocus | null;
    onChange: (patch: Partial<CollectionViewState>) => void }) => ReactNode
  renderNationalDex: () => ReactNode
}
/** Shared navigation for checked authenticated sessions and read-only cached display. */
export default function CollectionNavigationHost(props: CollectionNavigationHostProps) {
  if (!props.scope) return <p role="status">Sign in to open your collections.</p>
  return <ScopedNavigation key={JSON.stringify([navigationStorageKey(props.scope), props.scope.sessionId])} {...props} scope={props.scope} />
}
function ScopedNavigation({ scope, read, readCurrent, renderCollection, renderNationalDex, renderSurface, scrollContainerId, fallbackCollectionId, stagedSlabs = false, onEditGrading, ownership }: CollectionNavigationHostProps & { scope: CollectionNavigationScope }) {
  const scrollElement = useCallback(() => {
    const container = scrollContainerId ? document.getElementById(scrollContainerId) : null
    return container?.querySelector<HTMLElement>('[data-testid="view-scroller"], [data-testid="wanted-list"]') ?? container
  }, [scrollContainerId])
  const scrollTop = useCallback(() => scrollElement()?.scrollTop ?? window.scrollY, [scrollElement])
  const key = navigationStorageKey(scope)
  // Client-only host, remounted per scope: resolve the first view on the first render so a new host
  // (saved copy → checked session on startup) never paints an empty frame.
  const [initial] = useState(() => {
    let saved: unknown
    try { saved = JSON.parse(localStorage.getItem(key) ?? "null") } catch { saved = null }
    const remembered = normalizeNavigationState(saved)
    if (!saved && fallbackCollectionId) { remembered.main = "collection"; remembered.collectionId = fallbackCollectionId }
    const params = new URLSearchParams(location.search)
    const resolved = resolveNavigation(remembered, scope, read, params, stagedSlabs)
    // Slot and item links resolve only against a complete read. A saved copy paints first, then they resolve once.
    const deferred = read.evidence.kind !== "complete" && (params.has("slot") || params.has("item"))
    return { ...resolved, notice: deferred ? "" : resolved.notice, deferred: deferred ? { remembered, params } : null }
  })
  const [state, setState] = useState<CollectionNavigationState | null>(initial.state)
  const [pendingNavigation, setPendingNavigation] = useState<{ state: CollectionNavigationState; highlight: CollectionNavigationFocus | null; read: CollectionNavigationRead; sequence: number } | null>(null)
  const entryId = useRef("")
  const [visit, setVisit] = useState(0)
  const [notice, setNotice] = useState(initial.notice)
  const [highlight, setHighlight] = useState<CollectionNavigationFocus | null>(initial.highlight)
  const [fresh, setFresh] = useState<{ base: CollectionNavigationRead; value: CollectionNavigationRead } | null>(null)
  const currentRead = fresh?.base === read ? fresh.value : read
  const index = navigationIndex(scope, currentRead)
  const alive = useRef(true), request = useRef(0), stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const deferredLink = useRef(initial.deferred), navigated = useRef(false)
  useEffect(() => {
    const link = deferredLink.current
    if (!link || read.evidence.kind !== "complete") return
    deferredLink.current = null
    // A navigation since the first paint (any request, or a view change) wins over the original link.
    const moved = () => navigated.current || request.current !== 0
    if (moved()) return
    const result = resolveNavigation(link.remembered, scope, read, link.params, stagedSlabs)
    queueMicrotask(() => {
      if (!alive.current || moved()) return
      const changed = JSON.stringify(result.state) !== JSON.stringify(stateRef.current)
      stateRef.current = result.state; setState(result.state); setNotice(result.notice); setHighlight(result.highlight)
      if (changed) setVisit(v => v + 1)
      history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: result.state } }, "")
    })
  }, [read, initial, scope, stagedSlabs, key])
  const persist = useCallback((next: CollectionNavigationState) => {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Storage can be disabled. Browsing still works. */ }
  }, [key])
  useEffect(() => {
    alive.current = true
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = "manual"
    entryId.current = crypto.randomUUID()
    history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: initial.state } }, "")
    return () => { alive.current = false; history.scrollRestoration = previousRestoration }
    // Scope changes remount this entire private host. Evidence updates are checked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      if (isOverlayHistoryCleanup(event)) return
      const entry = event.state?.collectionNavigation
      // Shared overlay entries inherit this ID. Their dismissal is not a main-view traversal.
      if (entry?.key === key && entry.id === entryId.current) return
      entryId.current = entry?.id ?? crypto.randomUUID()
      request.current++; closeAllOverlays(); setHighlight(null)
      const result = resolveNavigation(normalizeNavigationState(entry?.key === key ? entry.state : null), scope, currentRead,
        entry?.key === key ? undefined : new URLSearchParams(location.search), stagedSlabs)
      stateRef.current = result.state; setState(result.state); setNotice(result.notice); setVisit(v => v + 1); persist(result.state)
    }
    const onTraversal = (event: NavigationCurrentEntryChangeEvent) => {
      if (event.navigationType === "traverse") onPop(new PopStateEvent("popstate", { state: history.state }))
    }
    // A native traversal can commit its entry before a framework releases popstate.
    // Entry IDs deduplicate this early notification and the eventual popstate.
    window.navigation?.addEventListener("currententrychange", onTraversal)
    window.addEventListener("popstate", onPop)
    return () => { window.navigation?.removeEventListener("currententrychange", onTraversal); window.removeEventListener("popstate", onPop) }
  }, [key, scope, currentRead, persist, stagedSlabs])
  const safe = state ? resolveNavigation(state, scope, currentRead, undefined, stagedSlabs) : null
  const visible = safe?.state
  const destinationKey = visible ? JSON.stringify([visible.main, visible.collectionId, visible.collections[visible.collectionId ?? ""]?.view]) : "loading"
  useEffect(() => {
    if (!visible) return
    let frame = 0
    const restore = () => {
      const element = scrollElement()
      if (scrollContainerId && !element) return false
      ;(element ?? window).scrollTo({ top: navigationScroll(visible), behavior: "instant" })
      return true
    }
    const observer = new MutationObserver(() => { if (restore()) observer.disconnect() })
    frame = requestAnimationFrame(() => { if (!restore()) observer.observe(document.body, { childList: true, subtree: true }) })
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
    // Query edits should not reset scroll. Restore only when the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey, visit, scrollElement, scrollContainerId])
  useEffect(() => {
    const save = (event: Event) => {
      if (scrollContainerId && event.type === "scroll" && event.target !== scrollElement()) return
      if (!stateRef.current) return
      const next = captureNavigationScroll(stateRef.current, scrollTop())
      stateRef.current = next
      persist(next)
      history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: next } }, "")
    }
    document.addEventListener("scroll", save, { passive: true, capture: true })
    window.addEventListener("pagehide", save)
    return () => { document.removeEventListener("scroll", save, true); window.removeEventListener("pagehide", save) }
  }, [key, persist, scrollTop, scrollElement, scrollContainerId])
  const update = useCallback((mutate: (s: CollectionNavigationState) => CollectionNavigationState) => {
    setState(old => {
      if (!old) return old
      navigated.current = true
      const next = mutate(captureNavigationScroll(old, scrollTop()))
      stateRef.current = next
      persist(next)
      const url = new URL(location.href)
      if (next.main === "collection" && next.collectionId) {
        const view = next.collections[next.collectionId] ?? defaultCollectionView()
        url.searchParams.set("binder", next.collectionId); url.searchParams.set("view", view.view)
        if (view.view === "binder") url.searchParams.set("page", String(view.page))
        else url.searchParams.delete("page")
        url.searchParams.delete("slot"); url.searchParams.delete("item")
      }
      history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: next } }, "", url)
      return next
    })
  }, [persist, key, scrollTop])
  const inventoryChange = useCallback((browse: InventoryViewState) => update(old => ({ ...old, inventory: { ...old.inventory, ...browse } })), [update])
  const navigate = (next: CollectionNavigationState, locationIntent: InventoryLocationIntent | null = null, latest = currentRead) => {
    const sequence = ++request.current
    closeAllOverlays()
    setPendingNavigation({ state: next, highlight: locationIntent, read: latest, sequence })
  }
  useEffect(() => {
    if (!pendingNavigation) return
    // Overlay cleanup must commit before requesting host history, matching the shared primitive.
    runAfterOverlayHistory(() => {
      if (!alive.current || request.current !== pendingNavigation.sequence) return
      request.current++
      if (stateRef.current) {
        const outgoing = captureNavigationScroll(stateRef.current, scrollTop())
        history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: outgoing } }, "")
      }
      const result = resolveNavigation(pendingNavigation.state, scope, pendingNavigation.read, undefined, stagedSlabs)
      const url = new URL(location.href)
      for (const param of ["binder", "view", "page", "slot", "item"]) url.searchParams.delete(param)
      url.searchParams.set("view", result.state.main === "collection" ? result.state.collections[result.state.collectionId ?? ""]?.view ?? "binder" : result.state.main)
      if (result.state.main === "collection" && result.state.collectionId) url.searchParams.set("binder", result.state.collectionId)
      entryId.current = crypto.randomUUID()
      history.pushState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: result.state } }, "", url)
      stateRef.current = result.state; persist(result.state); setState(result.state); setHighlight(pendingNavigation.highlight); setNotice(result.notice); setVisit(v => v + 1)
      setPendingNavigation(null)
    })
  }, [pendingNavigation, scope, key, persist, scrollTop, stagedSlabs])

  const openLocation = async (intent: InventoryLocationIntent) => {
    const sequence = ++request.current
    try {
      const latest = await readCurrent()
      if (!alive.current || request.current !== sequence) return
      const location = navigationLocation(scope, latest, intent)
      if (location.kind !== "assigned" || location.page === null || !stateRef.current) {
        setNotice(location.kind === "unassigned" ? "This copy is now Unassigned." : "This location is unavailable. Your inventory is still open.")
        return
      }
      setFresh({ base: read, value: latest })
      const next = captureNavigationScroll(stateRef.current, scrollTop()), id = location.intent.collectionId
      next.main = "collection"; next.collectionId = id
      next.collections[id] = { ...defaultCollectionView(), page: location.page }
      // navigate validates against latest, not the outgoing evidence, on the next render.
      navigate(next, location.intent, latest)
    } catch { if (alive.current && request.current === sequence) setNotice("This location could not be refreshed. Your inventory is still open.") }
  }
  if (!visible) return <p role="status">Opening saved view…</p>
  const collectionId = visible.collectionId
  const collectionState = visible.collections[collectionId ?? ""] ?? defaultCollectionView()
  // Compact: the collection picker reads as the page title; National Dex and Inventory live in the dock.
  const header = <div className="flex min-w-0 flex-1 items-center gap-1">
      <select aria-label="Collection" className="h-9 min-w-0 flex-1 truncate rounded-lg bg-transparent px-1 text-base font-semibold" value={collectionId ?? ""} onChange={e => navigate({ ...visible, main: "collection", collectionId: e.target.value })}>
        {!collectionId && <option value="">No storage yet</option>}{index.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {visible.main === "collection" && <select aria-label="Collection view" className="h-9 shrink-0 rounded-lg bg-transparent px-1 text-base text-muted-foreground" value={collectionState.view} onChange={e => navigate({ ...visible,
        collections: { ...visible.collections, [collectionId!]: { ...collectionState, view: e.target.value as CollectionViewState["view"], scroll: 0 } } })}>
        <option value="binder">Binder</option><option value="list">List</option>{stagedSlabs && <option value="slabs">Slabs</option>}
      </select>}
    </div>
  const collection = collectionId && index.kind !== "unavailable" ? { read: currentRead, collectionId, state: collectionState, highlight,
    onChange: (patch: Partial<CollectionViewState>) => update(old => ({ ...old, collections: { ...old.collections, [collectionId]: { ...collectionState, ...patch } } })) } : null
  const slabCopies = collectionState.view === "slabs" && stagedSlabs && collectionId ? slabCollectionCopies(scope, currentRead, collectionId) : []
  const content = <>
    {(notice || safe?.notice) && <p role="status" className={styles.notice}>{notice || safe?.notice}</p>}
    {visible.main === "inventory" ? <InventoryView key={visit} scope={scope} evidence={index.kind === "unavailable" ? { kind: "unavailable" } : currentRead.evidence}
      ownership={ownership} catalog={currentRead.catalog} layouts={currentRead.layouts} onEditGrading={onEditGrading} initialBrowseState={visible.inventory} onBrowseStateChange={inventoryChange} onOpenLocation={intent => void openLocation(intent)} />
      : visible.main === "dex" ? <div key="dex">{renderNationalDex()}</div>
      : collectionId && index.kind !== "unavailable" && collectionState.view === "slabs" && stagedSlabs ? <SlabsGallery key={`${destinationKey}:${visit}:${index.key}`} copies={slabCopies}
        name={index.collections.find(c => c.id === collectionId)?.name ?? "Collection"} cached={index.kind === "cached"} search={collectionState.search}
        onSearch={search => collection?.onChange({ search, scroll: 0 })} />
      : collectionId && index.kind !== "unavailable" ? <div key={`${destinationKey}:${visit}`}>{renderCollection({ read: currentRead, collectionId, state: collectionState, highlight,
        onChange: patch => update(old => ({ ...old, collections: { ...old.collections, [collectionId]: { ...collectionState, ...patch } } })) })}</div>
      : <p role="status">Collection unavailable. Open Inventory or National Dex.</p>}
  </>
  const creationEntry = entryId.current, creationRequest = request.current
  if (renderSurface) return renderSurface({ openCreated: (id, latest) => {
    if (!alive.current || entryId.current !== creationEntry || request.current !== creationRequest
      || latest.evidence.kind !== "complete" || !latest.evidence.snapshot.collections.some(c => c.id === id)) return false
    setFresh({ base: read, value: latest })
    navigate({ ...visible, main: "collection", collectionId: id, collections: { ...visible.collections, [id]: defaultCollectionView(latest.evidence.snapshot.collections.find(c => c.id === id)!.defaultPresentation) } }, null, latest)
    return true
  }, notice: notice || safe?.notice || "", visit, content, header, state: visible, collection,
    onInventory: () => navigate({ ...visible, main: "inventory" }), onCollection: () => navigate({ ...visible, main: "collection" }), onDex: () => navigate({ ...visible, main: "dex", dexView: "list" }),
    onLegacyView: dexView => navigate({ ...visible, main: "dex", dexView }) })
  return <div className={styles.host}><header className={styles.header}>{header}</header>{content}
    <nav aria-label="Collection navigation" className={styles.dock}>
      <button aria-current={visible.main === "collection" ? "page" : undefined} disabled={!collectionId} onClick={() => navigate({ ...visible, main: "collection" })}>Collections</button>
      <button aria-current={visible.main === "inventory" ? "page" : undefined} onClick={() => navigate({ ...visible, main: "inventory" })}>Inventory</button>
      <button aria-current={visible.main === "dex" ? "page" : undefined} onClick={() => navigate({ ...visible, main: "dex" })}>National Dex</button>
    </nav>
  </div>
}
