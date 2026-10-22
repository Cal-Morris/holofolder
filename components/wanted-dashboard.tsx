"use client"

// The want-list dashboard: totals, price bands, set/language/finish breakdowns and the
// sortable list of wanted cards. It only renders in the Wanted view, so binder-app loads
// it in its own chunk. State lives in binder-app (the binder header also reads it).
import { toCardImageSrc } from "@/lib/card-image-url"
import { Check, X, Heart, ListChecks, Layers3, ArrowUpDown, ShoppingBag, Tag, Languages, Share2 } from "lucide-react"
import { CardPriceEvidence } from "@/components/card-price-evidence"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { WantedCard } from "@/hooks/use-collection"
import { Button } from "@/components/ui/button"
import { getPokemonSummary, type PokemonSummary, formatDexNumber } from "@/lib/pokemon-catalog"
import { WANTED_PRICE_BAND_LABELS, type buildWantedDashboardSummary, type WantedDashboardPriceBandId, type WantedDashboardSort } from "@/lib/wanted-dashboard"
import { formatCardFinishLabel, formatCardLanguageLabel, formatPriceConfidenceLabel, formatPriceSourceLabel } from "@/lib/card-labels"

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

const WANTED_SORT_OPTIONS: Array<{ id: WantedDashboardSort; label: string; mobileLabel: string }> = [
  { id: "highest", label: "Highest first", mobileLabel: "High" },
  { id: "unpriced", label: "Unpriced", mobileLabel: "Unpriced" },
  { id: "newest", label: "Newest", mobileLabel: "New" },
  { id: "lowest", label: "Lowest first", mobileLabel: "Low" },
  { id: "set", label: "Set", mobileLabel: "Set" },
  { id: "dex", label: "Dex", mobileLabel: "Dex" },
]

const WANTED_PRICE_BAND_STYLES: Record<WantedDashboardPriceBandId, {
  bar: string
  dot: string
  chip: string
}> = {
  "under-5": {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  "five-to-15": {
    bar: "bg-sky-500",
    dot: "bg-sky-500",
    chip: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  "fifteen-to-50": {
    bar: "bg-violet-500",
    dot: "bg-violet-500",
    chip: "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  "over-50": {
    bar: "bg-rose-500",
    dot: "bg-rose-500",
    chip: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  unpriced: {
    bar: "bg-slate-400",
    dot: "bg-slate-400",
    chip: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  },
}

export default function WantedDashboard({
  wantedDashboard,
  sortedWantedDashboardCards,
  priceFormat,
  isLoadingPrices,
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
  jumpToWantedPokemonPage,
}: WantedDashboardProps) {
  const totalWantedCount = wantedDashboard.totalCards
  const marketTotalLabel = priceFormat.amount(wantedDashboard.marketTotalGbp)
  const averagePriceLabel = priceFormat.amount(wantedDashboard.averageGbp)
  const pricedPercent = totalWantedCount > 0 ? Math.round((wantedDashboard.pricedCount / totalWantedCount) * 100) : 0
  const highestCard = wantedDashboard.highestCards[0]
  const highestPriceLabel = priceFormat.amount(highestCard?.effectiveGbpAmount, highestCard?.price)
  const bandDenominator = Math.max(totalWantedCount, 1)
  const visibleSetBreakdown = wantedDashboard.setBreakdown.slice(0, 5)
  const visibleLanguageBreakdown = wantedDashboard.languageBreakdown.slice(0, 6)
  const visibleFinishBreakdown = wantedDashboard.finishBreakdown.slice(0, 5)
  const maxSetCount = Math.max(...visibleSetBreakdown.map((group) => group.count), 1)
  const maxFinishCount = Math.max(...visibleFinishBreakdown.map((group) => group.count), 1)
  const priorityCards = wantedDashboard.highestCards.slice(0, 4)
  const isExplorerFiltered = wantedExplorerFilter.kind !== "all"
  const setWantedFilter = (filter: WantedExplorerFilter, sort: WantedDashboardSort = wantedSort) => {
    setWantedExplorerFilter(filter)
    setWantedSort(sort)
  }
  const clearWantedFilter = () => setWantedExplorerFilter({ kind: "all", label: "All wanted" })
  const isWantedFilterActive = (kind: WantedExplorerFilter["kind"], value?: string) => {
    if (wantedExplorerFilter.kind !== kind) return false
    if (wantedExplorerFilter.kind === "all") return true

    return wantedExplorerFilter.value === value
  }

  if (totalWantedCount === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[1.35rem] border border-border/65 bg-card/88 p-6 text-center shadow-[0_18px_48px_-34px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-card/72">
        <div className="max-w-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Heart className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-semibold">No wanted cards yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open a slot, choose Want card, then this becomes the buying dashboard.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(var(--dock-clearance)+1rem)] md:pb-3">
      <div className="space-y-3">
        <section className="rounded-[1.35rem] border border-border/65 bg-card/88 p-2.5 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.32)] dark:border-white/10 dark:bg-card/72 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Wanted</p>
              <h2 className="mt-0.5 text-lg font-semibold tracking-tight">Buying dashboard</h2>
              <p className="mt-1 hidden max-w-xl text-xs leading-relaxed text-muted-foreground sm:block">Prioritise what to buy, spot unpriced cards, and keep the want list tied back to binder slots.</p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-amber-500/18 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                <ShoppingBag className="h-4 w-4" />
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-75">Market total</p>
                  <p className="truncate text-sm font-bold tabular-nums">{marketTotalLabel ?? (isLoadingPrices ? "Loading" : "No prices")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleShareWantedList()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-2xl border border-border/60 bg-background/70 px-3 text-xs font-semibold transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share list
              </button>
            </div>
          </div>
          {wantedShareMessage && <p role="status" className="mt-2 text-xs text-muted-foreground">{wantedShareMessage}</p>}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => {
                clearWantedFilter()
                setWantedSort("newest")
              }}
              className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To buy</p>
                <ShoppingBag className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" />
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{totalWantedCount}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{wantedDashboard.unpricedCount} need pricing</p>
            </button>
            <button
              type="button"
              onClick={() => {
                clearWantedFilter()
                setWantedSort("highest")
              }}
              className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Priced</p>
                <ListChecks className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
              </div>
              <p className="mt-1.5 text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{wantedDashboard.pricedCount}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{pricedPercent}% of wanted list</p>
            </button>
            <button
              type="button"
              onClick={() => {
                clearWantedFilter()
                setWantedSort("lowest")
              }}
              className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Average</p>
                <Tag className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />
              </div>
              <p className="mt-1.5 truncate text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl">{averagePriceLabel ?? "No price"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">priced cards only</p>
            </button>
            <button
              type="button"
              onClick={() => {
                clearWantedFilter()
                setWantedSort("highest")
              }}
              className="rounded-2xl border border-border/55 bg-background/56 p-2.5 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03] sm:p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Highest</p>
                <Layers3 className="h-3.5 w-3.5 text-rose-600 dark:text-rose-300" />
              </div>
              <p className="mt-2 truncate text-base font-bold">{highestCard?.card.card_name ?? "No priced cards"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{highestPriceLabel ?? "No price"}</p>
            </button>
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.85fr)]">
          <div className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Price bands</p>
                <h3 className="text-sm font-semibold">What the basket is made of</h3>
              </div>
              <span className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                {wantedDashboard.unpricedCount} unpriced
              </span>
            </div>

            <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-muted/70 dark:bg-white/[0.06]">
              {wantedDashboard.priceBands.filter((band) => band.count > 0).map((band) => {
                const bandStyle = WANTED_PRICE_BAND_STYLES[band.id]
                return (
                  <div
                    key={band.id}
                    className={`${bandStyle.bar} h-full min-w-[3px]`}
                    style={{ width: `${(band.count / bandDenominator) * 100}%` }}
                    title={`${band.label}: ${band.count}`}
                  />
                )
              })}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {wantedDashboard.priceBands.map((band) => {
                const bandStyle = WANTED_PRICE_BAND_STYLES[band.id]
                const bandTotalLabel = priceFormat.amount(band.totalGbp)
                const bandPercent = Math.round((band.count / bandDenominator) * 100)

                return (
                  <button
                    key={band.id}
                    type="button"
                    onClick={() => setWantedFilter({ kind: "band", value: band.id, label: band.label }, band.id === "unpriced" ? "unpriced" : "highest")}
                    className={`rounded-2xl border p-3 text-left transition dark:border-white/10 ${
                      isWantedFilterActive("band", band.id)
                        ? "border-primary/45 bg-primary/8"
                        : "border-border/50 bg-background/50 hover:border-primary/35 hover:bg-primary/5 dark:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${bandStyle.dot}`} />
                        <span className="truncate text-xs font-semibold">{band.label}</span>
                      </div>
                      <span className="text-xs font-bold tabular-nums">{band.count}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                      <div className={`h-full ${bandStyle.bar}`} style={{ width: `${bandPercent}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{bandTotalLabel ?? "No priced total"}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Concentration</p>
                <h3 className="text-sm font-semibold">Where the want list clusters</h3>
              </div>
              <Languages className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="mt-4 space-y-2">
              {visibleSetBreakdown.map((group) => (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => setWantedFilter({ kind: "set", value: group.label, label: group.label }, "set")}
                  className={`block w-full rounded-xl p-2 text-left transition ${
                    isWantedFilterActive("set", group.label)
                      ? "bg-primary/8"
                      : "hover:bg-primary/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold">{group.label}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{group.count} cards</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-sky-500"
                      style={{ width: `${Math.max(6, (group.count / maxSetCount) * 100)}%` }}
                    />
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 border-t border-border/50 pt-3 dark:border-white/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Languages</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visibleLanguageBreakdown.map((group) => (
                  <button
                    key={group.label}
                    type="button"
                    onClick={() => setWantedFilter({ kind: "language", value: group.label, label: formatCardLanguageLabel(group.label) }, "newest")}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition dark:border-white/10 ${
                      isWantedFilterActive("language", group.label)
                        ? "border-primary/45 bg-primary/10 text-primary"
                        : "border-border/55 bg-background/55 hover:border-primary/35 hover:text-foreground dark:bg-white/[0.04]"
                    }`}
                  >
                    {formatCardLanguageLabel(group.label)} <span className="text-muted-foreground tabular-nums">{group.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 border-t border-border/50 pt-3 dark:border-white/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Finishes</p>
              <div className="mt-2 space-y-1.5">
                {visibleFinishBreakdown.map((group) => (
                  <button
                    key={group.label}
                    type="button"
                    onClick={() => setWantedFilter({ kind: "finish", value: group.label, label: formatCardFinishLabel(group.label) }, "newest")}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl p-1.5 text-left transition ${
                      isWantedFilterActive("finish", group.label)
                        ? "bg-primary/8"
                        : "hover:bg-primary/5"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium">{formatCardFinishLabel(group.label)}</span>
                        <span className="text-muted-foreground tabular-nums">{group.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/80 dark:bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{ width: `${Math.max(6, (group.count / maxFinishCount) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.2rem] border border-border/65 bg-card/84 p-3 dark:border-white/10 dark:bg-card/70 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Buy first</p>
              <h3 className="text-sm font-semibold">Highest impact pickups</h3>
            </div>
            {wantedDashboard.unpricedCount > 0 ? (
              <button
                type="button"
                onClick={() => setWantedSort("unpriced")}
                className="rounded-full border border-slate-500/20 bg-slate-500/10 px-3 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-500/15 dark:text-slate-300"
              >
                Review {wantedDashboard.unpricedCount} unpriced
              </button>
            ) : null}
          </div>

          {priorityCards.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-border/55 bg-background/50 px-3 py-3 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
              Prices are still loading or unavailable for the current wanted cards.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {priorityCards.map((wantedCard) => {
                const pokemon = getPokemonSummary(wantedCard.pokemonId)
                const priorityPriceLabel = priceFormat.amount(wantedCard.effectiveGbpAmount, wantedCard.price)

                return (
                  <button
                    key={`priority-${wantedCard.key}`}
                    type="button"
                    onClick={() => jumpToWantedPokemonPage(pokemon)}
                    className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 rounded-2xl border border-border/55 bg-background/52 p-2 text-left transition hover:border-primary/35 hover:bg-primary/5 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <span className="trading-card relative w-full border border-border/55 bg-muted dark:border-white/10">
                      {wantedCard.card.card_image ? (
                        <img src={toCardImageSrc(wantedCard.card.card_image) ?? undefined} alt={wantedCard.card.card_name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">No image</span>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{wantedCard.card.card_name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{wantedCard.pokemonName}</span>
                      <span className="mt-1 block text-sm font-bold tabular-nums">{priorityPriceLabel ?? "No price"}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-[1.2rem] border border-border/65 bg-card/84 dark:border-white/10 dark:bg-card/70">
          <div className="flex flex-col gap-3 border-b border-border/50 p-3 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Wanted cards</p>
              <h3 className="text-sm font-semibold">
                {sortedWantedDashboardCards.length}
                {isExplorerFiltered ? ` of ${totalWantedCount}` : ""} cards, sorted for buying
              </h3>
              {isExplorerFiltered ? (
                <button
                  type="button"
                  onClick={clearWantedFilter}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[11px] font-semibold text-primary"
                >
                  {wantedExplorerFilter.label}
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
              </span>
              <div className="flex shrink-0 rounded-full border border-border/55 bg-background/55 p-1 dark:border-white/10 dark:bg-white/[0.04]">
                {WANTED_SORT_OPTIONS.map((option) => {
                  const isActive = wantedSort === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setWantedSort(option.id)}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-white/[0.06]"}`}
                    >
                      <span className="sm:hidden">{option.mobileLabel}</span>
                      <span className="hidden sm:inline">{option.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="divide-y divide-border/50 dark:divide-white/10">
            {sortedWantedDashboardCards.map((wantedCard) => {
              const { pokemonId, pokemonName, card, price } = wantedCard
              const pokemon = getPokemonSummary(pokemonId)
              const goodPriceLabel = priceFormat.amount(wantedCard.goodGbpAmount, price)
              const marketPriceLabel = priceFormat.amount(wantedCard.effectiveGbpAmount, wantedCard.price)
              const rangePriceLabel = priceFormat.range(price?.lowGbpAmount, price?.highGbpAmount, price)
              const confidenceLabel = formatPriceConfidenceLabel(price)
              const sourceLabel = formatPriceSourceLabel(price)
              const bandStyle = WANTED_PRICE_BAND_STYLES[wantedCard.priceBandId]
              const cardMeta = [
                card.card_set,
                card.local_id ? `#${card.local_id}${card.set_total ? `/${card.set_total}` : ""}` : null,
                formatCardLanguageLabel(card.card_language),
                formatCardFinishLabel(card.card_finish),
              ].filter(Boolean).join(" · ")

              return (
                <article
                  key={wantedCard.key}
                  className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[4.75rem_minmax(0,1fr)_9.5rem] sm:p-4"
                >
                  <button
                    type="button"
                    onClick={() => pokemon && handlePokemonSelect(pokemon)}
                    className="trading-card relative w-full border border-border/60 bg-muted text-left dark:border-white/10 sm:w-[4.75rem]"
                  >
                    {card.card_image ? (
                      <img src={toCardImageSrc(card.card_image) ?? undefined} alt={card.card_name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">No image</div>
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${bandStyle.chip}`}>
                        {WANTED_PRICE_BAND_LABELS[wantedCard.priceBandId]}
                      </span>
                      <span className="text-[11px] font-semibold text-muted-foreground">{formatDexNumber(pokemonId)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => pokemon && handlePokemonSelect(pokemon)}
                      className="mt-1 block max-w-full text-left"
                    >
                      <h3 className="truncate text-sm font-semibold">{card.card_name}</h3>
                      <p className="truncate text-xs capitalize text-muted-foreground">{pokemonName}</p>
                    </button>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{cardMeta}</p>

                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      {rangePriceLabel ? (
                        <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                          Range {rangePriceLabel}
                        </span>
                      ) : null}
                      {confidenceLabel ? (
                        <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                          {confidenceLabel}
                        </span>
                      ) : null}
                      {sourceLabel ? (
                        <span className="rounded-full border border-border/50 bg-background/45 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">
                          {sourceLabel}
                        </span>
                      ) : null}
                    </div>
                    <CardPriceEvidence price={price} showTrend={false} />
                  </div>

                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex sm:flex-col sm:items-stretch sm:justify-center">
                    <div className="rounded-2xl border border-border/55 bg-background/50 px-2.5 py-2 dark:border-white/10 dark:bg-white/[0.03] sm:text-right">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Market</p>
                      <p className="text-sm font-bold tabular-nums">{marketPriceLabel ?? (isLoadingPrices ? "Loading" : "No price")}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/18 bg-emerald-500/8 px-2.5 py-2 sm:text-right">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Good buy</p>
                      <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{goodPriceLabel ?? "No price"}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      disabled={readOnlyMode}
                      onClick={() => handleGotWantedCard(pokemonId, pokemonName, card)}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Got
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 rounded-xl text-xs"
                        disabled={!pokemon}
                        onClick={() => jumpToWantedPokemonPage(pokemon)}
                      >
                        Page
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 rounded-xl text-xs text-muted-foreground hover:text-destructive"
                        disabled={readOnlyMode}
                        onClick={() => handleClearWantedCard(pokemonId, card)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
