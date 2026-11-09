"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import InventoryView from "@/components/inventory/inventory-view"
import { closeAllOverlays, runAfterOverlayHistory } from "@/hooks/use-overlay"
import type { InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { captureNavigationScroll, defaultCollectionView, navigationIndex, navigationLocation, navigationScroll, navigationStorageKey,
  normalizeNavigationState, resolveNavigation, type CollectionNavigationRead, type CollectionNavigationFocus, type CollectionNavigationScope, type CollectionNavigationState, type CollectionViewState, type InventoryViewState } from "@/lib/collection-navigation"
import styles from "./navigation.module.css"

export interface CollectionNavigationHostProps {
  /** Current authenticated session scope, null while signed out/rechecking membership. */
  scope: CollectionNavigationScope | null
  read: CollectionNavigationRead
  /** Authenticated fresh complete read, fenced by current session/membership. Never retained queue replies. */
  readCurrent: () => Promise<CollectionNavigationRead>
  renderCollection: (context: { read: CollectionNavigationRead; collectionId: string; state: CollectionViewState; highlight: CollectionNavigationFocus | null;
    onChange: (patch: Partial<CollectionViewState>) => void }) => ReactNode
  renderNationalDex: () => ReactNode
}
/** Staged private host only. Production BinderApp/bootstrap do not call this until #379. */
export default function CollectionNavigationHost(props: CollectionNavigationHostProps) {
  if (!props.scope) return <p role="status">Sign in to open your collections.</p>
  return <ScopedNavigation key={JSON.stringify([navigationStorageKey(props.scope), props.scope.sessionId])} {...props} scope={props.scope} />
}
function ScopedNavigation({ scope, read, readCurrent, renderCollection, renderNationalDex }: CollectionNavigationHostProps & { scope: CollectionNavigationScope }) {
  const [state, setState] = useState<CollectionNavigationState | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<{ state: CollectionNavigationState; highlight: CollectionNavigationFocus | null; read: CollectionNavigationRead; sequence: number } | null>(null)
  const entryId = useRef("")
  const [visit, setVisit] = useState(0)
  const [notice, setNotice] = useState("")
  const [highlight, setHighlight] = useState<CollectionNavigationFocus | null>(null)
  const [fresh, setFresh] = useState<{ base: CollectionNavigationRead; value: CollectionNavigationRead } | null>(null)
  const currentRead = fresh?.base === read ? fresh.value : read
  const index = navigationIndex(scope, currentRead)
  const alive = useRef(true), request = useRef(0), stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const key = navigationStorageKey(scope)
  const persist = useCallback((next: CollectionNavigationState) => {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Storage can be disabled. Browsing still works. */ }
  }, [key])
  useEffect(() => {
    alive.current = true
    const previousRestoration = history.scrollRestoration
    history.scrollRestoration = "manual"
    let saved: unknown
    try { saved = JSON.parse(localStorage.getItem(key) ?? "null") } catch { saved = null }
    const initial = resolveNavigation(normalizeNavigationState(saved), scope, read, new URLSearchParams(location.search))
    queueMicrotask(() => { if (alive.current) { setState(initial.state); setNotice(initial.notice); setHighlight(initial.highlight) } })
    entryId.current = crypto.randomUUID()
    history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: initial.state } }, "")
    return () => { alive.current = false; history.scrollRestoration = previousRestoration }
    // Scope changes remount this entire private host. Evidence updates are checked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const entry = event.state?.collectionNavigation
      // Shared overlay entries inherit this ID. Their dismissal is not a main-view traversal.
      if (entry?.key === key && entry.id === entryId.current) return
      entryId.current = entry?.id ?? crypto.randomUUID()
      request.current++; closeAllOverlays(); setHighlight(null)
      const result = resolveNavigation(normalizeNavigationState(entry?.key === key ? entry.state : null), scope, currentRead,
        entry?.key === key ? undefined : new URLSearchParams(location.search))
      setState(result.state); setNotice(result.notice); setVisit(v => v + 1); persist(result.state)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [key, scope, currentRead, persist])
  const safe = state ? resolveNavigation(state, scope, currentRead) : null
  const visible = safe?.state
  const destinationKey = visible ? JSON.stringify([visible.main, visible.collectionId, visible.collections[visible.collectionId ?? ""]?.view]) : "loading"
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => window.scrollTo({ top: navigationScroll(visible), behavior: "instant" }))
    return () => cancelAnimationFrame(frame)
    // Query edits should not reset scroll. Restore only when the destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey, visit])
  useEffect(() => {
    const save = () => {
      if (!stateRef.current) return
      const next = captureNavigationScroll(stateRef.current, window.scrollY)
      stateRef.current = next
      persist(next)
      history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: next } }, "")
    }
    window.addEventListener("scroll", save, { passive: true })
    window.addEventListener("pagehide", save)
    return () => { window.removeEventListener("scroll", save); window.removeEventListener("pagehide", save) }
  }, [key, persist])
  const update = useCallback((mutate: (s: CollectionNavigationState) => CollectionNavigationState) => {
    setState(old => {
      if (!old) return old
      const next = mutate(captureNavigationScroll(old, window.scrollY))
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
  }, [persist, key])
  const inventoryChange = useCallback((browse: InventoryViewState) => update(old => ({ ...old, inventory: { ...old.inventory, ...browse } })), [update])
  const navigate = (next: CollectionNavigationState, locationIntent: InventoryLocationIntent | null = null, latest = currentRead) => {
    const sequence = ++request.current
    closeAllOverlays()
    setPendingNavigation({ state: next, highlight: locationIntent, read: latest, sequence })
  }
  useEffect(() => {
    if (!pendingNavigation) return
    // Overlay cleanup must commit before requesting host history, matching the shared primitive.
    // The shared history listener may run before ours after a private host remount.
    // Wait until every listener has handled the cleanup pop before changing its entry ID.
    runAfterOverlayHistory(() => queueMicrotask(() => {
      if (!alive.current || request.current !== pendingNavigation.sequence) return
      request.current++
      if (stateRef.current) {
        const outgoing = captureNavigationScroll(stateRef.current, window.scrollY)
        history.replaceState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: outgoing } }, "")
      }
      const result = resolveNavigation(pendingNavigation.state, scope, pendingNavigation.read)
      const url = new URL(location.href)
      for (const param of ["binder", "view", "page", "slot", "item"]) url.searchParams.delete(param)
      url.searchParams.set("view", result.state.main === "collection" ? result.state.collections[result.state.collectionId ?? ""]?.view ?? "binder" : result.state.main)
      if (result.state.main === "collection" && result.state.collectionId) url.searchParams.set("binder", result.state.collectionId)
      entryId.current = crypto.randomUUID()
      history.pushState({ ...history.state, collectionNavigation: { key, id: entryId.current, state: result.state } }, "", url)
      persist(result.state); setState(result.state); setHighlight(pendingNavigation.highlight); setNotice(result.notice); setVisit(v => v + 1)
      setPendingNavigation(null)
    }))
  }, [pendingNavigation, scope, key, persist])

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
      const next = captureNavigationScroll(stateRef.current, window.scrollY), id = location.intent.collectionId
      next.main = "collection"; next.collectionId = id
      next.collections[id] = { ...defaultCollectionView(), page: location.page }
      // navigate validates against latest, not the outgoing evidence, on the next render.
      navigate(next, location.intent, latest)
    } catch { if (alive.current && request.current === sequence) setNotice("This location could not be refreshed. Your inventory is still open.") }
  }
  if (!visible) return <p role="status">Opening saved view…</p>
  const collectionId = visible.collectionId
  const collectionState = visible.collections[collectionId ?? ""] ?? defaultCollectionView()
  return <div className={styles.host}>
    <header className={styles.header}>
      <label>Collection<select aria-label="Collection" value={collectionId ?? ""} onChange={e => navigate({ ...visible, main: "collection", collectionId: e.target.value })}>
        {!collectionId && <option value="">No available storage</option>}{index.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
      {visible.main === "collection" && <label>View<select aria-label="Collection view" value={collectionState.view} onChange={e => navigate({ ...visible,
        collections: { ...visible.collections, [collectionId!]: { ...collectionState, view: e.target.value as "binder" | "list", scroll: 0 } } })}>
        <option value="binder">Binder</option><option value="list">List</option>
      </select></label>}
      <p>Inventory is what you own and where. Collections are your named storage arrangements.</p>
    </header>
    {(notice || safe?.notice) && <p role="status" className={styles.notice}>{notice || safe?.notice}</p>}
    {visible.main === "inventory" ? <InventoryView key={visit} scope={scope} evidence={index.kind === "unavailable" ? { kind: "unavailable" } : currentRead.evidence}
      catalog={currentRead.catalog} layouts={currentRead.layouts} initialBrowseState={visible.inventory} onBrowseStateChange={inventoryChange} onOpenLocation={intent => void openLocation(intent)} />
      : visible.main === "dex" ? <div key="dex">{renderNationalDex()}</div>
      : collectionId && index.kind !== "unavailable" ? <div key={`${destinationKey}:${visit}`}>{renderCollection({ read: currentRead, collectionId, state: collectionState, highlight,
        onChange: patch => update(old => ({ ...old, collections: { ...old.collections, [collectionId]: { ...collectionState, ...patch } } })) })}</div>
      : <p role="status">Collection unavailable. Open Inventory or National Dex.</p>}
    <nav aria-label="Collection navigation" className={styles.dock}>
      <button aria-current={visible.main === "collection" ? "page" : undefined} disabled={!collectionId} onClick={() => navigate({ ...visible, main: "collection" })}>Collections</button>
      <button aria-current={visible.main === "inventory" ? "page" : undefined} onClick={() => navigate({ ...visible, main: "inventory" })}>Inventory</button>
      <button aria-current={visible.main === "dex" ? "page" : undefined} onClick={() => navigate({ ...visible, main: "dex" })}>National Dex</button>
    </nav>
  </div>
}
