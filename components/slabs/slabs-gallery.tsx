"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { SlabPresentation } from "@/lib/slabs/presentation"
import { slabSummary } from "@/lib/slabs/presentation"
import SlabCard from "./slab-card"
import styles from "./slabs.module.css"

export interface SlabGalleryCopy { itemId: string; slab: SlabPresentation }
function SlabDetail({ copy, onClose }: { copy: SlabGalleryCopy; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const p = copy.slab
  return <div className={styles.overlay}>
    <div className={styles.backdrop} data-overlay-backdrop onClick={onClose} />
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Slab copy details" tabIndex={-1} ref={ref}>
      <header className={styles.sheetHeader} data-sheet-grabber {...swipe}><h2>Copy details</h2><button aria-label="Close slab details" onClick={onClose}><X size={20} /></button></header>
      <div className={styles.sheetBody}>
        <h3>{p.name}</h3><p>{slabSummary(p)}</p>
        <p>{p.set ?? "Set unknown"}{p.number ? ` · #${p.number}` : ""}</p>
        {p.style !== "raw" && <><p>User-recorded grading, not verified</p>{p.designation && <p>{p.designation}</p>}
          <p>Scale: {p.scale ?? "Unknown"}</p><p>{p.note ?? "Supported holder and label layout"}</p>
          <dl className={styles.fullSubgrades}>{p.subgrades.length ? p.subgrades.map((s, i) => <div key={i}><dt>{s.name}</dt><dd>{s.grade}</dd></div>) : <div><dt>Subgrades</dt><dd>Unknown</dd></div>}</dl></>}
        <div className={styles.enlarged}><SlabCard slab={p} sizes="(max-width: 639px) 80vw, 320px" /></div>
        <p className={styles.copyId}>Copy {copy.itemId}</p>
      </div>
    </div>
  </div>
}
/** Only already-scoped/redacted copies enter the gallery. No mutation, asset fetch or pricing. */
export default function SlabsGallery({ copies, name, cached, search, onSearch }: {
  copies: readonly SlabGalleryCopy[]; name: string; cached: boolean; search: string; onSearch: (value: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const filtered = copies.filter(c => `${c.slab.name} ${c.slab.set ?? ""} ${slabSummary(c.slab)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const window = Math.min(page, Math.max(0, Math.ceil(filtered.length / 24) - 1))
  const selected = copies.find(c => c.itemId === selectedId)
  return <section className={styles.gallery} aria-label="Slabs collection">
    <header><h1>{name}</h1><p>Slabs view · {copies.length} {copies.length === 1 ? "copy" : "copies"}</p>
      <p>Recorded holders and grades. Raw copies stay raw.</p></header>
    {cached && <p role="status">Saved on this device. Contents may be incomplete.</p>}
    <label className={styles.search}>Search this collection<input type="search" value={search} onChange={e => { setPage(0); onSearch(e.target.value) }} /></label>
    <ul className={styles.grid} aria-label="Collection copies">{filtered.slice(window * 24, (window + 1) * 24).map(copy => <li key={copy.itemId}>
      <button className={styles.copy} data-item-id={copy.itemId} onClick={() => setSelectedId(copy.itemId)} aria-label={`Open ${copy.slab.name}, ${slabSummary(copy.slab)}, copy ${copy.itemId}`}>
        <SlabCard slab={copy.slab} /><strong className={styles.cardName}>{copy.slab.name}</strong><span>{slabSummary(copy.slab)}</span>
      </button>
    </li>)}</ul>
    {!filtered.length && <p>No saved copies match this view.</p>}
    {filtered.length > 24 && <div className={styles.pagination}><button disabled={window === 0} onClick={() => setPage(window - 1)}>Previous copies</button>
      <span>Page {window + 1} of {Math.ceil(filtered.length / 24)}</span><button disabled={(window + 1) * 24 >= filtered.length} onClick={() => setPage(window + 1)}>Next copies</button></div>}
    {selected && <SlabDetail copy={selected} onClose={() => setSelectedId(null)} />}
  </section>
}
