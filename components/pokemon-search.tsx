"use client"

import { toCardImageSrc } from "@/lib/card-image-url"
import type React from "react"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Search, ArrowRight, Star, MapPinned, Layers3, Loader2, Palette, History } from "lucide-react"
import { Input } from "@/components/ui/input"
import { POKEMON_CATALOG, formatPokemonDisplayName, getPokemonSummary } from "@/lib/pokemon-catalog"
import {
  getInitialPokemonSearchFilter,
  getPokemonSearchPageJump,
  matchesPokemonSearchStateFilter,
  searchPokemonItems,
  type PokemonSearchStateFilter,
  type PokemonSearchSlotState,
} from "@/lib/pokemon-search-state"
import {
  formatCardNumber,
  type SearchCardResult,
} from "@/lib/pokemon-card-browse"
import { addRecentCard, readRecentCards, toRecentCard, writeRecentCards, type RecentCard } from "@/lib/recent-cards"
import { useCardSearch, useIllustratorSearch, useSetSearch } from "@/hooks/use-card-search"
import { formatSetHitMeta } from "@/lib/set-search"
import type { TCGSetSummary } from "@/lib/tcg-set-slots"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/lib/pricing-region"
import { CARD_STANDING_BADGES, getCardStanding } from "@/lib/show-hunt"

type SearchStateFilter = PokemonSearchStateFilter

export interface PokemonSearchResultMeta {
  previewImage?: string | null
  previewFitClass?: string
  previewToneClass?: string
  cardPreviewImage?: string | null
  cardPreviewToneClass?: string
  stateLabel?: string | null
  stateToneClass?: string
  cardLabel?: string | null
  locationLabel?: string | null
  pageNumber?: number | null
  isFavorite?: boolean
  isSelected?: boolean
  slotState?: PokemonSearchSlotState
  /** "Owned in <binder>" when another binder holds this Pokémon. */
  elsewhereLabel?: string | null
}

interface PokemonSearchProps {
  onSelect: (pokemon: any) => void
  pokemonList?: { id: number; name: string }[]
  getResultMeta?: (pokemon: { id: number; name: string }) => PokemonSearchResultMeta | null
  currentPagePokemonList?: { id: number; name: string }[]
  totalPages?: number
  onJumpToPage?: (page: number) => void
  /** Open the read-only "all cards" view for a Pokémon, optionally highlighting one printing. */
  onBrowseCards?: (pokemon: { id: number; name: string }, highlightCardId?: string) => void
  /** Cards available on this device (own cards + cached card data), searched when the card search API can't be reached. */
  getOfflineCards?: () => Promise<SearchCardResult[]>
  /** Open the read-only view of every card by an illustrator. Enables illustrator results. */
  onBrowseIllustrator?: (name: string) => void
  /** Open Sets on a set whose name or id matches the search. Enables set results. */
  onBrowseSet?: (set: TCGSetSummary) => void
  /** Formats a card's headline price in the user's display currency; card hits show no price without it. */
  formatPrice?: (price: CardPriceSnapshot | undefined) => string | null
  /** The user's pricing region, used to weight card hit prices. */
  pricingRegion?: PricingRegion
  /** Whether a printing is in the binder or on the want list: card hits get Show mode's Owned / Wanted badge. */
  getCardState?: (card: SearchCardResult, pokemon: { id: number; name: string }) => { owned: boolean; wanted: boolean }
}

function cardThumbnail(image?: string) {
  if (!image) return null
  return toCardImageSrc(image.replace(/\/high\.webp$/, "/low.webp"))
}

/** Offline, a thumbnail that was never loaded falls back to its saved copy (via the image proxy). */
const SEARCH_FILTERS: Array<{
  id: SearchStateFilter
  label: string
}> = [
  { id: "all", label: "All" },
  { id: "current", label: "This Page" },
  { id: "needed", label: "Needed" },
  { id: "missing", label: "Missing" },
  { id: "upgrade", label: "Upgrades" },
  { id: "wanted", label: "Wanted" },
  { id: "perfect", label: "Perfect" },
]

export default function PokemonSearch({
  onSelect,
  pokemonList: propPokemonList,
  getResultMeta,
  currentPagePokemonList = [],
  totalPages = 0,
  onJumpToPage,
  onBrowseCards,
  getOfflineCards,
  onBrowseIllustrator,
  onBrowseSet,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  getCardState,
}: PokemonSearchProps) {
  const [query, setQuery] = useState("")
  // Read after mount so the server render and first client render agree.
  const [recentCards, setRecentCards] = useState<RecentCard[]>([])
  useEffect(() => {
    if (!onBrowseCards) return
    const frameId = window.requestAnimationFrame(() => setRecentCards(readRecentCards(window.localStorage)))
    return () => window.cancelAnimationFrame(frameId)
  }, [onBrowseCards])
  // Opening a card closes the search, so write storage now rather than inside a state update that may be dropped.
  const rememberCard = useCallback((card: RecentCard) => {
    const next = addRecentCard(readRecentCards(window.localStorage), card)
    writeRecentCards(window.localStorage, next)
    setRecentCards(next)
  }, [])
  const clearRecentCards = useCallback(() => {
    writeRecentCards(window.localStorage, [])
    setRecentCards([])
  }, [])
  const [activeFilter, setActiveFilter] = useState<SearchStateFilter>(getInitialPokemonSearchFilter)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const pokemonList = propPokemonList || POKEMON_CATALOG
  const currentPagePokemonIds = useMemo(
    () => new Set(currentPagePokemonList.map((pokemon) => pokemon.id)),
    [currentPagePokemonList],
  )

  useEffect(() => {
    if (activeFilter === "current" && currentPagePokemonList.length === 0) {
      setActiveFilter("all")
    }
  }, [activeFilter, currentPagePokemonList.length])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const matchesFilter = useCallback((filter: SearchStateFilter, pokemon: { id: number; name: string }) => {
    const meta = getResultMeta?.(pokemon)

    return matchesPokemonSearchStateFilter(filter, {
      slotState: meta?.slotState,
      isCurrentPage: currentPagePokemonIds.has(pokemon.id),
    })
  }, [currentPagePokemonIds, getResultMeta])

  // Chip counts depend on the collection and current page, not the query: one pass over the catalogue, reused
  // on every keystroke (previously each chip re-filtered the whole list on every render).
  const filterCounts = useMemo(() => {
    const counts = new Map<SearchStateFilter, number>(SEARCH_FILTERS.map((filterOption) => [filterOption.id, 0]))
    for (const pokemon of pokemonList) {
      const meta = getResultMeta?.(pokemon)
      const context = { slotState: meta?.slotState, isCurrentPage: currentPagePokemonIds.has(pokemon.id) }
      for (const filterOption of SEARCH_FILTERS) {
        if (matchesPokemonSearchStateFilter(filterOption.id, context)) {
          counts.set(filterOption.id, (counts.get(filterOption.id) ?? 0) + 1)
        }
      }
    }
    return counts
  }, [currentPagePokemonIds, getResultMeta, pokemonList])

  const visibleResults = useMemo(() => {
    const byFilter = pokemonList.filter((pokemon) => matchesFilter(activeFilter, pokemon))

    if (!query.trim()) {
      return byFilter.slice(0, 60)
    }

    return searchPokemonItems(query, byFilter, 40)
  }, [activeFilter, matchesFilter, pokemonList, query])

  const cardSearch = useCardSearch(query, Boolean(onBrowseCards), getOfflineCards)
  // One batched price lookup for every card hit (cached on the device, so offline hits keep their prices).
  const cardPriceLookups = useMemo(
    () => formatPrice ? cardSearch.groups.flatMap((group) => group.cards.map((card) => ({ cardId: card.id, language: card.language ?? "en" }))) : [],
    [cardSearch.groups, formatPrice],
  )
  const { pricesByCardId: cardPrices } = useRegionalCardPrices(cardPriceLookups, cardPriceLookups.length > 0, pricingRegion)
  const illustratorResults = useIllustratorSearch(query, Boolean(onBrowseIllustrator))
  const setResults = useSetSearch(query, Boolean(onBrowseSet))

  const showRecentCards = Boolean(onBrowseCards) && !query.trim() && recentCards.length > 0

  const pageJump = useMemo(() => {
    if (!onJumpToPage || totalPages < 1) return null
    return getPokemonSearchPageJump(query, totalPages)
  }, [onJumpToPage, query, totalPages])

  useEffect(() => {
    if (visibleResults.length === 1 && query.trim()) {
      setSelectedIndex(0)
      return
    }

    setSelectedIndex((prev) => {
      if (visibleResults.length === 0) {
        return -1
      }

      return Math.min(prev, visibleResults.length - 1)
    })
  }, [visibleResults, query])

  const handleSelectPokemon = useCallback(
    (pokemon: { id: number; name: string }) => {
      const summary = getPokemonSummary(pokemon.id)
      if (summary) onSelect(summary)
      setQuery("")
      setSelectedIndex(-1)
    },
    [onSelect],
  )

  const handleJumpToPage = useCallback(
    (page: number) => {
      if (!onJumpToPage) return
      onJumpToPage(page)
      setQuery("")
      setSelectedIndex(-1)
    },
    [onJumpToPage],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          if (visibleResults.length === 0) return
          e.preventDefault()
          setSelectedIndex((prev) => (prev < visibleResults.length - 1 ? prev + 1 : prev))
          break
        case "ArrowUp":
          if (visibleResults.length === 0) return
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
          break
        case "Enter":
          e.preventDefault()
          if (pageJump) {
            handleJumpToPage(pageJump.page)
          } else if (selectedIndex >= 0) {
            handleSelectPokemon(visibleResults[selectedIndex])
          } else if (visibleResults.length === 1) {
            handleSelectPokemon(visibleResults[0])
          }
          break
        case "Escape":
          e.preventDefault()
          setQuery("")
          setSelectedIndex(-1)
          break
      }
    },
    [handleJumpToPage, handleSelectPokemon, pageJump, selectedIndex, visibleResults],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          type="text"
          placeholder={onBrowseCards ? "Search Pokémon, cards, sets, artists or #dex…" : "Search or browse Pokémon..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
            data-overlay-escape="clear"
          className="h-12 rounded-2xl border-2 border-primary/20 bg-card pl-12 text-lg focus:border-primary"
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {SEARCH_FILTERS.map((filterOption) => {
          const count = filterCounts.get(filterOption.id) ?? 0

          if (filterOption.id !== "all" && count === 0) {
            return null
          }

          const isActive = activeFilter === filterOption.id

          return (
            <button
              key={filterOption.id}
              type="button"
              onClick={() => {
                setActiveFilter(filterOption.id)
                setSelectedIndex(-1)
              }}
              aria-pressed={isActive}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                isActive
                  ? "border-primary/35 bg-primary/12 text-primary"
                  : "border-border/50 bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground"
              }`}
            >
              {filterOption.label}
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {pageJump ? (
        <button
          type="button"
          onClick={() => handleJumpToPage(pageJump.page)}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3 text-left text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <MapPinned className="h-4 w-4 shrink-0" />
            <span className="truncate">{pageJump.label}</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </button>
      ) : visibleResults.length === 1 && query.trim() ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-primary/30 bg-primary/5 px-4 py-3 text-center text-sm font-medium text-primary">
          <span>Press Enter to select</span>
          <ArrowRight className="w-4 h-4" />
        </div>
      ) : null}

      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-[1.75rem] border border-border/50 bg-card/70">
        {showRecentCards || visibleResults.length > 0 || setResults.length > 0 || illustratorResults.length > 0 || cardSearch.groups.length > 0 || cardSearch.loading ? (
          <div className="h-full overflow-y-auto">
            {showRecentCards ? (
              <section aria-label="Recently viewed cards" className="border-b border-border/50 pb-2">
                <div className="flex items-center justify-between gap-2 px-4 pt-2">
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <History className="h-3 w-3" />
                    Recently viewed
                  </p>
                  <button
                    type="button"
                    onClick={clearRecentCards}
                    aria-label="Clear recently viewed cards"
                    className="-mr-2 min-h-9 rounded-full px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto px-3 pb-1">
                  {recentCards.map((card) => {
                    const thumb = cardThumbnail(card.image)
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          rememberCard({ ...card, viewedAt: new Date().toISOString() })
                          onBrowseCards?.({ id: card.dexId, name: card.pokemonName }, card.id)
                        }}
                        aria-label={`${card.name} ${card.number} ${card.setName}`}
                        className="w-[4.6rem] shrink-0 text-left"
                      >
                        <div className="trading-card w-full border border-border/50 bg-muted/40">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-[10px] font-semibold">{card.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground tabular-nums">{card.number}</p>
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}
            {visibleResults.length > 0 && (showRecentCards || setResults.length > 0 || illustratorResults.length > 0 || cardSearch.groups.length > 0 || cardSearch.loading) ? (
              <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pokémon</p>
            ) : null}
            {visibleResults.map((pokemon, index) => {
              const meta = getResultMeta?.(pokemon)
              const isActive = index === selectedIndex
              const displayName = formatPokemonDisplayName(pokemon.name)

              return (
                <div
                  key={pokemon.id}
                  className={`flex w-full items-stretch border-b border-border/50 transition-colors last:border-b-0 ${
                    isActive
                      ? "bg-primary/20 text-primary"
                      : "hover:bg-primary/10 text-foreground"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectPokemon(pokemon)}
                    className="min-w-0 flex-1 px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative h-14 w-14 shrink-0">
                        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/30">
                          {meta?.previewImage ? (
                            <img
                              src={meta.previewImage}
                              alt={displayName}
                              className={`h-full w-full p-1.5 ${meta.previewFitClass || "object-contain"} ${meta.previewToneClass || ""}`}
                            />
                          ) : (
                            <div className="text-[10px] text-muted-foreground">No preview</div>
                          )}
                        </div>
                        {meta?.cardPreviewImage ? (
                          <div className="trading-card absolute -bottom-1 -right-1 w-7 border-2 border-card bg-background shadow-md">
                            <img
                              src={meta.cardPreviewImage}
                              alt={`${displayName} card preview`}
                              className={`h-full w-full object-cover ${meta.cardPreviewToneClass || ""}`}
                            />
                          </div>
                        ) : null}
                        {meta?.isFavorite ? (
                          <div className="absolute -right-1 -top-1 rounded-full bg-amber-500 p-1 text-white shadow">
                            <Star className="h-2.5 w-2.5 fill-current" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="min-w-0">
                          <div className={`truncate font-semibold ${isActive ? "text-primary" : ""}`}>{displayName}</div>
                          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                            <span>#{pokemon.id}</span>
                            {meta?.stateLabel ? (
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.stateToneClass || "bg-muted text-muted-foreground"}`}>
                                {meta.stateLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {meta?.cardLabel ? <span className="truncate">{meta.cardLabel}</span> : null}
                          {meta?.locationLabel ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPinned className="h-3 w-3" />
                              {meta.locationLabel}
                            </span>
                          ) : null}
                          {meta?.elsewhereLabel ? <span className="line-clamp-2 min-w-0 break-words font-medium text-primary" title={meta.elsewhereLabel} data-testid="owned-elsewhere">{meta.elsewhereLabel}</span> : null}
                        </div>
                      </div>

                      {isActive || meta?.isSelected ? <ArrowRight className="h-4 w-4 shrink-0 text-primary" /> : null}
                    </div>
                  </button>

                  {onBrowseCards ? (
                    <div className="flex shrink-0 items-center pr-1.5">
                      <button
                        type="button"
                        onClick={() => onBrowseCards(pokemon)}
                        aria-label={`All ${displayName} cards`}
                        title="All cards"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/75 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                      >
                        <Layers3 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}

                  {meta?.pageNumber && onJumpToPage ? (
                    <div className="flex shrink-0 items-center pr-3">
                      <button
                        type="button"
                        onClick={() => handleJumpToPage(meta.pageNumber!)}
                        aria-label={`Go to page ${meta.pageNumber}`}
                        className="inline-flex h-9 items-center gap-1 rounded-full border border-border/60 bg-background/75 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                      >
                        <MapPinned className="h-3 w-3" />
                        <span className="hidden sm:inline">Page</span>
                        <span className="tabular-nums">{meta.pageNumber}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {setResults.length > 0 ? (
              <section aria-label="Set results" className="border-t border-border/50 px-3 pb-2">
                <p className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sets</p>
                <div className="flex flex-col gap-1">
                  {setResults.map((set) => {
                    const meta = formatSetHitMeta(set)
                    return (
                      <button
                        key={set.id}
                        type="button"
                        onClick={() => onBrowseSet?.(set)}
                        aria-label={`Open set ${set.name}${meta ? `, ${meta}` : ""}`}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-primary/10"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Layers3 className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{set.name}</span>
                          {meta ? <span className="block truncate text-[11px] text-muted-foreground">{meta}</span> : null}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}
            {illustratorResults.length > 0 ? (
              <section aria-label="Illustrator results" className="border-t border-border/50 px-3 pb-2">
                <p className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Illustrators</p>
                <div className="flex flex-col gap-1">
                  {illustratorResults.map((illustrator) => (
                    <button
                      key={illustrator.name}
                      type="button"
                      onClick={() => onBrowseIllustrator?.(illustrator.name)}
                      aria-label={`Illustrator ${illustrator.name}, ${illustrator.cardCount} card${illustrator.cardCount === 1 ? "" : "s"}`}
                      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-primary/10"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Palette className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{illustrator.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{illustrator.cardCount} card{illustrator.cardCount === 1 ? "" : "s"}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            {cardSearch.groups.length > 0 || cardSearch.loading ? (
              <section aria-label="Card results" className="border-t border-border/50 pb-2">
                <p className="flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Cards
                  {cardSearch.loading ? <Loader2 className="h-3 w-3 animate-spin" aria-label="Searching cards" /> : null}
                  {cardSearch.offline ? <span className="normal-case tracking-normal font-normal">· offline: your cards and saved sets</span> : null}
                </p>
                {cardSearch.groups.map((group) => {
                  const groupName = formatPokemonDisplayName(group.name)
                  return (
                    <div key={group.dexId} className="px-3 py-2" data-card-group={group.dexId}>
                      <button
                        type="button"
                        onClick={() => onBrowseCards?.({ id: group.dexId, name: group.name })}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-1 py-1 text-left hover:bg-primary/10"
                        aria-label={`${groupName}: ${group.cards.length} matching card${group.cards.length === 1 ? "" : "s"}, show all cards`}
                      >
                        <span className="min-w-0 truncate text-sm font-semibold">
                          {groupName} <span className="font-normal text-muted-foreground">#{group.dexId}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary">
                          All cards <ArrowRight className="h-3 w-3" />
                        </span>
                      </button>
                      <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                        {group.cards.map((card) => {
                          const thumb = cardThumbnail(card.image)
                          const price = formatPrice?.(cardPrices[getCardPriceKey(card.id, card.language ?? "en")])?.split(" (")[0] ?? null
                          const standing = getCardState ? getCardStanding(getCardState(card, { id: group.dexId, name: group.name })) : null
                          const badge = standing && standing !== "missing" ? CARD_STANDING_BADGES[standing] : null
                          return (
                            <button
                              key={card.id}
                              type="button"
                              onClick={() => {
                                rememberCard(toRecentCard(card, { id: group.dexId, name: group.name }))
                                onBrowseCards?.({ id: group.dexId, name: group.name }, card.id)
                              }}
                              aria-label={`${card.name} ${formatCardNumber(card)} ${card.set.name}${badge ? `, ${badge.label}` : ""}`}
                              data-standing={standing ?? undefined}
                              className="w-[4.6rem] shrink-0 text-left"
                            >
                              <div className={`trading-card relative w-full border bg-muted/40 ${standing === "owned" ? "border-emerald-500/60" : standing === "wanted" ? "border-rose-500/60" : "border-border/50"}`}>
                                {thumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                                ) : null}
                                {badge ? (
                                  <span aria-hidden className={`absolute inset-x-1 bottom-1 truncate rounded-full px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white shadow-sm ${standing === "owned" ? "bg-emerald-600" : "bg-rose-600"}`}>
                                    {badge.label}
                                  </span>
                                ) : null}
                              </div>
                              <p className="mt-1 truncate text-[10px] font-semibold">{card.set.name}</p>
                              <p className="truncate text-[10px] text-muted-foreground tabular-nums">{formatCardNumber(card)}</p>
                              {price ? <p className="truncate text-[11px] font-bold tabular-nums" data-testid="search-card-price">{price}</p> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            {pageJump
              ? "Press Enter or tap the page jump above."
              : query.trim()
              ? cardSearch.offline
                ? "No matches in your saved cards. Try a card name or set you have saved."
                : "No matches. Try a Pokémon name, a set, or both, like Abra 151."
              : "Nothing in this filter yet. Try another view or search by name."}
          </div>
        )}
      </div>
    </div>
  )
}
