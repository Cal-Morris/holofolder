"use client"

import Image from "next/image"
import { useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight, Layers3 } from "lucide-react"
import { buildAnalyticsBreakdown, type buildCollectionAnalytics, type AnalyticsCard } from "@/lib/collection-analytics"
import { toCardImageSrc } from "@/lib/card-image-url"

const money = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount)
const tabs = ["Highest value", "Unpriced", "Wanted"] as const

export function CollectionAnalyticsOverview({ summary, isAllBinders, isLoadingPrices, onBrowsePokemon, onInspect, valuationActions }: {
  summary: ReturnType<typeof buildCollectionAnalytics>
  isAllBinders: boolean
  isLoadingPrices: boolean
  onBrowsePokemon: (pokemon: { id: number; name: string }) => void
  onInspect: (key: string) => void
  valuationActions?: ReactNode
}) {
  const cardsRef = useRef<HTMLElement>(null)
  const breakdown = useMemo(() => buildAnalyticsBreakdown(summary), [summary])
  const [tab, setTab] = useState<typeof tabs[number]>("Highest value")
  const [setName, setSetName] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showAllSets, setShowAllSets] = useState(false)
  const wanted = summary.cards.filter(card => card.scope === "wanted")
  const entries = setName ? summary.cards.filter(card => card.scope === "owned" && (card.card.card_set?.trim() || "Unknown set") === setName)
    : tab === "Highest value" ? breakdown.topCards : tab === "Unpriced" ? breakdown.unpriced : wanted
  const coverage = summary.assignedCards ? summary.pricedCards / summary.assignedCards * 100 : 0
  const open = (card: AnalyticsCard) => onBrowsePokemon({ id: card.pokemonId, name: card.pokemonName })
  return <>
    <section aria-label="Collection overview" aria-busy={isLoadingPrices} className="grid grid-cols-1 gap-6 border-b border-border/60 pb-6 sm:grid-cols-2 sm:gap-10">
      <div>
        <h2 className="text-sm text-muted-foreground sm:text-sm">National Dex completion</h2>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0"><p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-5xl">{(summary.ownedSpecies / 1025 * 100).toFixed(1)}<span className="text-lg text-muted-foreground">%</span></p><p className="text-sm tabular-nums">{summary.ownedSpecies} / 1025</p></div>
        <div role="progressbar" aria-label="National Dex completion" aria-valuenow={summary.ownedSpecies} aria-valuemin={0} aria-valuemax={1025} className="mt-5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-highlight" style={{ width: `${summary.ownedSpecies / 1025 * 100}%` }} /></div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{1025 - summary.ownedSpecies} species to go{isAllBinders ? " across your binders" : " in this binder"}.</p>
      </div>
      <div className="order-first min-w-0">
        <h2 className="text-base font-medium">Binder value</h2>
        <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{summary.pricedCards ? money(summary.valueGbp) : isLoadingPrices ? "Loading…" : "Unknown"}</p>
        <p className="mt-2 text-sm text-muted-foreground">Market estimate · GBP{summary.pricedCards < summary.assignedCards ? " · partial coverage" : ""}</p>
        {summary.oldestQuoteAt && <p className="mt-1 text-sm text-muted-foreground">Oldest quote: {new Date(summary.oldestQuoteAt).toLocaleDateString("en-GB")}{summary.staleCards > 0 ? ` · ${summary.staleCards} quotes over 7 days old` : ""}.</p>}
        <div className="mt-5 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full bg-primary/60" style={{ width: `${coverage}%` }} /></div><span className="text-sm tabular-nums text-muted-foreground">{Math.round(coverage)}% priced</span></div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{summary.pricedCards} of {summary.assignedCards} owned cards priced. {summary.pricedCards - summary.estimatedFinishCards} exact finish{summary.estimatedFinishCards > 0 ? ` · ${summary.estimatedFinishCards} finish estimates` : ""}.</p>
        <button onClick={() => { setTab("Unpriced"); setSetName(null); setShowAll(false); cardsRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); cardsRef.current?.focus({ preventScroll: true }) }} className="mt-1 min-h-9 text-left text-sm underline decoration-border underline-offset-4">{breakdown.unpriced.length} unpriced, excluded from value</button>
        {breakdown.uncertainPrices > 0 && <p className="text-sm text-muted-foreground">{breakdown.uncertainPrices} priced with low or unknown confidence.</p>}
        {valuationActions}
      </div>
    </section>
    <div className="flex flex-wrap gap-x-8 gap-y-2 py-4 text-sm text-muted-foreground"><p><strong className="font-semibold tabular-nums text-foreground">{summary.assignedCards}</strong> assigned {isAllBinders ? "copies" : "cards"}</p><p><strong className="font-semibold tabular-nums text-foreground">{summary.wantedCards}</strong> wanted printings</p><p><strong className="font-semibold tabular-nums text-foreground">{breakdown.sets.length}</strong> sets represented</p></div>
    <div className="grid items-start gap-8 border-b border-border/60 py-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
      <section aria-label="Owned cards by set" className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Your collection by set</h2>
        <p className="mt-1 text-sm text-muted-foreground">Owned cards, not set completion. Select a set to explore.</p>
        {breakdown.sets.length ? <ul className="mt-4 space-y-1">{(showAllSets ? breakdown.sets : breakdown.sets.slice(0, 6)).map(set => <li key={set.name}><button aria-pressed={setName === set.name} onClick={() => { setSetName(set.name); setShowAll(false); cardsRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); cardsRef.current?.focus({ preventScroll: true }) }} className="w-full rounded-lg px-1 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <span className="flex justify-between gap-4 text-sm"><span className="truncate font-medium">{set.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{set.count}</span></span>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${set.count / summary.assignedCards * 100}%` }} /></span>
        </button></li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">Assign a card to an owned Pokémon to see your sets here.</p>}
        {breakdown.sets.length > 6 && <button className="min-h-10 text-sm underline underline-offset-4" onClick={() => setShowAllSets(!showAllSets)}>{showAllSets ? "Show fewer sets" : `View all ${breakdown.sets.length} sets`}</button>}
      </section>
      <section ref={cardsRef} tabIndex={-1} aria-label="Explore collection cards" className="min-w-0 outline-none">
        <div className="flex min-h-7 items-center justify-between gap-2"><h2 className="truncate text-lg font-semibold tracking-tight">{setName ?? "Cards worth a closer look"}</h2>{setName && <button className="min-h-9 shrink-0 text-sm underline underline-offset-4" onClick={() => setSetName(null)}>Clear set</button>}</div>
        {!setName && <div className="mt-3 flex gap-4 border-b border-border/60" role="group" aria-label="Cards to explore">{tabs.map(value => <button key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setShowAll(false) }} className={`min-h-10 border-b-2 text-sm ${tab === value ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}`}>{value}</button>)}</div>}
        {entries.length ? <ul className="mt-2 divide-y divide-border/50">{(showAll ? entries : entries.slice(0, 5)).map(card => <li key={card.key} className="flex items-center gap-3 py-3">
          <button onClick={() => open(card)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Browse ${card.card.card_name} cards`}>
            <span className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">{toCardImageSrc(card.card.card_image) ? <Image width={40} height={56} unoptimized src={toCardImageSrc(card.card.card_image)!} alt="" loading="lazy" className="h-full w-full object-contain" /> : <Layers3 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{card.card.card_name}</span><span className="mt-1 block truncate text-sm text-muted-foreground">{card.card.card_set ?? card.card.card_id}</span><span className="block text-sm capitalize text-muted-foreground">{(card.card.card_finish ?? "normal").replaceAll("_", " ")} · {card.card.card_language ?? "en"}</span></span>
          </button>
          <button onClick={() => onInspect(card.key)} aria-label={`Price details for ${card.card.card_name}`} className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg text-right text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-ring"><span>{card.amount !== null ? money(card.amount) : "Unpriced"}{card.estimatedFinish && <span className="block text-xs text-muted-foreground">Finish estimate</span>}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></button>
        </li>)}</ul> : <p className="py-6 text-sm text-muted-foreground">{tab === "Wanted" ? "Save a printing to your want list to see it here." : tab === "Unpriced" ? "No assigned owned cards are missing a price." : "No priced owned cards yet. Assign your printings to see their values here."}</p>}
        {entries.length > 5 && <button className="min-h-10 text-sm underline underline-offset-4" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer cards" : `View all ${entries.length} cards`}</button>}
      </section>
    </div>
    <p className="py-3 text-sm leading-relaxed text-muted-foreground">Values use available market prices converted to GBP where needed, not sale proceeds. Finish estimates use a generic card price when the finish is unverified. Quotes over 30 days old are excluded. {isAllBinders && "Owned copies count separately; species and wanted printings count once."}</p>
  </>
}
