"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { runAfterOverlayHistory } from "@/hooks/use-overlay"
import CardImage from "@/components/card-image"
import type { InventoryBrowseEvidence, InventoryBrowseQuery, InventoryBrowseScope, InventoryCatalogEvidence,
  InventoryLayoutEvidence, InventoryLocationIntent } from "@/lib/domain/inventory-browse"
import { buildInventoryBrowseIndex, inventoryGradingLabel, queryInventory,
  type InventoryBrowseCursor, type InventoryBrowseIndex } from "@/lib/inventory-query"
import { inventoryLocationLabel } from "@/lib/inventory-location"
import styles from "./inventory.module.css"

const InventoryDetail = dynamic(() => import("./inventory-detail"), { ssr: false })
export interface InventoryViewProps {
  scope: InventoryBrowseScope
  evidence: InventoryBrowseEvidence
  catalog: readonly InventoryCatalogEvidence[]
  layouts: readonly InventoryLayoutEvidence[]
  /** Host re-resolves the stable IDs against current authorized evidence before navigating. */
  onOpenLocation?: (intent: InventoryLocationIntent) => void
}
export default function InventoryView({ scope, evidence, catalog, layouts, onOpenLocation }: InventoryViewProps) {
  const index = useMemo(() => buildInventoryBrowseIndex(scope, evidence, catalog, layouts), [scope, evidence, catalog, layouts])
  // Synchronous remount prevents even a single paint of another account's selection/query/cursor.
  return <InventoryResults key={index.key} index={index} onOpenLocation={onOpenLocation} />
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>
}
function InventoryResults({ index, onOpenLocation }: { index: InventoryBrowseIndex; onOpenLocation?: InventoryViewProps["onOpenLocation"] }) {
  const [query, setQuery] = useState<InventoryBrowseQuery>({})
  const [cursor, setCursor] = useState<InventoryBrowseCursor | null>(null)
  const [previous, setPrevious] = useState<(InventoryBrowseCursor | null)[]>([])
  const [selected, setSelected] = useState<string | null>(null)
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
  return <section className={styles.view} aria-label="Inventory">
    <header><h1>Inventory</h1><p>What you own and where it is stored.</p></header>
    {index.kind === "unavailable" ? <div role="status" className={styles.notice}>
      <h2>Inventory unavailable</h2><p>A complete inventory could not be loaded. Your existing collection has not been counted here. Try again when inventory is available.</p>
    </div> : <>
      {index.kind === "cached" && <p role="status" className={styles.notice}>Cached only. Showing saved copies, not your whole inventory. Uncached copies and current locations may be missing.</p>}
      <p aria-live="polite">{index.kind === "cached" ? `${count} cached copies` : `${count} owned ${count === 1 ? "copy" : "copies"}`} · {result.total} matching</p>
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
        <ul className={styles.list} aria-label="Owned copies">{result.rows.map(r => <li key={r.itemId}>
          <button type="button" className={styles.copy} data-item-id={r.itemId} onClick={() => setSelected(r.itemId)}>
            <span className={styles.art}>{r.image ? <CardImage src={r.image} alt="" sizes="56px" width={56} height={78} /> : <span>Image<br />unknown</span>}</span>
            <span className={styles.copyText}><strong>{r.name ?? (r.speciesNames.length ? r.speciesNames.join(", ") : "Unknown card")}</strong>
              <span>{r.setName ?? "Set unknown"} · {r.number ? `#${r.number}` : "Number unknown"}</span>
              <span>{r.language ?? "Language unknown"} · {r.finish ?? "Finish unknown"}</span>
              <span className={styles.grading}>{inventoryGradingLabel(r)}</span>
              <span>{index.kind === "cached" ? "Last saved: " : ""}{inventoryLocationLabel(r.location)}</span>
            </span>
          </button>
        </li>)}</ul>
        <nav aria-label="Inventory pages" className={styles.pagination}>
          {previous.length > 0 && <button type="button" onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(p => p.slice(0, -1)) }}>Previous copies</button>}
          <span>{previous.length * 40 + 1}–{previous.length * 40 + result.rows.length} of {result.total}</span>
          {result.next && <button type="button" onClick={() => { setPrevious(p => [...p, cursor]); setCursor(result.next) }}>Next copies</button>}
        </nav>
      </>}
    </>}
    {row && <InventoryDetail row={row} cached={index.kind === "cached"} onClose={() => setSelected(null)} onOpenLocation={onOpenLocation ? intent => { pendingLocation.current = intent; setSelected(null) } : undefined} />}
  </section>
}
