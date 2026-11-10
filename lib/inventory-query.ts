import { projectInventoryCollection, type InventoryCollectionProjection } from "@/lib/collection/inventory-projection"
import { indexCatalogCardIds } from "@/lib/card-catalog"
import { isCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import { normalizeInventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryBrowseEvidence, InventoryBrowseQuery, InventoryBrowseRow, InventoryBrowseScope,
  InventoryCatalogEvidence, InventoryLayoutEvidence } from "@/lib/domain/inventory-browse"
import { inventoryLocationLabel, resolveInventoryLocation, slotLocationLabel } from "@/lib/inventory-location"

export interface InventoryBrowseIndex {
  projection: InventoryCollectionProjection | null
  kind: "complete" | "cached" | "unavailable"
  /** Exact safe evidence key, stable across equivalent host renders. No private metadata. */
  key: string
  scope: InventoryBrowseScope
  rows: readonly InventoryBrowseRow[]
  collections: readonly { id: string; name: string }[]
  /** Readable binder/page/slot per wanted slot, keyed by inventoryWantSlotKey. */
  wantLocations: ReadonlyMap<string, string>
}
export const inventoryWantSlotKey = (want: { collectionId: string; slotId: string }) => JSON.stringify([want.collectionId, want.slotId])
const fold = (value: string) => value.normalize("NFKC").toLowerCase().trim()
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const compareKeys = (a: readonly string[], b: readonly string[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const result = compare(a[i], b[i]); if (result) return result }
  return a.length - b.length
}

/** A local projection, not a store or authentication boundary. Reject unbranded 'complete' payloads. */
export function buildInventoryBrowseIndex(scope: InventoryBrowseScope, evidence: InventoryBrowseEvidence,
  catalog: readonly InventoryCatalogEvidence[], layouts: readonly InventoryLayoutEvidence[]): InventoryBrowseIndex {
  const unavailable: InventoryBrowseIndex = { projection: null, kind: "unavailable", key: JSON.stringify([scope, "unavailable"]), scope, rows: [], collections: [], wantLocations: new Map() }
  if (!scope.accountUserId || !scope.ownerUserId || evidence.kind === "unavailable"
    || evidence.snapshot.ownerUserId !== scope.ownerUserId
    || evidence.kind === "complete" && !isCompleteInventorySnapshot(evidence.snapshot)) return unavailable
  const snapshot = normalizeInventorySnapshot(evidence.snapshot)
  if (!snapshot) return unavailable
  // One pass over the catalog, not one per copy: a full binder has hundreds of copies and thousands of printings.
  const catalogById = indexCatalogCardIds(catalog)
  const rows = snapshot.items.map((item): InventoryBrowseRow => {
    const identity = item.identity
    const matches = identity.kind === "card" ? (catalogById.get(identity.cardId) ?? [])
      .filter(e => !identity.language || e.card.language === identity.language) : []
    const display = matches.length === 1 ? matches[0] : undefined
    const grading = item.grading
    return { itemId: item.id, name: display?.card.name ?? null, cardId: identity.kind === "card" ? identity.cardId : null,
      speciesNames: identity.kind === "pokemon" ? [`Pokémon #${identity.pokemonId}`] : display?.speciesNames ?? [],
      setName: display?.card.set.name ?? null, setId: display?.card.set.id ?? null, number: display?.card.localId ?? null,
      image: display?.card.image ?? null, language: identity.kind === "card" ? identity.language ?? null : null,
      finish: identity.kind === "card" ? identity.finish ?? null : null, graded: grading !== null,
      provider: grading ? grading.provider.kind === "known" ? grading.provider.id.toUpperCase() : grading.provider.name : null,
      grade: grading?.grade ?? null, scale: grading?.scale ?? null,
      location: resolveInventoryLocation(snapshot, item.id, layouts, evidence.kind === "complete") }
  })
  const collections = snapshot.collections.map(c => ({ id: c.id, name: c.name }))
  const projection = projectInventoryCollection(snapshot, catalog, undefined, catalogById)
  const wantLocations = new Map<string, string>()
  for (const want of projection.wants) {
    const key = inventoryWantSlotKey(want)
    if (!wantLocations.has(key)) wantLocations.set(key, slotLocationLabel(snapshot, want.collectionId, want.slotId, layouts, evidence.kind === "complete"))
  }
  const key = JSON.stringify([scope, evidence.kind, snapshot.inventoryRevision,
    snapshot.items.map(i => [i.id, i.version]), snapshot.placements.map(p => [p.inventoryItemId, p.version]),
    snapshot.collections.map(c => [c.id, c.version]),
    snapshot.binders.map(b => [b.collectionId, b.layoutRevision, b.slots.map(s => [s.id, s.version])]), rows, collections,
    projection.owned.map(i => [i.itemId, i.pokemonIds, i.priceIdentity]),
    projection.wants.map(w => [w.collectionId, w.slotId, w.index, w.card.card_id, w.card.card_name, w.card.card_language, w.card.card_finish]), [...wantLocations]])
  return { projection, kind: evidence.kind, key, scope, rows, collections, wantLocations }
}

function queryKey(query: InventoryBrowseQuery) {
  return JSON.stringify([fold(query.search ?? ""), query.collectionId ?? "", query.assignment ?? "all", query.condition ?? "all",
    query.provider ?? "", query.grade ?? "", query.sort ?? "name", query.collectionId ? query.page ?? 0 : 0])
}
function rowKey(row: InventoryBrowseRow, sort: InventoryBrowseQuery["sort"]): string[] {
  const field = sort === "set" ? [row.setName ?? "", row.number ?? ""]
    : sort === "location" ? row.location.kind === "assigned" ? [row.location.collectionName, String(row.location.position ?? 0).padStart(16, "0")] : [row.location.kind]
    : sort === "grading" ? [row.provider ?? "", row.scale ?? "", row.grade ?? ""]
    : sort === "id" ? [] : [row.name ?? row.speciesNames.join(" ")]
  return [...field.map(fold), row.itemId]
}
/** Opaque in-memory keyset, deliberately scoped to one projection and query. Never persist it. */
export interface InventoryBrowseCursor { readonly evidenceKey: string; readonly query: string; readonly after: readonly string[] }
function orderedInventoryQuery(index: InventoryBrowseIndex, query: InventoryBrowseQuery) {
  const key = queryKey(query)
  const terms = fold(query.search ?? "").split(/\s+/).filter(Boolean)
  const filtered = index.rows.filter(row => {
    const text = fold([row.name, row.cardId, ...row.speciesNames, row.setName, row.setId, row.number].filter(Boolean).join(" "))
    return terms.every(term => text.includes(term))
      && (!query.collectionId || row.location.kind === "assigned" && row.location.intent.collectionId === query.collectionId)
      && (!query.collectionId || !query.page || row.location.kind === "assigned" && row.location.page === query.page)
      && (!query.assignment || query.assignment === "all" || row.location.kind === query.assignment)
      && (!query.condition || query.condition === "all" || (query.condition === "graded") === row.graded)
      && (!query.provider || row.provider === query.provider) && (!query.grade || row.grade === query.grade)
  })
  return { key, ordered: filtered.map(row => ({ row, key: rowKey(row, query.sort) })).sort((a, b) => compareKeys(a.key, b.key)) }
}

export function queryInventory(index: InventoryBrowseIndex, query: InventoryBrowseQuery = {},
  cursor: InventoryBrowseCursor | null = null, limit = 40) {
  const { key, ordered } = orderedInventoryQuery(index, query)
  const total = ordered.length
  if (cursor && (cursor.evidenceKey !== index.key || cursor.query !== key)) return { rows: [], total, next: null, invalidCursor: true }
  const window = ordered.filter(entry => !cursor || compareKeys(entry.key, cursor.after) > 0)
  const size = Number.isSafeInteger(limit) ? Math.max(1, Math.min(100, limit)) : 40
  const rows = window.slice(0, size).map(entry => entry.row)
  const last = rows.at(-1)
  const next: InventoryBrowseCursor | null = window.length > size && last ? { evidenceKey: index.key, query: key, after: rowKey(last, query.sort) } : null
  return { rows, total, next, invalidCursor: false }
}

/** Restore a presentation window from current evidence in one sort, never persist opaque keysets. */
export function restoreInventoryWindow(index: InventoryBrowseIndex, query: InventoryBrowseQuery, requestedWindow: number) {
  const { key, ordered } = orderedInventoryQuery(index, query)
  const window = Math.min(Number.isSafeInteger(requestedWindow) ? Math.max(0, requestedWindow) : 0, Math.max(0, Math.ceil(ordered.length / 40) - 1))
  const cursors: (InventoryBrowseCursor | null)[] = [null]
  for (let page = 1; page <= window; page++) cursors.push({ evidenceKey: index.key, query: key, after: ordered[page * 40 - 1].key })
  return { cursor: cursors.at(-1) ?? null, previous: cursors.slice(0, -1) }
}

/** Screen-reader names for selection checkboxes: card, printing and location, never internal IDs.
 * Identical copies on one page get "copy N" so every name stays distinct. */
export function inventorySelectLabels(rows: readonly InventoryBrowseRow[]): Map<string, string> {
  const labels = rows.map(r => `Select ${r.name ?? (r.speciesNames.join(", ") || "unknown card")}, ${r.setName ?? "set unknown"}${r.number ? ` #${r.number}` : ""}, ${inventoryLocationLabel(r.location)}`)
  const totals = new Map<string, number>(), seen = new Map<string, number>()
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1)
  return new Map(rows.map((r, i) => {
    const n = (seen.get(labels[i]) ?? 0) + 1; seen.set(labels[i], n)
    return [r.itemId, totals.get(labels[i])! > 1 ? `${labels[i]}, copy ${n}` : labels[i]]
  }))
}
export function inventoryGradingLabel(row: InventoryBrowseRow) {
  return row.graded ? `${row.provider} · ${row.grade ?? "Grade unknown"}${row.scale ? ` · Scale ${row.scale}` : ""}` : "Raw"
}
