"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { runAfterOverlayHistory } from "@/hooks/use-overlay"
import CardImage from "@/components/card-image"
import type { InventoryBrowseEvidence, InventoryBrowseQuery, InventoryBrowseScope, InventoryCatalogEvidence,
  InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { buildInventoryBrowseIndex, inventoryGradingLabel, queryInventory, restoreInventoryWindow,
  type InventoryBrowseCursor, type InventoryBrowseIndex } from "@/lib/inventory-query"
import { inventoryLocationLabel } from "@/lib/inventory-location"
import { normalizeInventoryViewState, type InventoryViewState } from "@/lib/collection-navigation"
import { selectInventoryCollection, valueInventoryCollection } from "@/lib/collection/inventory-projection"
import { useInventoryPrices } from "@/hooks/use-inventory-prices"
import type { PricingRegion } from "@/lib/pricing-region"
import type { InventoryOwnershipBinding } from "@/lib/inventory-actions"
import styles from "./inventory.module.css"

const InventoryBulkReview = dynamic(() => import("./inventory-ownership").then(module => module.InventoryBulkReview), { ssr: false })
const InventoryAddOwned = dynamic(() => import("./inventory-ownership").then(module => module.InventoryAddOwned), { ssr: false })
const InventoryDetail = dynamic(() => import("./inventory-detail"), { ssr: false })
export interface InventoryViewProps {
  ownership?: InventoryOwnershipBinding
  onEditGrading?: (itemId: string) => void
  pricingRegion?: PricingRegion
  initialBrowseState?: InventoryViewState
  onBrowseStateChange?: (state: InventoryViewState) => void
  scope: InventoryBrowseScope
  evidence: InventoryBrowseEvidence
  catalog: readonly InventoryCatalogEvidence[]
  layouts: readonly InventoryLayoutEvidence[]
  /** Host re-resolves the stable IDs against current authorized evidence before navigating. */
  onOpenLocation?: (intent: InventoryLocationIntent) => void
}
export default function InventoryView({ scope, evidence, catalog, layouts, onOpenLocation, onEditGrading, initialBrowseState, onBrowseStateChange, ownership, pricingRegion = "UK" }: InventoryViewProps) {
  const index = useMemo(() => buildInventoryBrowseIndex(scope, evidence, catalog, layouts), [scope, evidence, catalog, layouts])
  const activeOwnership = index.kind === "complete" && evidence.kind === "complete" && ownership?.snapshot.ownerUserId === scope.ownerUserId
    && ownership.snapshot.inventoryRevision === evidence.snapshot.inventoryRevision ? ownership : undefined
  // Synchronous remount prevents even a single paint of another account's selection/query/cursor.
  return <InventoryResults key={index.key} index={index} ownership={activeOwnership} pricingRegion={pricingRegion} onOpenLocation={onOpenLocation} onEditGrading={onEditGrading} initialBrowseState={initialBrowseState} onBrowseStateChange={onBrowseStateChange} />
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>
}
function InventoryResults({ index, pricingRegion = "UK", onOpenLocation, onEditGrading, initialBrowseState, onBrowseStateChange, ownership }: Pick<InventoryViewProps, "ownership" | "pricingRegion" | "onEditGrading" | "onOpenLocation" | "initialBrowseState" | "onBrowseStateChange"> & { index: InventoryBrowseIndex }) {
  const [initial] = useState(() => {
    const state = normalizeInventoryViewState(initialBrowseState)
    return { query: state.query, ...restoreInventoryWindow(index, state.query, state.window) }
  })
  const [query, setQuery] = useState<InventoryBrowseQuery>(initial.query)
  const [cursor, setCursor] = useState<InventoryBrowseCursor | null>(initial.cursor)
  const [previous, setPrevious] = useState<(InventoryBrowseCursor | null)[]>(initial.previous)
  useEffect(() => { onBrowseStateChange?.({ query, window: previous.length }) }, [query, previous.length, onBrowseStateChange])
  const [selected, setSelected] = useState<string | null>(null)
  const [bulkIds, setBulkIds] = useState<string[]>([])
  const [bulkReview, setBulkReview] = useState(false)
  const [adding, setAdding] = useState(false)
  const pendingInspect = useRef<string | null>(null)
  useEffect(() => {
    if (adding || !pendingInspect.current) return
    const id = pendingInspect.current; pendingInspect.current = null
    runAfterOverlayHistory(() => setSelected(id))
  }, [adding])
  const pendingGrading = useRef<string | null>(null)
  useEffect(() => {
    if (selected || !pendingGrading.current) return
    const id = pendingGrading.current
    pendingGrading.current = null
    runAfterOverlayHistory(() => onEditGrading?.(id))
  }, [selected, onEditGrading])
  const pendingLocation = useRef<InventoryLocationIntent | null>(null)
  useEffect(() => {
    if (selected || !pendingLocation.current) return
    const intent = pendingLocation.current
    pendingLocation.current = null
    runAfterOverlayHistory(() => onOpenLocation?.(intent))
  }, [selected, onOpenLocation])
  const result = queryInventory(index, query, cursor)
  const row = index.rows.find(r => r.itemId === selected)
  const providers = [...new Set(index.rows.flatMap(r => r.provider ? [r.provider] : []))].sort()
  const grades = [...new Set(index.rows.filter(r => !query.provider || r.provider === query.provider).flatMap(r => r.grade ? [r.grade] : []))].sort()
  const change = (patch: Partial<InventoryBrowseQuery>) => { setQuery(q => ({ ...q, ...patch })); setCursor(null); setPrevious([]); setSelected(null) }
  const count = index.rows.length
  const projection = useMemo(() => index.projection ? selectInventoryCollection(index.projection, query.collectionId) : null, [index, query.collectionId])
  const prices = useInventoryPrices(index.projection?.priceRequests ?? [])
  const valuation = projection ? valueInventoryCollection(projection, prices, pricingRegion) : null
  return <section className={styles.view} aria-label="Inventory">
    <header><h1>Inventory</h1><p>What you own and where it is stored.</p></header>
    {ownership?.available && index.kind === "complete" && <button type="button" className="min-h-11 rounded-xl border border-border px-3" onClick={() => setAdding(true)}>Add owned card</button>}
    {index.kind === "unavailable" ? <div role="status" className={styles.notice}>
      <h2>Inventory unavailable</h2><p>A complete inventory could not be loaded. Your existing collection has not been counted here. Try again when inventory is available.</p>
    </div> : <>
      {index.kind === "cached" && <p role="status" className={styles.notice}>Cached only. Showing saved copies, not your whole inventory. Uncached copies and current locations may be missing.</p>}
      <p aria-live="polite">{index.kind === "cached" ? `${count} cached copies` : `${count} owned ${count === 1 ? "copy" : "copies"}`} · {result.total} matching</p>
      {projection && valuation && <section aria-label="Storage totals" className={styles.notice}>
        <h2>{query.collectionId ? "This storage" : "All storage"}{index.kind === "cached" ? " · Cached only" : ""}</h2>
        <p>{projection.owned.length} owned {projection.owned.length === 1 ? "copy" : "copies"} · {projection.wants.length} explicit wants · {projection.speciesIds.length} known species</p>
        {projection.unknownSpeciesCopies > 0 && <p>{projection.unknownSpeciesCopies} {projection.unknownSpeciesCopies === 1 ? "copy has" : "copies have"} unknown species metadata</p>}
        <p>Saved raw value: {valuation.rawPricedCopies ? `£${valuation.rawTotalGbp.toFixed(2)}` : "Unknown"} · {valuation.rawPricedCopies} priced · {valuation.rawUnknownCopies} raw unpriced</p>
        {valuation.gradedUnknownCopies > 0 && <p>{valuation.gradedUnknownCopies} graded {valuation.gradedUnknownCopies === 1 ? "value" : "values"} unknown, excluded from raw total</p>}
        <p>Saved evidence only. Totals follow storage scope, before search and copy filters.</p>
        {projection.wants.length > 0 && <details><summary>Explicit wants by destination</summary><ul aria-label="Explicit wants">{projection.wants.map(w =>
          <li key={JSON.stringify([w.collectionId, w.slotId, w.index])}>{w.card.card_name} · {w.card.card_language ?? "Language unknown"} · {w.card.card_finish ?? "Finish unknown"} · Slot {w.slotId}</li>)}</ul></details>}
      </section>}
      {ownership?.available && <section aria-label="Inventory selection" className={styles.ownership}>
        <p aria-live="polite">{bulkIds.length} selected across pages and filters. Only individually selected raw copies are included.</p>
        <div className={styles.actions}><button type="button" disabled={!bulkIds.length} onClick={() => setBulkReview(true)}>Move / Unassign selected</button>
        <button type="button" disabled={!bulkIds.length} onClick={() => setBulkIds([])}>Clear selection</button></div>
        <p>Graded copies can be inspected individually; bulk ownership actions support raw copies only.</p>
      </section>}
      <Field label="Search inventory"><input type="search" value={query.search ?? ""} onChange={e => change({ search: e.target.value })} placeholder="Card, Pokémon, set or number" /></Field>
      <div className={styles.filters}>
        <Field label="Storage"><select value={query.collectionId ?? ""} onChange={e => change({ collectionId: e.target.value })}>
          <option value="">All storage</option>{index.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></Field>
        <Field label="Assignment"><select value={query.assignment ?? "all"} onChange={e => change({ assignment: e.target.value as InventoryBrowseQuery["assignment"] })}>
          <option value="all">All assignments</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>
          {index.kind === "cached" && <option value="unknown">Location unavailable</option>}
        </select></Field>
        <Field label="Condition"><select value={query.condition ?? "all"} onChange={e => change({ condition: e.target.value as InventoryBrowseQuery["condition"] })}>
          <option value="all">Raw and graded</option><option value="raw">Raw</option><option value="graded">Graded</option>
        </select></Field>
        <Field label="Provider"><select value={query.provider ?? ""} onChange={e => change({ provider: e.target.value, grade: "" })}>
          <option value="">All providers</option>{providers.map(p => <option key={p}>{p}</option>)}
        </select></Field>
        <Field label="Recorded grade"><select value={query.grade ?? ""} onChange={e => change({ grade: e.target.value })}>
          <option value="">All grades</option>{grades.map(g => <option key={g}>{g}</option>)}
        </select></Field>
        <Field label="Sort"><select value={query.sort ?? "name"} onChange={e => change({ sort: e.target.value as InventoryBrowseQuery["sort"] })}>
          <option value="name">Card name</option><option value="set">Set / number</option><option value="location">Location</option>
          <option value="grading">Provider / scale / grade text</option><option value="id">Copy ID</option>
        </select></Field>
      </div>
      {!result.total ? <div role="status" className={styles.notice}><h2>{count ? "No matching copies" : index.kind === "cached" ? "No copies cached" : "No owned copies"}</h2>
        <p>{count ? "Try another search or filter." : index.kind === "cached" ? "Connect to load your inventory. This does not mean you own no cards." : "Targets, wants and showcase references do not count as owned copies."}</p></div> : <>
        <ul className={styles.list} aria-label="Owned copies">{result.rows.map(r => {
          const value = valuation?.copies.find(c => c.itemId === r.itemId)
          return <li key={r.itemId}>
          {ownership?.available && <label className={styles.bulkSelect}><input type="checkbox" aria-label={`Select copy ${r.itemId}`} disabled={r.graded} checked={bulkIds.includes(r.itemId)} onChange={e => setBulkIds(ids => e.target.checked ? [...ids, r.itemId] : ids.filter(id => id !== r.itemId))} />Select raw copy</label>}
          <button type="button" className={styles.copy} data-item-id={r.itemId} onClick={() => setSelected(r.itemId)}>
            <span className={styles.art}>{r.image ? <CardImage src={r.image} alt="" sizes="56px" width={56} height={78} /> : <span>Image<br />unknown</span>}</span>
            <span className={styles.copyText}><strong>{r.name ?? (r.speciesNames.length ? r.speciesNames.join(", ") : "Unknown card")}</strong>
              <span>{r.setName ?? "Set unknown"} · {r.number ? `#${r.number}` : "Number unknown"}</span>
              <span>{r.language ?? "Language unknown"} · {r.finish ?? "Finish unknown"}</span>
              {value?.referenceGbp != null
                ? <span>{value.basis === "raw-reference" ? "Raw reference, not graded value" : "Saved raw quote"}: £{value.referenceGbp.toFixed(2)} · {value.quote?.confidence} confidence · {value.quote?.updatedAt ? `Updated ${value.quote.updatedAt.slice(0, 10)}` : "Date unknown"}</span>
                : <span>{r.graded ? "Graded value unknown" : "Raw value unknown"}</span>}
              <span className={styles.grading}>{inventoryGradingLabel(r)}</span>
              <span>{index.kind === "cached" ? "Last saved: " : ""}{inventoryLocationLabel(r.location)}</span>
            </span>
          </button>
        </li> })}</ul>
        <nav aria-label="Inventory pages" className={styles.pagination}>
          {previous.length > 0 && <button type="button" onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(p => p.slice(0, -1)) }}>Previous copies</button>}
          <span>{previous.length * 40 + 1}–{previous.length * 40 + result.rows.length} of {result.total}</span>
          {result.next && <button type="button" onClick={() => { setPrevious(p => [...p, cursor]); setCursor(result.next) }}>Next copies</button>}
        </nav>
      </>}
    </>}
    {bulkReview && ownership?.available && <InventoryBulkReview binding={ownership} itemIds={bulkIds} onClose={() => setBulkReview(false)} onAccepted={() => { setBulkReview(false); setBulkIds([]) }} />}
    {adding && ownership?.available && index.kind === "complete" && <InventoryAddOwned binding={ownership} onClose={() => setAdding(false)} onInspect={id => { pendingInspect.current = id; setAdding(false) }} />}
    {row && <InventoryDetail row={row} ownership={ownership} onEditGrading={onEditGrading ? () => { pendingGrading.current = row.itemId; setSelected(null) } : undefined} cached={index.kind === "cached"} onClose={() => setSelected(null)} onOpenLocation={onOpenLocation ? intent => { pendingLocation.current = intent; setSelected(null) } : undefined} />}
  </section>
}
