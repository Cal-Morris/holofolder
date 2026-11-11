"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Check, X } from "lucide-react"
import { runAfterOverlayHistory } from "@/hooks/use-overlay"
import CardImage from "@/components/card-image"
import { ListClearButton, ListControls, ListFiltersButton, ListSearch, ListSelect } from "@/components/list-controls"
import type { InventoryBrowseEvidence, InventoryBrowseQuery, InventoryBrowseScope, InventoryCatalogEvidence,
  InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { buildInventoryBrowseIndex, inventoryGradingLabel, inventorySelectLabels, inventoryWantSlotKey, inventoryWindowRows,
  type InventoryBrowseIndex } from "@/lib/inventory-query"
import { inventoryLocationLabel, slotLocationLabel } from "@/lib/inventory-location"
import { browserHostDisplayCatalog } from "@/lib/collection/browser-host-catalog"
import { describeIdentity } from "@/lib/pocket-labels"
import type { InventoryLabels } from "./inventory-ownership"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import { normalizeInventoryViewState, type InventoryViewState } from "@/lib/collection-navigation"
import { selectInventoryCollection, valueInventoryCollection } from "@/lib/collection/inventory-projection"
import { useInventoryPriceState } from "@/hooks/use-inventory-prices"
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
  /** Why this may not be the very latest: still loading the latest, offline, or the last update failed. */
  savedState?: InventorySavedState
}
export type InventorySavedState = "updating" | "offline" | "last-saved"
export default function InventoryView({ scope, evidence, catalog, layouts, onOpenLocation, onEditGrading, initialBrowseState, onBrowseStateChange, ownership, pricingRegion = "UK", savedState }: InventoryViewProps) {
  const index = useMemo(() => buildInventoryBrowseIndex(scope, evidence, catalog, layouts), [scope, evidence, catalog, layouts])
  const activeOwnership = index.kind === "complete" && evidence.kind === "complete" && ownership?.snapshot.ownerUserId === scope.ownerUserId
    && ownership.snapshot.inventoryRevision === evidence.snapshot.inventoryRevision ? ownership : undefined
  // Synchronous remount prevents even a single paint of another account's selection/query/cursor.
  const labels = useMemo<InventoryLabels | undefined>(() => {
    if (evidence.kind === "unavailable") return undefined
    const snapshot = evidence.snapshot, namer = browserHostDisplayCatalog(catalog)
    return { place: (collectionId, slotId) => slotLocationLabel(snapshot, collectionId, slotId, layouts, evidence.kind === "complete"), card: identity => describeIdentity(identity, namer) }
  }, [evidence, catalog, layouts])
  return <InventoryResults key={index.key} index={index} labels={labels} savedState={savedState} ownership={activeOwnership} pricingRegion={pricingRegion} onOpenLocation={onOpenLocation} onEditGrading={onEditGrading} initialBrowseState={initialBrowseState} onBrowseStateChange={onBrowseStateChange} />
}

const gradedBulkNote = "Graded cards are moved one at a time. Open the card to move it."
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>
}
function InventoryResults({ index, labels, savedState, pricingRegion = "UK", onOpenLocation, onEditGrading, initialBrowseState, onBrowseStateChange, ownership }: Pick<InventoryViewProps, "ownership" | "pricingRegion" | "onEditGrading" | "onOpenLocation" | "initialBrowseState" | "onBrowseStateChange" | "savedState"> & { index: InventoryBrowseIndex; labels?: InventoryLabels }) {
  const [initial] = useState(() => {
    const state = normalizeInventoryViewState(initialBrowseState)
    if (state.query.assignment === "assigned") state.query.assignment = "all"
    return state
  })
  const [query, setQuery] = useState<InventoryBrowseQuery>(initial.query)
  const [requestedWindow, setWindow] = useState(initial.window)
  const result = useMemo(() => inventoryWindowRows(index, query, requestedWindow), [index, query, requestedWindow])
  useEffect(() => { onBrowseStateChange?.({ query, window: result.window }) }, [query, result.window, onBrowseStateChange])
  const more = result.rows.length < result.total
  const showMore = () => setWindow(result.window + 1)
  // Load the next 40 before the end of the list scrolls into view. Re-observing after each load
  // keeps going while the button stays visible (tall screens); the button itself still works without it.
  const moreRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const button = moreRef.current
    if (!button || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setWindow(result.window + 1) }, { rootMargin: "0px 0px 800px 0px" })
    observer.observe(button)
    return () => observer.disconnect()
  }, [result.window, more])
  const [selected, setSelected] = useState<string | null>(null)
  const [bulkIds, setBulkIds] = useState<string[]>([])
  // Selecting is a deliberate mode: tiles then toggle instead of opening.
  const [selecting, setSelecting] = useState(false)
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
  const selectLabels = inventorySelectLabels(result.rows)
  const row = index.rows.find(r => r.itemId === selected)
  const providers = [...new Set(index.rows.flatMap(r => r.provider ? [r.provider] : []))].sort()
  const grades = [...new Set(index.rows.filter(r => !query.provider || r.provider === query.provider).flatMap(r => r.grade ? [r.grade] : []))].sort()
  const change = (patch: Partial<InventoryBrowseQuery>) => { setQuery(q => ({ ...q, ...patch })); setWindow(0); setSelected(null) }
  const count = index.rows.length
  const projection = useMemo(() => index.projection ? selectInventoryCollection(index.projection, query.collectionId) : null, [index, query.collectionId])
  const { prices, status: priceStatus } = useInventoryPriceState(index.projection?.priceRequests ?? [])
  const valuation = projection ? valueInventoryCollection(projection, prices, pricingRegion) : null
  // Where a card is belongs to the scope chips. Filters are only about the card itself.
  const scoped = Boolean(query.collectionId || query.page || query.assignment && query.assignment !== "all")
  const filtersActive = [query.condition !== "all" && query.condition, query.provider, query.grade].filter(Boolean).length
  const [filtersOpen, setFiltersOpen] = useState(() => filtersActive > 0)
  const hasGraded = index.rows.some(r => r.graded)
  const searching = Boolean(query.search?.trim()) || scoped || filtersActive > 0
  const pounds = (amount: number) => `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // Pages of the chosen collection that hold at least one card, so a page can be picked directly.
  const scopePages = useMemo(() => query.collectionId ? [...new Set(index.rows.flatMap(r => r.location.kind === "assigned" && r.location.intent.collectionId === query.collectionId && r.location.page ? [r.location.page] : []))].sort((a, b) => a - b) : [],
    [index, query.collectionId])
  // One quiet line, only when what is shown may not be the very latest.
  const savedLine = index.kind !== "cached" ? null : savedState === "offline" ? "Offline · showing what was last saved on this device"
    : savedState === "updating" ? "Updating…" : "Showing what was last saved on this device"
  return <section className={styles.view} aria-label="Inventory">
    <header className={styles.header}><h1>Inventory</h1>
      <div className={styles.headerActions}>
        {ownership?.available && count > 0 && <button type="button" className={styles.add} aria-pressed={selecting} onClick={() => { setSelecting(on => !on); setBulkIds([]) }}>{selecting ? "Done" : "Select"}</button>}
        {ownership?.available && index.kind === "complete" && !selecting && <button type="button" className={styles.add} onClick={() => setAdding(true)}>Add owned card</button>}
      </div>
    </header>
    {index.kind === "unavailable" ? <div role="status" className={styles.notice}>
      <h2>Your cards couldn&apos;t be loaded</h2><p>{savedState === "offline" ? "You're offline and nothing is saved on this device yet. Connect to load your collection." : "Check your connection and try again in a moment. Nothing has been changed."}</p>
    </div> : <>
      <p aria-live="polite" className={styles.count}>{searching ? `${result.total} of ${count} ${count === 1 ? "card" : "cards"}` : `${count} ${count === 1 ? "card" : "cards"}`}{savedLine && <span data-saved-state={savedState ?? "last-saved"}> · {savedLine}</span>}</p>
      {projection && valuation && <details aria-label="Collection totals" role="region" className={styles.totals}>
        <summary>{valuation.rawPricedCopies ? <span><strong>Worth about {pounds(valuation.rawTotalGbp)}</strong> · {valuation.rawPricedCopies} of {valuation.rawPricedCopies + valuation.rawUnknownCopies} cards priced</span>
            : <span>{priceStatus === "loading" ? "Loading saved prices…" : priceStatus === "unavailable" ? "Saved prices couldn't be loaded" : "No saved prices yet"}</span>}</summary>
        <p>{projection.owned.length} {projection.owned.length === 1 ? "card" : "cards"} · {projection.wants.length} wanted · {projection.speciesIds.length} Pokémon</p>
        {projection.unknownSpeciesCopies > 0 && <p>{projection.unknownSpeciesCopies} {projection.unknownSpeciesCopies === 1 ? "card isn't" : "cards aren't"} linked to a Pokémon</p>}
        {valuation.gradedUnknownCopies > 0 && <p>{valuation.gradedUnknownCopies} graded {valuation.gradedUnknownCopies === 1 ? "card isn't" : "cards aren't"} valued, so {valuation.gradedUnknownCopies === 1 ? "it's" : "they're"} left out of the total</p>}
        <p className={styles.muted}>From saved prices for ungraded cards. The total covers {query.collectionId ? "this collection" : "everything"}, whatever you search for.</p>
        {projection.wants.length > 0 && <details><summary>Wanted cards and where they go</summary><ul aria-label="Wanted cards" className={styles.wants}>{projection.wants.map(w =>
          <li key={JSON.stringify([w.collectionId, w.slotId, w.index])}>{[w.card.card_name, w.card.card_language ? formatCardLanguageLabel(w.card.card_language) : null, w.card.card_finish ? formatCardFinishLabel(w.card.card_finish) : null, index.wantLocations.get(inventoryWantSlotKey(w)) ?? "Location unknown"].filter(Boolean).join(" · ")}</li>)}</ul></details>}
      </details>}
      {index.collections.length > 0 && <div role="group" aria-label="Show cards from" className={styles.scopes}>
        <button type="button" aria-pressed={!query.collectionId && query.assignment !== "unassigned" && query.assignment !== "unknown"} onClick={() => change({ collectionId: "", page: undefined, assignment: "all" })}>All collections</button>
        {index.collections.map(c => <button key={c.id} type="button" aria-pressed={query.collectionId === c.id} onClick={() => change({ collectionId: c.id, page: undefined, assignment: "all" })}>{c.name}</button>)}
        <button type="button" aria-pressed={!query.collectionId && query.assignment === "unassigned"} onClick={() => change({ collectionId: "", page: undefined, assignment: "unassigned" })}>Not in a binder</button>
        {index.kind === "cached" && index.rows.some(r => r.location.kind === "unknown") && <button type="button" aria-pressed={!query.collectionId && query.assignment === "unknown"} onClick={() => change({ collectionId: "", page: undefined, assignment: "unknown" })}>Location unknown</button>}
      </div>}
      {query.collectionId && scopePages.length > 1 && <div role="group" aria-label="Page" className={styles.scopes}>
        <button type="button" aria-pressed={!query.page} onClick={() => change({ page: undefined })}>All pages</button>
        {scopePages.map(page => <button key={page} type="button" aria-pressed={query.page === page} onClick={() => change({ page })}>Page {page}</button>)}
      </div>}
      <ListControls>
        <ListSearch label="Search inventory" value={query.search ?? ""} onChange={e => change({ search: e.target.value })} placeholder="Search card, Pokémon, set or number" />
        <ListSelect label="Sort" value={query.sort ?? "name"} onChange={e => change({ sort: e.target.value as InventoryBrowseQuery["sort"] })}>
          <option value="name">Card name</option><option value="set">Set / number</option><option value="location">Location</option>
          <option value="grading">Grading</option>{query.sort === "id" && <option value="id">Unsorted</option>}
        </ListSelect>
        {/* Raw or graded only matters once there is a graded card to tell apart. */}
        {(hasGraded || filtersActive > 0) && <ListFiltersButton active={filtersActive} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)} />}
        {filtersActive > 0 && <ListClearButton onClick={() => change({ condition: "all", provider: "", grade: "" })} />}
      </ListControls>
      {filtersOpen && (hasGraded || filtersActive > 0) && <div role="group" aria-label="Filters" className={styles.filters}>
        <div role="group" aria-label="Condition" className={styles.scopes}>
          {([["all", "Raw and graded"], ["raw", "Raw"], ["graded", "Graded"]] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={(query.condition ?? "all") === value} onClick={() => change({ condition: value, ...(value === "raw" ? { provider: "", grade: "" } : {}) })}>{label}</button>)}
        </div>
        {providers.length > 0 && query.condition !== "raw" && <>
          <Field label="Graded by"><select aria-label="Graded by" value={query.provider ?? ""} onChange={e => change({ provider: e.target.value, grade: "" })}>
            <option value="">Anyone</option>{providers.map(p => <option key={p}>{p}</option>)}
          </select></Field>
          <Field label="Grade"><select aria-label="Grade" value={query.grade ?? ""} onChange={e => change({ grade: e.target.value })}>
            <option value="">All grades</option>{grades.map(g => <option key={g}>{g}</option>)}
          </select></Field>
        </>}
      </div>}
      {ownership?.available && selecting && <section aria-label="Inventory selection" className={styles.selection}>
        <p aria-live="polite">{bulkIds.length ? `${bulkIds.length} selected` : "Tap cards to select"}</p>
        <button type="button" disabled={!bulkIds.length} onClick={() => setBulkReview(true)}>Move</button>
        {bulkIds.length > 0 && <button type="button" aria-label="Clear selection" onClick={() => setBulkIds([])}><X size={18} aria-hidden /></button>}
      </section>}
      {!result.total ? <div role="status" className={styles.notice}><h2>{count ? "No cards match" : index.kind === "cached" ? "Nothing saved on this device yet" : "No cards yet"}</h2>
        <p>{count ? scoped || filtersActive ? "Try another search, or look in a different place." : "Try another search." : index.kind === "cached" ? "Connect to load your collection. This doesn't mean you own no cards." : "Cards you add to a binder or with Add owned card show up here."}</p></div> : <>
        {/* A wall of cards: the art first, then what it is, where it sits and what it is worth. */}
        <ul className={styles.grid} aria-label="Owned copies">{result.rows.map(r => {
          const selectLabel = selectLabels.get(r.itemId)
          const value = valuation?.copies.find(c => c.itemId === r.itemId)
          const name = r.name ?? (r.speciesNames.length ? r.speciesNames.join(", ") : "Unknown card")
          const checked = bulkIds.includes(r.itemId)
          const toggle = () => { if (!r.graded) setBulkIds(ids => checked ? ids.filter(id => id !== r.itemId) : [...ids, r.itemId]) }
          const place = r.location.kind === "assigned" && r.location.page !== null
            ? `${query.collectionId ? "" : `${r.location.collectionName} · `}Page ${r.location.page} · Pocket ${r.location.slot}` : r.location.kind === "unassigned" ? "Not in a binder" : inventoryLocationLabel(r.location)
          return <li key={r.itemId} className={styles.tile} data-selected={checked || undefined}>
            <button type="button" className={styles.copy} data-item-id={r.itemId} aria-label={selecting ? undefined : `${name}, ${[r.setName, r.number ? `#${r.number}` : null].filter(Boolean).join(" ")}, ${place}`}
              aria-hidden={selecting || undefined} tabIndex={selecting ? -1 : undefined} title={selecting && r.graded ? gradedBulkNote : undefined} onClick={() => selecting ? toggle() : setSelected(r.itemId)}>
              <span className={styles.art}>{r.image ? <CardImage src={r.image} alt="" fill sizes="(max-width: 639px) 33vw, 160px" /> : <span>No image</span>}
                {r.graded && <span className={styles.gradeBadge}>{inventoryGradingLabel(r)}</span>}
              </span>
              <span className={styles.copyText}><strong>{name}</strong>
                <span>{[r.setName, r.number ? `#${r.number}` : null].filter(Boolean).join(" · ") || "Set unknown"}</span>
                <span>{[r.language ? formatCardLanguageLabel(r.language) : null, r.finish ? formatCardFinishLabel(r.finish) : null].filter(Boolean).join(" · ")}</span>
                <span className={styles.place}>{r.location.kind === "assigned" && r.location.page !== null
                  ? <>{!query.collectionId && <span>{r.location.collectionName}</span>}<span>Page {r.location.page} · Pocket {r.location.slot}</span></> : <span>{place}</span>}</span>
                {value?.referenceGbp != null
                  ? <span className={styles.muted}><span className={styles.price}>£{value.referenceGbp.toFixed(2)}</span>{value.basis === "raw-reference" ? " ungraded" : ""}{value.quote?.confidence === "low" ? " · rough" : ""}</span>
                  : <span className={styles.muted}>{priceStatus === "loading" ? <span className={styles.priceSkeleton} aria-label="Loading price" /> : r.graded ? "Not valued" : "No price"}</span>}
              </span>
            </button>
            {ownership?.available && selecting && <label className={styles.tileSelect} title={r.graded ? gradedBulkNote : undefined}>
              <input type="checkbox" aria-label={selectLabel} aria-describedby={r.graded ? "inventory-graded-bulk-note" : undefined} disabled={r.graded} checked={checked} onChange={toggle} />
              <span aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>
            </label>}
          </li> })}</ul>
        {ownership?.available && <p id="inventory-graded-bulk-note" className="sr-only">{gradedBulkNote}</p>}
        <nav aria-label="Inventory pages" className={styles.pagination}>
          <span>{result.rows.length} of {result.total}</span>
          {more && <button ref={moreRef} type="button" onClick={showMore}>Show more</button>}
        </nav>
      </>}
    </>}
    {bulkReview && ownership?.available && labels && <InventoryBulkReview binding={ownership} labels={labels} itemIds={bulkIds} onClose={() => setBulkReview(false)} onAccepted={() => { setBulkReview(false); setBulkIds([]); setSelecting(false) }} />}
    {adding && ownership?.available && index.kind === "complete" && <InventoryAddOwned binding={ownership} onClose={() => setAdding(false)} onInspect={id => { pendingInspect.current = id; setAdding(false) }} />}
    {row && <InventoryDetail row={row} labels={labels} pricingRegion={pricingRegion} ownership={ownership} onEditGrading={onEditGrading ? () => { pendingGrading.current = row.itemId; setSelected(null) } : undefined} cached={index.kind === "cached"} onClose={() => setSelected(null)} onOpenLocation={onOpenLocation ? intent => { pendingLocation.current = intent; setSelected(null) } : undefined} />}
  </section>
}
