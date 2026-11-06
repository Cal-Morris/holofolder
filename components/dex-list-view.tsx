"use client"

import { toCardImageSrc } from "@/lib/card-image-url"
import { formatDexNumber } from "@/lib/pokemon-catalog"
import { useCallback, useMemo, useState, type UIEvent } from "react"
import { Check, Heart, Star, X, Search, Plus, BadgeCheck, Layers3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { CollectedPokemon } from "@/hooks/use-collection"
import type { PokemonSummary } from "@/lib/pokemon-catalog"
import { useCollapseOnScroll } from "@/hooks/use-collapse-on-scroll"
import { useVirtualRows } from "@/hooks/use-virtual-rows"

// Rows are windowed (only those near the viewport render). These match the markup below: `space-y-1.5`
// between rows, and a typical row height to estimate rows that haven't rendered yet.
const ROW_GAP_PX = 6
const ESTIMATED_ROW_HEIGHT_PX = 96

interface DexListViewProps {
  pokemonList: PokemonSummary[]
  collectionByPokemonId: Map<number, CollectedPokemon>
  pricesByKey: Record<string, CardPriceSnapshot>
  getPriceKey: (item?: { card_id?: string | null; card_language?: string | null } | null) => string | null
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  onSelectPokemon: (pokemon: PokemonSummary) => void
  onToggleOwned: (pokemon: PokemonSummary) => void
  /** Owned slot: offer "Move back to Wanted" / "Remove completely". Falls back to onToggleOwned when absent. */
  onRemoveOwned?: (pokemon: PokemonSummary) => void
  onAddCard: (pokemon: PokemonSummary) => void
  onAddWanted: (pokemon: PokemonSummary) => void
  onTogglePerfect: (pokemonId: number) => void
  /** Open the read-only list of every printing of this Pokémon. */
  onBrowseCards?: (pokemon: PokemonSummary) => void
  readOnly: boolean
}

type DexListFilter = "all" | "missing" | "owned" | "wanted" | "perfect" | "upgrade"

const DEX_LIST_FILTERS: Array<{ id: DexListFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing" },
  { id: "owned", label: "Owned" },
  { id: "wanted", label: "Wanted" },
  { id: "perfect", label: "Perfect" },
  { id: "upgrade", label: "Upgrade" },
]

function getSlotState(item?: CollectedPokemon) {
  if (!item) {
    return {
      label: "Missing",
      className: "border-border/60 bg-muted/35 text-muted-foreground",
      icon: X,
    }
  }

  if (item.status === "wishlisted") {
    return {
      label: "Wanted",
      className: "border-amber-400/35 bg-amber-400/12 text-amber-600 dark:text-amber-300",
      icon: Heart,
    }
  }

  if (item.status === "finalized") {
    return {
      label: "Perfect",
      className: "border-amber-400/40 bg-amber-500/14 text-amber-600 dark:text-amber-300",
      icon: Star,
    }
  }

  if (item.status === "considering") {
    return {
      label: "Upgrade",
      className: "border-sky-400/35 bg-sky-400/12 text-sky-600 dark:text-sky-300",
      icon: BadgeCheck,
    }
  }

  return {
    label: "Owned",
    className: "border-emerald-400/35 bg-emerald-400/12 text-emerald-600 dark:text-emerald-300",
    icon: Check,
  }
}

export default function DexListView({
  pokemonList,
  collectionByPokemonId,
  pricesByKey,
  getPriceKey,
  formatPrice,
  onSelectPokemon,
  onToggleOwned,
  onRemoveOwned,
  onAddCard,
  onAddWanted,
  onTogglePerfect,
  onBrowseCards,
  readOnly,
}: DexListViewProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<DexListFilter>("all")
  const heading = useCollapseOnScroll()
  const filterCounts = useMemo(() => {
    const counts: Record<DexListFilter, number> = {
      all: pokemonList.length,
      missing: 0,
      owned: 0,
      wanted: 0,
      perfect: 0,
      upgrade: 0,
    }

    for (const pokemon of pokemonList) {
      const item = collectionByPokemonId.get(pokemon.id)
      const isOwned = Boolean(item && item.status !== "wishlisted")
      const isWanted = Boolean(item?.wanted_cards?.length || item?.status === "wishlisted")

      if (!item) counts.missing += 1
      if (isOwned) counts.owned += 1
      if (isWanted) counts.wanted += 1
      if (item?.status === "finalized") counts.perfect += 1
      if (isOwned && item?.status !== "finalized") counts.upgrade += 1
    }

    return counts
  }, [collectionByPokemonId, pokemonList])
  const filteredPokemonList = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return pokemonList.filter((pokemon) => {
      const item = collectionByPokemonId.get(pokemon.id)
      const isOwned = Boolean(item && item.status !== "wishlisted")
      const isWanted = Boolean(item?.wanted_cards?.length || item?.status === "wishlisted")
      const matchesFilter =
        activeFilter === "all"
        || (activeFilter === "missing" && !item)
        || (activeFilter === "owned" && isOwned)
        || (activeFilter === "wanted" && isWanted)
        || (activeFilter === "perfect" && item?.status === "finalized")
        || (activeFilter === "upgrade" && isOwned && item?.status !== "finalized")

      if (!matchesFilter) return false
      if (!normalizedSearch) return true

      const haystack = [
        pokemon.name,
        String(pokemon.id),
        `#${pokemon.id}`,
        item?.card_name,
        item?.card_set,
      ].filter(Boolean).join(" ").toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [activeFilter, collectionByPokemonId, pokemonList, searchQuery])
  const rowKeys = useMemo(() => filteredPokemonList.map((pokemon) => pokemon.id), [filteredPokemonList])
  const { onScroll: onHeadingScroll } = heading
  const { range, attachScroller, onScroll: onVirtualScroll, measureRow } = useVirtualRows({
    keys: rowKeys,
    gap: ROW_GAP_PX,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT_PX,
  })
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    onHeadingScroll(event)
    onVirtualScroll(event)
  }, [onHeadingScroll, onVirtualScroll])
  const { start, end, offsetTop, totalHeight } = range

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card/88 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-card/70">
      <div className="shrink-0 border-b border-border/45 px-4 py-3">
        <div data-testid="view-heading" data-collapsed={heading.collapsed ? "" : undefined} className={`flex items-center justify-between gap-3 ${heading.collapsed ? "max-sm:hidden" : ""}`}>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">List View</p>
            <h2 className="text-base font-semibold leading-tight tracking-tight sm:truncate sm:text-lg">Manage the dex quickly</h2>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-border/50 bg-background/55 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:flex">
            <Search className="h-3.5 w-3.5" />
            <span>{filteredPokemonList.length}/{pokemonList.length} slots</span>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-2xl border border-border/55 bg-background/58 px-3 py-2 dark:border-white/10 dark:bg-background/35 ${heading.collapsed ? "max-sm:mt-0 mt-3" : "mt-3"}`}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, card, set, or dex #"
            className="min-w-0 -my-2 flex-1 bg-transparent py-2 text-base md:text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="-my-1 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear list search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {DEX_LIST_FILTERS.map((filter) => {
            const isActive = activeFilter === filter.id
            const count = filterCounts[filter.id]

            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className={`min-h-8 shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  isActive
                    ? "border-primary/45 bg-primary text-primary-foreground"
                    : "border-border/55 bg-background/45 text-muted-foreground hover:bg-background/75 hover:text-foreground dark:border-white/10"
                }`}
              >
                {filter.label} <span className="tabular-nums opacity-75">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div ref={attachScroller} data-testid="view-scroller" onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: "touch" }}>
        {filteredPokemonList.length === 0 ? (
          <div className="rounded-2xl border border-border/45 bg-background/45 p-4 text-sm text-muted-foreground">
            No dex slots match the current filters.
          </div>
        ) : null}
        <div style={{ position: "relative", height: totalHeight }}>
          <div className="space-y-1.5" style={{ position: "absolute", top: offsetTop, left: 0, right: 0 }}>
            {filteredPokemonList.slice(start, end).map((pokemon) => {
              const item = collectionByPokemonId.get(pokemon.id)
              const state = getSlotState(item)
              const StateIcon = state.icon
              const priceKey = getPriceKey(item)
              const priceLabel = priceKey ? formatPrice(pricesByKey[priceKey]) : null
              const wantedCount = item?.wanted_cards?.length ?? 0

              return (
                <div
                  key={pokemon.id}
                  ref={measureRow}
                  data-virtual-key={pokemon.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPokemon(pokemon)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelectPokemon(pokemon)
                    }
                  }}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-transparent bg-background/35 p-2.5 text-left transition-all hover:border-border/60 hover:bg-background/70 dark:bg-background/22 dark:hover:border-white/10"
                >
                  <div className={`relative flex shrink-0 items-center justify-center border border-border/45 bg-muted/45 ${item?.card_image ? "trading-card w-10" : "h-14 w-14 overflow-hidden rounded-xl"}`}>
                    <img
                      src={toCardImageSrc(item?.card_image) || pokemon.sprites.other["official-artwork"].front_default}
                      alt={item?.card_name || pokemon.name}
                      className={`h-full w-full ${item?.card_image ? "object-cover" : "object-contain p-1"}`}
                      loading="lazy"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold capitalize">
                          {pokemon.name}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatDexNumber(pokemon.id)}
                          {item?.card_name ? ` · ${item.card_name}` : " · No card selected"}
                        </p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${state.className}`}>
                        <StateIcon className="h-3 w-3" />
                        {state.label}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {onBrowseCards ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            onBrowseCards(pokemon)
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          aria-label={`All ${pokemon.name} cards`}
                          className="inline-flex h-9 items-center gap-1 rounded-full border border-border/55 bg-background/60 px-2.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                        >
                          <Layers3 className="h-3.5 w-3.5" />
                          Cards
                        </button>
                      ) : null}
                      {priceLabel ? (
                        <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {priceLabel}
                        </span>
                      ) : null}
                      {wantedCount > 0 ? (
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                          {wantedCount} want
                        </span>
                      ) : null}
                      {!readOnly ? (
                        <span className="ml-auto flex items-center gap-1">
                          {item && item.status !== "wishlisted" ? (
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className="h-9 gap-1 rounded-full px-3 text-[11px]"
                              aria-haspopup={onRemoveOwned ? "dialog" : undefined}
                              aria-label={`Owned: remove ${pokemon.name}`}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (onRemoveOwned) onRemoveOwned(pokemon)
                                else onToggleOwned(pokemon)
                              }}
                            >
                              <Check className="h-3 w-3" />
                              Owned
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-full px-3 text-[11px]"
                              onClick={(event) => {
                                event.stopPropagation()
                                onToggleOwned(pokemon)
                              }}
                            >
                              Own
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="h-9 w-9 rounded-full"
                            onClick={(event) => {
                              event.stopPropagation()
                              onAddCard(pokemon)
                            }}
                            aria-label={`Add card for ${pokemon.name}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="h-9 w-9 rounded-full"
                            onClick={(event) => {
                              event.stopPropagation()
                              onAddWanted(pokemon)
                            }}
                            aria-label={`Wantlist card for ${pokemon.name}`}
                          >
                            <Heart className="h-3.5 w-3.5" />
                          </Button>
                          {item?.status !== "wishlisted" && item ? (
                            <Button
                              type="button"
                              variant={item.status === "finalized" ? "default" : "outline"}
                              size="icon-sm"
                              className="h-9 w-9 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation()
                                onTogglePerfect(pokemon.id)
                              }}
                              aria-label={`Toggle perfect slot for ${pokemon.name}`}
                            >
                              <Star className={`h-3.5 w-3.5 ${item.status === "finalized" ? "fill-current" : ""}`} />
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
