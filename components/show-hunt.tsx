"use client"

// Show mode's home: the "Hunting" list. The want list grouped by Pokémon (most wanted or dearest first), with
// era/set and illustrator filters to match how a dealer's binder is sorted. Every card shows what to pay up to;
// one tap opens the deal check. Built from the collection on this device, so it works offline.
import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Heart, Palette, Target } from "lucide-react"
import { useDisplayCardPrices, type DisplayPriceLookup } from "@/hooks/use-display-card-prices"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardFinishLabel } from "@/lib/card-labels"
import { readDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { CardFinish, WantedCard } from "@/lib/domain/cards"
import { loadIllustratorCards, loadIllustratorDirectory } from "@/lib/illustrator-client"
import type { IllustratorSummary } from "@/lib/illustrators"
import { formatPokemonDisplayName, getOfficialArtworkUrl } from "@/lib/pokemon-catalog"
import { formatCardNumber, type SearchCardResult } from "@/lib/pokemon-card-browse"
import { formatMoney, type DisplayFxRates } from "@/lib/regional-price"
import type { DisplayCurrency, PricingRegion } from "@/lib/pricing-region"
import {
  buildHuntGroups,
  collectHuntCards,
  getHuntFilterOptions,
  wantedToSearchCard,
  type HuntSort,
  type HuntSourceItem,
} from "@/lib/show-hunt"

type Money = { amount: number; currency: Parameters<typeof formatMoney>[1] }

export function cardThumb(image?: string | null) {
  if (!image) return null
  return toCardImageSrc(image.replace(/\/high\.webp$/, "/low.webp"))
}

export function payUpTo(market: number, thresholds: DealThresholds) {
  return Math.round(market * (1 + thresholds.fairPct / 100) * 100) / 100
}

export function useDealThresholds() {
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  return thresholds
}

export function PokemonSprite({ id, size = "h-12 w-12" }: { id: number; size?: string }) {
  return (
    <span className={`${size} relative shrink-0 overflow-hidden rounded-2xl bg-muted/60`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied artwork, cached by the service worker */}
      <img src={getOfficialArtworkUrl(id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain p-0.5" />
    </span>
  )
}

/** A big, scannable card row: thumbnail, name, set and number, then the price to pay up to. */
export function HuntCardRow({
  card,
  finish,
  market,
  thresholds,
  standing,
  onPick,
}: {
  card: SearchCardResult
  finish?: CardFinish | null
  market: Money | null
  thresholds: DealThresholds
  standing: "wanted" | "missing" | "owned"
  onPick: () => void
}) {
  const thumb = cardThumb(card.image)
  const limit = market ? formatMoney(payUpTo(market.amount, thresholds), market.currency) : null
  const tone = standing === "wanted"
    ? "border-rose-500/60 bg-rose-500/[0.07] ring-1 ring-rose-500/30"
    : standing === "owned" ? "border-border/40 opacity-55" : "border-border/60 bg-card"
  const finishLabel = finish && finish !== "normal" ? formatCardFinishLabel(finish) : null
  return (
    <button
      type="button"
      onClick={onPick}
      data-standing={standing}
      aria-label={`${card.name}, ${card.set.name} ${formatCardNumber(card)}${finishLabel ? `, ${finishLabel}` : ""}${standing === "missing" ? "" : `, ${standing}`}${limit ? `, pay up to ${limit}` : ""}`}
      className={`flex min-h-[5.5rem] w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left active:bg-muted ${tone}`}
    >
      <span className="trading-card relative w-14 shrink-0 overflow-hidden bg-muted/50">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
        {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold leading-tight">{card.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{card.set.name} · {formatCardNumber(card)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {standing === "wanted" && <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300"><Heart className="h-3 w-3" aria-hidden />Wanted</span>}
          {standing === "owned" && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">✓ Owned</span>}
          {finishLabel && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{finishLabel}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-right">
        {limit ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pay up to</span>
            <span className="text-lg font-black tabular-nums leading-tight" data-testid="hunt-pay-up-to">{limit}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">Market {formatMoney(market!.amount, market!.currency)}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No price</span>
        )}
      </span>
    </button>
  )
}

const chip = (active: boolean) =>
  `flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold ${active ? "border-primary bg-primary text-primary-foreground" : "border-border/70 bg-card"}`
const selectClass = "h-12 w-full min-w-0 rounded-2xl border border-border/70 bg-card px-3 text-sm font-medium"

export interface ShowHuntProps {
  items: readonly HuntSourceItem[]
  currency: DisplayCurrency
  fxRates?: DisplayFxRates | null
  pricingRegion: PricingRegion
  isOnline: boolean
  onPickCard: (card: SearchCardResult, pokemon: { id: number; name: string }, finish: CardFinish | null) => void
  onPickPokemon: (pokemon: { id: number; name: string }) => void
}

export default function ShowHunt({ items, currency, fxRates, pricingRegion, isOnline, onPickCard, onPickPokemon }: ShowHuntProps) {
  const thresholds = useDealThresholds()
  const [sort, setSort] = useState<HuntSort>("wanted")
  const [era, setEra] = useState<string | null>(null)
  const [setId, setSetId] = useState<string | null>(null)
  const [illustrator, setIllustrator] = useState("")
  const [directory, setDirectory] = useState<IllustratorSummary[]>([])
  const [illustratorCards, setIllustratorCards] = useState<{ name: string; ids: Set<string> | null } | null>(null)

  const lookups = useMemo<DisplayPriceLookup[]>(
    () => items.flatMap((item) => (item.wanted_cards ?? []).map((card) => ({ cardId: card.card_id, language: card.card_language ?? "en", finish: card.card_finish }))),
    [items],
  )
  const { priceOf } = useDisplayCardPrices(lookups, pricingRegion, currency, fxRates)
  const priceOfWanted = (card: WantedCard) => priceOf({ cardId: card.card_id, language: card.card_language ?? "en", finish: card.card_finish })
  const cards = collectHuntCards(items, (card) => priceOfWanted(card)?.amount ?? null)
  const options = getHuntFilterOptions(cards)
  const visibleSets = era ? options.sets.filter((entry) => entry.era.id === era) : options.sets

  useEffect(() => {
    let cancelled = false
    void loadIllustratorDirectory().then((result) => {
      if (!cancelled && result.data) setDirectory([...result.data].sort((a, b) => a.name.localeCompare(b.name)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!illustrator) return
    let cancelled = false
    void loadIllustratorCards(illustrator).then((result) => {
      if (cancelled) return
      setIllustratorCards({ name: illustrator, ids: result.data ? new Set(result.data.cards.map((card) => card.id)) : null })
    })
    return () => {
      cancelled = true
    }
  }, [illustrator])

  const illustratorIds = illustrator && illustratorCards?.name === illustrator ? illustratorCards.ids ?? new Set<string>() : illustrator ? new Set<string>() : null
  const groups = buildHuntGroups(items, cards, sort, { era, setId, cardIds: illustratorIds })
  const total = cards.length
  const filtering = Boolean(era || setId || illustrator)

  return (
    <section aria-label="Hunting" className="flex min-h-0 flex-1 flex-col" data-testid="show-hunt">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        <div className="sticky top-0 z-10 -mx-3 space-y-2 border-b border-border/40 bg-background/95 px-3 pb-2 pt-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 shrink-0 text-rose-500" aria-hidden />
            <h3 className="min-w-0 flex-1 truncate text-base font-bold">
              Hunting <span className="font-medium text-muted-foreground">· {total} card{total === 1 ? "" : "s"}{isOnline ? "" : " · offline"}</span>
            </h3>
            <div role="radiogroup" aria-label="Sort" className="flex shrink-0 rounded-full bg-muted/70 p-0.5">
              {([["wanted", "Most wanted"], ["value", "Top value"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={sort === id} onClick={() => setSort(id)}
                  className={`h-10 rounded-full px-3 text-xs font-semibold ${sort === id ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {options.eras.length > 0 && (
            <div role="radiogroup" aria-label="Era" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
              <button type="button" role="radio" aria-checked={!era} onClick={() => { setEra(null); setSetId(null) }} className={chip(!era)}>All eras</button>
              {options.eras.map(({ era: entry, count }) => (
                <button key={entry.id} type="button" role="radio" aria-checked={era === entry.id}
                  onClick={() => { setEra(era === entry.id ? null : entry.id); setSetId(null) }} className={chip(era === entry.id)}>
                  {entry.label}<span className="text-xs opacity-70">{count}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="sr-only">Set</span>
              <select aria-label="Set" value={setId ?? ""} onChange={(event) => setSetId(event.target.value || null)} className={selectClass}>
                <option value="">Any set</option>
                {visibleSets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.count})</option>)}
              </select>
            </label>
            <label className="relative min-w-0">
              <span className="sr-only">Illustrator</span>
              <Palette className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <select aria-label="Illustrator" value={illustrator} onChange={(event) => setIllustrator(event.target.value)} className={`${selectClass} pl-8`}>
                <option value="">Any illustrator</option>
                {directory.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {groups.length === 0 ? (
          <div role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
            {total === 0 && !filtering
              ? <>Your want list is empty. Search a Pokémon below and tap <b>Want</b> on the cards you&apos;re after.</>
              : illustrator && illustratorCards?.name === illustrator && illustratorCards.ids === null
              ? `${illustrator}'s cards aren't saved on this device yet.`
              : "Nothing on your want list matches these filters."}
          </div>
        ) : (
          <div className="space-y-4 pt-3">
            {groups.map((group) => {
              const pokemon = { id: group.pokemonId, name: group.pokemonName }
              const name = formatPokemonDisplayName(group.pokemonName)
              return (
                <section key={group.pokemonId} aria-label={`Hunting ${name}`} className="space-y-1.5">
                  <button type="button" onClick={() => onPickPokemon(pokemon)} aria-label={`${name}: all cards`} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-muted">
                    <PokemonSprite id={group.pokemonId} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold">{name}</span>
                      <span className="block text-xs text-muted-foreground">
                        #{String(group.pokemonId).padStart(4, "0")} · {group.anyCard ? "any card" : `${group.cards.length} wanted`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">All cards<ChevronRight className="h-4 w-4" aria-hidden /></span>
                  </button>
                  {group.cards.map((entry) => (
                    <HuntCardRow
                      key={entry.key}
                      card={wantedToSearchCard(entry.wanted, group.pokemonId)}
                      finish={entry.wanted.card_finish}
                      market={priceOfWanted(entry.wanted)}
                      thresholds={thresholds}
                      standing="wanted"
                      onPick={() => onPickCard(wantedToSearchCard(entry.wanted, group.pokemonId), pokemon, entry.wanted.card_finish ?? null)}
                    />
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
