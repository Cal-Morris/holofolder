"use client"

// The want list: a search box, one summary line and plain rows (image, name, set and number,
// variant, UK price, rising badge). The analytics (price bands, sets, finishes) live in a
// collapsed Insights section. It only renders in the Wanted view, so binder-app loads it in its
// own chunk. Sort and filter state lives in binder-app (the binder header also reads it).
import { useMemo, useState } from "react"
import { toCardImageSrc } from "@/lib/card-image-url"
import { Check, ChevronDown, Heart, Search, Share2, WifiOff, X } from "lucide-react"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { WantedCard } from "@/hooks/use-collection"
import { PriceRisingBadge } from "@/components/price-rising-badge"
import { getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { filterWantedDashboardEntries, type buildWantedDashboardSummary, type WantedDashboardPriceBandId, type WantedDashboardSort } from "@/lib/wanted-dashboard"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"

export type WantedExplorerFilter =
  | { kind: "all"; label: string }
  | { kind: "band"; label: string; value: WantedDashboardPriceBandId }
  | { kind: "set"; label: string; value: string }
  | { kind: "language"; label: string; value: string }
  | { kind: "finish"; label: string; value: string }

type WantedDashboardSummary = ReturnType<typeof buildWantedDashboardSummary>
type WantedDashboardEntry = WantedDashboardSummary["cards"][number]

type PriceFormat = {
  label: (price: CardPriceSnapshot | undefined) => string | null
  amount: (amount: number | null | undefined, price?: CardPriceSnapshot) => string | null
  range: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot) => string | null
}

export type WantedDashboardProps = {
  wantedDashboard: WantedDashboardSummary
  sortedWantedDashboardCards: WantedDashboardEntry[]
  priceFormat: PriceFormat
  isLoadingPrices: boolean
  isOnline?: boolean
  readOnlyMode: boolean
  wantedSort: WantedDashboardSort
  setWantedSort: (sort: WantedDashboardSort) => void
  wantedExplorerFilter: WantedExplorerFilter
  setWantedExplorerFilter: (filter: WantedExplorerFilter) => void
  wantedShareMessage: string | null
  handleShareWantedList: () => void
  handleGotWantedCard: (pokemonId: number, pokemonName: string, wantedCard: WantedCard) => void
  handleClearWantedCard: (pokemonId: number, wantedCard: WantedCard) => void
  handlePokemonSelect: (pokemon: PokemonSummary) => void
  jumpToWantedPokemonPage: (pokemon: PokemonSummary | null) => void
}

const WANTED_SORT_OPTIONS: Array<{ id: WantedDashboardSort; label: string }> = [
  { id: "highest", label: "Price ↓" },
  { id: "lowest", label: "Price ↑" },
  { id: "newest", label: "Newest" },
  { id: "set", label: "Set" },
  { id: "dex", label: "Dex no." },
  { id: "unpriced", label: "Unpriced" },
]

const BAND_DOT: Record<WantedDashboardPriceBandId, string> = {
  "under-5": "bg-emerald-500",
  "five-to-15": "bg-sky-500",
  "fifteen-to-50": "bg-violet-500",
  "over-50": "bg-rose-500",
  unpriced: "bg-slate-400",
}

const ALL_WANTED: WantedExplorerFilter = { kind: "all", label: "All wanted" }

function cardNumberLabel(card: WantedCard) {
  if (!card.local_id) return null
  return `#${card.local_id}${card.set_total ? `/${card.set_total}` : ""}`
}

export default function WantedDashboard({
  wantedDashboard,
  sortedWantedDashboardCards,
  priceFormat,
  isLoadingPrices,
  isOnline = true,
  readOnlyMode,
  wantedSort,
  setWantedSort,
  wantedExplorerFilter,
  setWantedExplorerFilter,
  wantedShareMessage,
  handleShareWantedList,
  handleGotWantedCard,
  handleClearWantedCard,
  handlePokemonSelect,
}: WantedDashboardProps) {
  const [query, setQuery] = useState("")
  const visibleCards = useMemo(
    () => filterWantedDashboardEntries(sortedWantedDashboardCards, query),
    [query, sortedWantedDashboardCards],
  )
  const totalWantedCount = wantedDashboard.totalCards
  const isFiltered = wantedExplorerFilter.kind !== "all"
  const isSearching = query.trim().length > 0
  const marketTotalLabel = priceFormat.amount(wantedDashboard.marketTotalGbp)
  const hasAnyPrice = wantedDashboard.pricedCount > 0

  if (totalWantedCount === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[1.35rem] border border-border/65 bg-card/88 p-6 text-center dark:border-white/10 dark:bg-card/72">
        <div className="max-w-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Heart className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold">No wanted cards yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open a slot and choose Want card. Wanted cards show up here with their UK prices.</p>
        </div>
      </div>
    )
  }

  const summaryPrice = hasAnyPrice
    ? `~${marketTotalLabel} to complete`
    : isLoadingPrices ? "Loading prices…" : "No prices yet"

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(var(--dock-clearance)+1rem)] md:pb-3" data-testid="wanted-list">
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="sticky top-0 z-10 -mx-1 space-y-2 bg-background/92 px-1 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <div className="flex items-center gap-2">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">Search want list</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cards, sets, artists"
                aria-label="Search want list"
                className="h-11 w-full rounded-2xl border border-border/70 bg-card pl-10 pr-11 text-base outline-none transition placeholder:text-muted-foreground/80 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 dark:border-white/12 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {isSearching ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>
            <button
              type="button"
              onClick={() => void handleShareWantedList()}
              aria-label="Share list"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-card text-xs font-semibold transition hover:border-primary/35 dark:border-white/10"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug" data-testid="wanted-summary">
              <span className="font-semibold tabular-nums">{totalWantedCount} wanted</span>
              <span className="text-muted-foreground"> · </span>
              <span className="tabular-nums">{summaryPrice}</span>
              {hasAnyPrice && wantedDashboard.unpricedCount > 0 ? (
                <span className="text-muted-foreground"> · {wantedDashboard.unpricedCount} unpriced</span>
              ) : null}
            </p>
            <label className="relative shrink-0">
              <span className="sr-only">Sort want list</span>
              <select
                value={wantedSort}
                onChange={(event) => setWantedSort(event.target.value as WantedDashboardSort)}
                aria-label="Sort want list"
                className="h-11 appearance-none rounded-2xl border border-border/60 bg-card pl-3 pr-7 text-xs font-semibold dark:border-white/10"
              >
                {WANTED_SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </label>
          </div>

          {isFiltered ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setWantedExplorerFilter(ALL_WANTED)}
                aria-label={`Remove filter ${wantedExplorerFilter.label}`}
                className="inline-flex min-h-9 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-semibold text-primary"
              >
                {wantedExplorerFilter.label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {wantedShareMessage ? <p role="status" className="text-xs text-muted-foreground">{wantedShareMessage}</p> : null}
          {!isOnline ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="wanted-offline">
              <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
              Offline · prices may be out of date, changes sync when you reconnect
            </p>
          ) : null}
        </div>

        {visibleCards.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/80 p-5 text-center dark:border-white/10">
            <p className="text-sm font-semibold">{isSearching ? `Nothing on your want list matches “${query.trim()}”` : "No wanted cards match this filter"}</p>
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setWantedExplorerFilter(ALL_WANTED)
              }}
              className="mt-3 inline-flex h-11 items-center rounded-2xl border border-border/60 px-4 text-sm font-semibold dark:border-white/10"
            >
              Show all wanted cards
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border/60 bg-card/85 dark:divide-white/10 dark:border-white/10 dark:bg-card/70" aria-label="Wanted cards">
            {visibleCards.map((wantedCard) => (
              <WantedRow
                key={wantedCard.key}
                wantedCard={wantedCard}
                priceFormat={priceFormat}
                isLoadingPrices={isLoadingPrices}
                readOnlyMode={readOnlyMode}
                onOpen={handlePokemonSelect}
                onGot={handleGotWantedCard}
                onRemove={handleClearWantedCard}
              />
            ))}
          </ul>
        )}
        {isSearching && visibleCards.length > 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{visibleCards.length} of {totalWantedCount} match</p>
        ) : null}

        <WantedInsights
          wantedDashboard={wantedDashboard}
          priceFormat={priceFormat}
          activeFilter={wantedExplorerFilter}
          onFilter={(filter, sort) => {
            setWantedExplorerFilter(filter)
            if (sort) setWantedSort(sort)
          }}
        />
      </div>
    </div>
  )
}

function WantedRow({
  wantedCard,
  priceFormat,
  isLoadingPrices,
  readOnlyMode,
  onOpen,
  onGot,
  onRemove,
}: {
  wantedCard: WantedDashboardEntry
  priceFormat: PriceFormat
  isLoadingPrices: boolean
  readOnlyMode: boolean
  onOpen: (pokemon: PokemonSummary) => void
  onGot: WantedDashboardProps["handleGotWantedCard"]
  onRemove: WantedDashboardProps["handleClearWantedCard"]
}) {
  const { pokemonId, pokemonName, card, price } = wantedCard
  const pokemon = getPokemonSummary(pokemonId)
  const priceLabel = priceFormat.amount(wantedCard.effectiveGbpAmount, price)
  const language = card.card_language && card.card_language !== "en" ? formatCardLanguageLabel(card.card_language) : null
  const setLine = [card.card_set, cardNumberLabel(card)].filter(Boolean).join(" · ")
  const variantLine = [formatCardFinishLabel(card.card_finish), language].filter(Boolean).join(" · ")
  const showPokemon = pokemonName && !card.card_name.toLowerCase().includes(pokemonName.toLowerCase())

  return (
    <li className="flex items-center gap-2 py-2 pl-2 pr-1.5" data-testid="wanted-row" data-card-id={card.card_id}>
      <button
        type="button"
        onClick={() => pokemon && onOpen(pokemon)}
        disabled={!pokemon}
        aria-label={`Open ${card.card_name}${card.card_set ? ` from ${card.card_set}` : ""}`}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition active:bg-primary/5"
      >
        <span className="trading-card relative w-11 shrink-0 border border-border/55 bg-muted dark:border-white/10">
          {card.card_image ? (
            <img src={toCardImageSrc(card.card_image) ?? undefined} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {card.card_name}
            {showPokemon ? <span className="font-normal capitalize text-muted-foreground"> · {pokemonName}</span> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{setLine || "Unknown set"}</span>
          <span className="block truncate text-[11px] text-muted-foreground/90">{variantLine}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold tabular-nums" data-testid="wanted-row-price">
            {priceLabel ?? (isLoadingPrices ? "…" : "No price")}
          </span>
          <PriceRisingBadge price={price} />
        </span>
      </button>
      {readOnlyMode ? null : (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onGot(pokemonId, pokemonName, card)}
            aria-label={`Got it: ${card.card_name}`}
            title="Got it"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-emerald-600 transition hover:bg-emerald-500/10 active:bg-emerald-500/15 dark:text-emerald-300"
          >
            <Check className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(pokemonId, card)}
            aria-label={`Remove ${card.card_name} from want list`}
            title="Remove"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      )}
    </li>
  )
}

function WantedInsights({
  wantedDashboard,
  priceFormat,
  activeFilter,
  onFilter,
}: {
  wantedDashboard: WantedDashboardSummary
  priceFormat: PriceFormat
  activeFilter: WantedExplorerFilter
  onFilter: (filter: WantedExplorerFilter, sort?: WantedDashboardSort) => void
}) {
  const averageLabel = priceFormat.amount(wantedDashboard.averageGbp)
  const highest = wantedDashboard.highestCards[0]
  const highestLabel = priceFormat.amount(highest?.effectiveGbpAmount, highest?.price)
  const isActive = (kind: WantedExplorerFilter["kind"], value: string) =>
    activeFilter.kind === kind && activeFilter.kind !== "all" && activeFilter.value === value
  const chipClass = (active: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition dark:border-white/10 ${
      active ? "border-primary/45 bg-primary/10 text-primary" : "border-border/55 bg-background/60 hover:border-primary/35"
    }`

  return (
    <details className="group rounded-2xl border border-border/60 bg-card/80 dark:border-white/10 dark:bg-card/65" data-testid="wanted-insights">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        Insights
        <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-3 border-t border-border/50 px-3 pb-3 pt-3 text-xs dark:border-white/10">
        <p className="text-muted-foreground">
          {wantedDashboard.pricedCount} of {wantedDashboard.totalCards} priced
          {averageLabel ? ` · average ${averageLabel}` : ""}
          {highest && highestLabel ? ` · top ${highest.card.card_name} ${highestLabel}` : ""}
        </p>
        <div>
          <p className="mb-1.5 font-semibold text-muted-foreground">Price</p>
          <div className="flex flex-wrap gap-1.5">
            {wantedDashboard.priceBands.filter((band) => band.count > 0).map((band) => (
              <button
                key={band.id}
                type="button"
                onClick={() => onFilter({ kind: "band", value: band.id, label: band.label }, band.id === "unpriced" ? "unpriced" : undefined)}
                className={chipClass(isActive("band", band.id))}
              >
                <span className={`h-2 w-2 rounded-full ${BAND_DOT[band.id]}`} aria-hidden="true" />
                {band.label} <span className="tabular-nums text-muted-foreground">{band.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 font-semibold text-muted-foreground">Sets</p>
          <div className="flex flex-wrap gap-1.5">
            {wantedDashboard.setBreakdown.slice(0, 8).map((group) => (
              <button key={group.label} type="button" onClick={() => onFilter({ kind: "set", value: group.label, label: group.label })} className={chipClass(isActive("set", group.label))}>
                {group.label} <span className="tabular-nums text-muted-foreground">{group.count}</span>
              </button>
            ))}
          </div>
        </div>
        {wantedDashboard.finishBreakdown.length > 1 ? (
          <div>
            <p className="mb-1.5 font-semibold text-muted-foreground">Variant</p>
            <div className="flex flex-wrap gap-1.5">
              {wantedDashboard.finishBreakdown.map((group) => (
                <button key={group.label} type="button" onClick={() => onFilter({ kind: "finish", value: group.label, label: formatCardFinishLabel(group.label) })} className={chipClass(isActive("finish", group.label))}>
                  {formatCardFinishLabel(group.label)} <span className="tabular-nums text-muted-foreground">{group.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {wantedDashboard.languageBreakdown.length > 1 ? (
          <div>
            <p className="mb-1.5 font-semibold text-muted-foreground">Language</p>
            <div className="flex flex-wrap gap-1.5">
              {wantedDashboard.languageBreakdown.map((group) => (
                <button key={group.label} type="button" onClick={() => onFilter({ kind: "language", value: group.label, label: formatCardLanguageLabel(group.label) })} className={chipClass(isActive("language", group.label))}>
                  {formatCardLanguageLabel(group.label)} <span className="tabular-nums text-muted-foreground">{group.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  )
}
