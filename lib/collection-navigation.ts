import type { InventoryBrowseEvidence, InventoryBrowseQuery, InventoryBrowseScope, InventoryCatalogEvidence, InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { buildInventoryBrowseIndex } from "@/lib/inventory-query"
import { resolveInventoryLocationIntent } from "@/lib/inventory-location"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"

/** Rotate on authentication/membership lifecycle changes, even if actor/owner later match again. */
export interface CollectionNavigationScope extends InventoryBrowseScope { sessionId: string }
export type CollectionNavigationFocus = Pick<InventoryLocationIntent, "collectionId" | "slotId"> & { itemId?: string }
export interface InventoryViewState { query: InventoryBrowseQuery; window: number }
export interface CollectionViewState { view: "binder" | "list" | "slabs"; page: number; search: string; scroll: number }
export interface CollectionNavigationState {
  main: "inventory" | "collection" | "dex"
  collectionId: string | null
  collections: Record<string, CollectionViewState>
  inventory: InventoryViewState & { scroll: number }
  dexView?: "list" | "wanted" | "sets" | "pokemon" | "analytics"
  dexScroll: number
  /** Exact Sets destination retained across surface remounts and history traversal. */
  requestedSet?: TCGSetSummary | null
}
/** Private in-memory host result, NEVER a JSON transport. The host authenticates both scope fields. */
export interface CollectionNavigationRead {
  defaultCollectionId?: string
  partnerUserId?: string | null
  scope: CollectionNavigationScope
  evidence: InventoryBrowseEvidence
  catalog: readonly InventoryCatalogEvidence[]
  layouts: readonly InventoryLayoutEvidence[]
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
const text = (v: unknown) => typeof v === "string" ? v.slice(0, 512) : ""
const integer = (v: unknown, max: number, min = 0) => typeof v === "number" && Number.isSafeInteger(v) ? Math.min(max, Math.max(min, v)) : min
export const defaultCollectionView = (view: CollectionViewState["view"] = "binder"): CollectionViewState => ({ view, page: 1, search: "", scroll: 0 })
export const navigationStorageKey = (scope: InventoryBrowseScope) => `holofolder-navigation-v1:${JSON.stringify([scope.accountUserId, scope.ownerUserId])}`
export function normalizeInventoryViewState(value: unknown): InventoryViewState {
  const v = object(value), q = object(v.query)
  const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => values.find(x => x === v)
  return { window: integer(v.window, 25000), query: {
    search: text(q.search), collectionId: text(q.collectionId), provider: text(q.provider), grade: text(q.grade),
    ...(typeof q.page === "number" && Number.isSafeInteger(q.page) && q.page >= 1 && q.page <= 4096 ? { page: q.page } : {}),
    assignment: oneOf(q.assignment, ["all", "assigned", "unassigned", "unknown"]),
    condition: oneOf(q.condition, ["all", "raw", "graded"]), sort: oneOf(q.sort, ["name", "set", "location", "grading", "id"]),
  } }
}
/** Whitelist presentation only. Ignore edit sessions, overlays, cursors, highlights and selections. */
export function normalizeNavigationState(value: unknown): CollectionNavigationState {
  const v = object(value), collections: Record<string, CollectionViewState> = Object.create(null)
  for (const [id, raw] of Object.entries(object(v.collections)).slice(0, 500)) {
    const c = object(raw)
    collections[id] = { view: c.view === "slabs" ? "slabs" : c.view === "list" ? "list" : "binder", page: integer(c.page, 4096, 1), search: text(c.search), scroll: integer(c.scroll, 10000000) }
  }
  const set = object(v.requestedSet)
  const requestedSet = v.main === "dex" && v.dexView === "sets" && text(set.id).trim() && text(set.name).trim()
    ? { id: text(set.id), name: text(set.name) }
    : null
  return { main: v.main === "collection" || v.main === "dex" ? v.main : "inventory", collectionId: typeof v.collectionId === "string" ? text(v.collectionId) : null,
    collections, inventory: { ...normalizeInventoryViewState(v.inventory), scroll: integer(object(v.inventory).scroll, 10000000) }, dexView: v.dexView === "wanted" || v.dexView === "sets" || v.dexView === "pokemon" || v.dexView === "analytics" ? v.dexView : "list", dexScroll: integer(v.dexScroll, 10000000), requestedSet }
}
// The navigation host asks for the index several times per render. One index is kept per read while its
// evidence, catalog, layouts and both scopes are the same objects and values; it is released with the read.
type NavigationIndex = ReturnType<typeof buildInventoryBrowseIndex>
const navigationIndexes = new WeakMap<CollectionNavigationRead, Pick<CollectionNavigationRead, "scope" | "evidence" | "catalog" | "layouts"> & { requested: string; provided: string; index: NavigationIndex }>()
export function navigationIndex(scope: CollectionNavigationScope, read: CollectionNavigationRead) {
  const requested = JSON.stringify(scope), provided = JSON.stringify(read.scope), saved = navigationIndexes.get(read)
  if (saved && saved.requested === requested && saved.provided === provided && saved.scope === read.scope && saved.evidence === read.evidence
    && saved.catalog === read.catalog && saved.layouts === read.layouts) return saved.index
  const matches = Boolean(scope.sessionId) && read.scope.sessionId === scope.sessionId && read.scope.accountUserId === scope.accountUserId && read.scope.ownerUserId === scope.ownerUserId
  const index = buildInventoryBrowseIndex(scope, matches ? read.evidence : { kind: "unavailable" }, read.catalog, read.layouts)
  navigationIndexes.set(read, { requested, provided, scope: read.scope, evidence: read.evidence, catalog: read.catalog, layouts: read.layouts, index })
  return index
}
/** Explicit links take priority, including old ?binder=&page= links. URL is not authorization. */
export function resolveNavigation(state: CollectionNavigationState, scope: CollectionNavigationScope, read: CollectionNavigationRead, params?: URLSearchParams, stagedSlabs = false) {
  const next = normalizeNavigationState(state), index = navigationIndex(scope, read)
  // Initialize presentation once from admitted storage, never overwrite a remembered view.
  if (index.kind !== "unavailable" && read.evidence.kind !== "unavailable") {
    for (const collection of read.evidence.snapshot.collections) {
      next.collections[collection.id] ??= defaultCollectionView(collection.defaultPresentation)
    }
  }
  let notice = ""
  let highlight: CollectionNavigationFocus | null = null
  if (params && ["binder", "view", "page", "slot", "item"].some(k => params.has(k))) {
    next.main = params.get("view") === "inventory" ? "inventory" : params.get("view") === "dex" ? "dex" : "collection"
    next.collectionId = params.get("binder") ?? next.collectionId
    if (next.collectionId) {
      const current = next.collections[next.collectionId] ?? defaultCollectionView()
      const targeted = params.has("page") || params.has("slot") || params.has("item")
      const view = !targeted && params.get("view") === "slabs" && stagedSlabs ? "slabs" : params.get("view") === "list" && !targeted ? "list" : !targeted && !params.has("view") ? current.view : "binder"
      const page = params.has("page") ? integer(Number(params.get("page")), 4096, 1) : current.page
      const sameDestination = state.main === next.main && state.collectionId === next.collectionId && current.view === view && current.page === page && !params.has("slot") && !params.has("item")
      next.collections[next.collectionId] = { ...current, view, page, search: targeted ? "" : current.search, scroll: sameDestination ? current.scroll : 0 }
      if (params.get("view") === "slabs" && view !== "slabs") notice = "Slabs view is not available yet. Showing Binder."
    }
  }
  for (const collection of Object.values(next.collections)) {
    if (collection.view === "slabs" && !stagedSlabs) {
      collection.view = "binder"; collection.scroll = 0
      notice = "Slabs view is not available yet. Showing Binder."
    }
  }
  // Missing/inaccessible and uncached collections never restore an old private screen.
  if (next.collectionId && !index.collections.some(c => c.id === next.collectionId)) {
    next.collectionId = index.collections[0]?.id ?? null
    if (next.main === "collection" && !next.collectionId) next.main = "inventory"
    notice = "That collection is unavailable on this device. Showing available storage."
  }
  if (!next.collectionId) next.collectionId = index.collections[0]?.id ?? null
  if (next.inventory.query.collectionId && !index.collections.some(c => c.id === next.inventory.query.collectionId)) {
    next.inventory.query.collectionId = ""; next.inventory.window = 0
    notice ||= "That storage filter is unavailable. Showing all saved storage."
  }
  if (next.main === "collection" && next.collectionId && params && (params.has("item") || params.has("slot"))) {
    const snapshot = read.evidence.kind === "complete" && index.kind === "complete" ? read.evidence.snapshot : null
    const slot = snapshot?.binders.find(b => b.collectionId === next.collectionId)?.slots.find(s => s.id === params.get("slot"))
    const itemId = params.get("item") ?? slot?.inventoryItemId
    const location = itemId ? navigationLocation(scope, read, { itemId, collectionId: next.collectionId, slotId: params.get("slot") ?? "" }) : null
    if (location?.kind === "assigned" && location.page !== null) {
      next.collectionId = location.intent.collectionId
      next.collections[next.collectionId] = { ...defaultCollectionView(), page: location.page }
      highlight = location.intent
    } else if (slot && !slot.inventoryItemId && !params.has("item") && snapshot) {
      const binder = snapshot.binders.find(b => b.collectionId === next.collectionId)!
      const layouts = read.layouts.filter(l => l.collectionId === next.collectionId && l.layoutRevision === binder.layoutRevision)
      const layout = layouts.length === 1 ? layouts[0] : null
      if (layout && [layout.rows, layout.cols].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 8)) {
        next.collections[next.collectionId] = { ...defaultCollectionView(), page: Math.floor(binder.slots.findIndex(s => s.id === slot.id) / (layout.rows * layout.cols)) + 1 }
        highlight = { collectionId: next.collectionId, slotId: slot.id }
      } else notice = "That slot's page is unavailable. Showing the available collection."
    } else notice = "That location is unavailable. Showing the available collection."
  }
  return { state: next, notice, highlight }
}
/** Refresh first, then re-resolve stable copy identity. Do not trust callback page/slot/collection. */
export function navigationLocation(scope: CollectionNavigationScope, read: CollectionNavigationRead, intent: InventoryLocationIntent) {
  if (navigationIndex(scope, read).kind !== "complete" || read.evidence.kind !== "complete") return { kind: "unknown" } as const
  return resolveInventoryLocationIntent(read.evidence.snapshot, intent, read.layouts)
}
export function navigationScroll(state: CollectionNavigationState) {
  return state.main === "inventory" ? state.inventory.scroll : state.main === "dex" ? state.dexScroll : state.collections[state.collectionId ?? ""]?.scroll ?? 0
}
export function captureNavigationScroll(state: CollectionNavigationState, scroll: number) {
  const next = normalizeNavigationState(state), safe = integer(Math.round(scroll), 10000000)
  if (next.main === "inventory") next.inventory.scroll = safe
  else if (next.main === "dex") next.dexScroll = safe
  else if (next.collectionId) next.collections[next.collectionId] = { ...(next.collections[next.collectionId] ?? defaultCollectionView()), scroll: safe }
  return next
}
