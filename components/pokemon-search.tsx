"use client"

import type React from "react"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Search, ArrowRight, Star, MapPinned, Layers3, Loader2, Palette } from "lucide-react"
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
  groupCardResultsByPokemon,
  parseCardSearchQuery,
  type CardSearchGroup,
  type SearchCardResult,
} from "@/lib/pokemon-card-browse"
import { searchOfflineCards } from "@/lib/offline-card-index"
import { getProxiedThumbnailUrl } from "@/lib/card-show-prep"
import { loadIllustratorDirectory } from "@/lib/illustrator-client"
import { normalizeIllustratorText, searchIllustrators, type IllustratorSummary } from "@/lib/illustrators"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/lib/pricing-region"

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
  /** Formats a card's headline price in the user's display currency; card hits show no price without it. */
  formatPrice?: (price: CardPriceSnapshot | undefined) => string | null
  /** The user's pricing region, used to weight card hit prices. */
  pricingRegion?: PricingRegion
}

const CARD_SEARCH_DEBOUNCE_MS = 250

function cardThumbnail(image?: string) {
  if (!image) return null
  return image.endsWith("/high.webp") ? image.replace(/\/high\.webp$/, "/low.webp") : image
}

type CardSearchState = { key: string; groups: CardSearchGroup[]; loading: boolean; offline: boolean }

const groupCards = (cards: SearchCardResult[]) =>
  groupCardResultsByPokemon(cards, (dexId) => getPokemonSummary(dexId)?.name ?? null, { maxGroups: 10, maxCardsPerGroup: 6 })

/**
 * Debounced card search against the TCG mirror, grouped by Pokémon. Offline (or when the API can't be
 * reached) it searches the cards on this device instead and says so.
 */
function useCardSearch(query: string, enabled: boolean, getOfflineCards?: () => Promise<SearchCardResult[]>) {
  const [state, setState] = useState<CardSearchState>({ key: "", groups: [], loading: false, offline: false })
  const parsed = parseCardSearchQuery(query)
  const key = enabled && (parsed.text.length >= 2 || parsed.cardId) ? query.trim().toLowerCase() : ""
  const offlineCardsRef = useRef<Promise<SearchCardResult[]> | null>(null)
  const getOfflineCardsRef = useRef(getOfflineCards)
  useEffect(() => {
    getOfflineCardsRef.current = getOfflineCards
    offlineCardsRef.current = null
  }, [getOfflineCards])

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const searchOnDevice = async () => {
      const loader = getOfflineCardsRef.current
      if (!loader) return null
      offlineCardsRef.current ??= loader().catch(() => [])
      const cards = await offlineCardsRef.current
      return groupCards(searchOfflineCards(cards, key))
    }
    const showOffline = async () => {
      const groups = await searchOnDevice()
      if (controller.signal.aborted) return
      setState({ key, groups: groups ?? [], loading: false, offline: groups !== null })
    }

    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, key, loading: true }))
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        void showOffline()
        return
      }
      fetch(`/api/tcg-card-search?q=${encodeURIComponent(key)}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Card search failed (${response.status})`)
          return response.json()
        })
        .then((payload: { cards?: SearchCardResult[] }) => {
          const cards = Array.isArray(payload?.cards) ? payload.cards : []
          setState({ key, groups: groupCards(cards), loading: false, offline: false })
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === "AbortError" || controller.signal.aborted) return
          void showOffline()
        })
    }, CARD_SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  if (!key) return { groups: [] as CardSearchGroup[], loading: false, offline: false }
  return state.key === key
    ? { groups: state.groups, loading: state.loading, offline: state.offline }
    : { groups: [] as CardSearchGroup[], loading: true, offline: false }
}

/** Fuzzy illustrator matches from the directory (loaded once; offline it uses the copy saved on this device). */
function useIllustratorSearch(query: string, enabled: boolean) {
  const [directory, setDirectory] = useState<IllustratorSummary[] | null>(null)
  const active = enabled && normalizeIllustratorText(query).length >= 2

  useEffect(() => {
    if (!active || directory) return
    let cancelled = false
    void loadIllustratorDirectory().then((result) => {
      if (!cancelled && result.data) setDirectory(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [active, directory])

  return useMemo(() => (active && directory ? searchIllustrators(directory, query, 5) : []), [active, directory, query])
}

/** Offline, a thumbnail that was never loaded falls back to its saved copy (via the image proxy). */
function savedThumbnailOnError(image: string | undefined) {
  return (event: React.SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget
    const fallback = getProxiedThumbnailUrl(image)
    if (!fallback || element.dataset.savedThumbnail === "1") return
    element.dataset.savedThumbnail = "1"
    element.src = fallback
  }
}

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
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
}: PokemonSearchProps) {
  const [query, setQuery] = useState("")
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
          const count = pokemonList.filter((pokemon) => matchesFilter(filterOption.id, pokemon)).length

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
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
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
        {visibleResults.length > 0 || illustratorResults.length > 0 || cardSearch.groups.length > 0 || cardSearch.loading ? (
          <div className="h-full overflow-y-auto">
            {visibleResults.length > 0 && (illustratorResults.length > 0 || cardSearch.groups.length > 0 || cardSearch.loading) ? (
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
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-border/60 bg-background/75 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
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
                          return (
                            <button
                              key={card.id}
                              type="button"
                              onClick={() => onBrowseCards?.({ id: group.dexId, name: group.name }, card.id)}
                              aria-label={`${card.name} ${formatCardNumber(card)} ${card.set.name}`}
                              className="w-[4.6rem] shrink-0 text-left"
                            >
                              <div className="trading-card w-full border border-border/50 bg-muted/40">
                                {thumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" onError={savedThumbnailOnError(card.image)} />
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
          <div className="flex h-full min-h-[12rem] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {pageJump
              ? "Press Enter or tap the page jump above."
              : query.trim()
              ? "No Pokemon match that search in this filter."
              : "Nothing in this filter yet. Try another view or search by name."}
          </div>
        )}
      </div>
    </div>
  )
}
