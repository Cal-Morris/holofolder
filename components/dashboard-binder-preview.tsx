"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { binderFill, isCardArtworkUrl, binderSpread, binderTurnPage, type BinderDesign, type BinderPart, type BinderView } from "@/lib/binder-design"
import type { CollectedPokemon } from "@/lib/domain/cards"
import { getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import styles from "@/components/dashboard-binder-preview.module.css"

const Viewport = dynamic(() => import("@/components/binder-designer/viewport"), { ssr: false, loading: () => <div className={styles.loading}>Opening your binder…</div> })
const views: { label: string; view: BinderView }[] = [{ label: "Cover", view: "front" }, { label: "Inside", view: "inside" }, { label: "Spine", view: "spine" }]
const noThumbnails = () => {}

export default function DashboardBinderPreview({ appearance, artwork, loading, collection, enabled, onSelectPokemon }: { appearance: BinderDesign; artwork: Record<string, string>; loading: boolean; collection: CollectedPokemon[]; enabled: boolean; onSelectPokemon: (pokemon: PokemonSummary) => void }) {
  const [view, setView] = useState<BinderView>("inside")
  const [selectedPage, setPage] = useState(1)
  const design = useMemo(() => ({ ...appearance, pageCount: Math.max(appearance.pageCount, Math.ceil(1025 / (appearance.rows * appearance.cols))) }), [appearance])
  const page = Math.min(selectedPage, design.pageCount)
  const occupied = useMemo(() => collection.filter(item => (item.status === "collected" || item.status === "finalized")), [collection])
  const cards = useMemo(() => occupied.filter(item => item.card_id).map(item => {
    const image = item.card_image?.startsWith("/api/card-image-proxy?") ? item.card_image : `/api/card-image-proxy?url=${encodeURIComponent(item.card_image || "")}`
    return { id: item.card_id!, name: item.card_name || item.pokemon_name, image: isCardArtworkUrl(image) ? image : "", slot: item.pokemon_id - 1 }
  }), [occupied])
  const stats = useMemo(() => ({ placed: occupied.length, wanted: collection.reduce((count, item) => count + (item.wanted_cards?.length || 0) + (item.status === "wishlisted" && !item.wanted_cards?.length ? 1 : 0), 0), capacity: design.pageCount * design.rows * design.cols, sample: false, filled: binderFill(occupied.map(item => item.pokemon_id - 1), design.pageCount * design.rows * design.cols) }), [occupied, collection, design])
  const spread = binderSpread(page, design.pageCount)
  const visibleCards = cards.filter(card => {
    const face = Math.floor(card.slot / (design.rows * design.cols)) + 1
    return face === spread.left || face === spread.right
  })
  const select = (part: BinderPart) => setView(part === "pages" || part === "lining" ? "inside" : part === "spine" ? "spine" : part === "back" ? "back" : "front")

  return <section className={styles.preview} aria-label="Your 3D National Dex binder" data-binder-name={design.name}>
    <div className={styles.heading}><div><p>National Dex / {occupied.length} cards placed</p><h2>{design.name}</h2></div>{enabled && <Link href="/studio">Customize in Studio ↗</Link>}</div>
    {loading ? <div className={styles.loading}>Loading your saved appearance…</div> : <Viewport compact design={design} cards={cards} stats={stats} page={page} artwork={artwork} view={view} onSelect={select} onPageTurn={direction => setPage(current => binderTurnPage(current, design.pageCount, direction))} onSlotSelect={slot => { const pokemon=getPokemonSummary(slot+1);if(pokemon)onSelectPokemon(pokemon) }} onThumbnails={noThumbnails} />}
    <div className={styles.toolbar} role="group" aria-label="3D binder views">{views.map(item => <button key={item.view} type="button" aria-pressed={view === item.view} onClick={() => setView(item.view)}>{item.label}</button>)}</div>
    {view === "inside" && <div className={styles.pages}><button type="button" aria-label="Previous 3D binder spread" disabled={binderTurnPage(page, design.pageCount, -1) === page} onClick={() => setPage(current => binderTurnPage(current, design.pageCount, -1))}>←</button><span aria-live="polite">{spread.left > 0 ? `${spread.left} / ${spread.right || "End"}` : "Inside cover / 1"}<small>{design.pageCount} pages</small></span><button type="button" aria-label="Next 3D binder spread" disabled={binderTurnPage(page, design.pageCount, 1) === page} onClick={() => setPage(current => binderTurnPage(current, design.pageCount, 1))}>→</button></div>}
    {view === "inside" && <div className="sr-only" aria-live="polite"><ul aria-label="Cards on this spread">{visibleCards.map(card => <li key={card.slot}><button type="button" onClick={() => { const pokemon=getPokemonSummary(card.slot+1);if(pokemon)onSelectPokemon(pokemon) }}>{card.name}, slot {card.slot + 1}</button></li>)}</ul>{!visibleCards.length && <p>No placed cards on this spread</p>}</div>}
  </section>
}
