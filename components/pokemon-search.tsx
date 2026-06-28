"use client"

import type React from "react"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Search, ArrowRight, Star, MapPinned } from "lucide-react"
import { Input } from "@/components/ui/input"
import { usePokemonCache } from "@/hooks/use-pokemon-cache"
import { formatPokemonDisplayName, getPokemonSummary } from "@/lib/pokemon-catalog"
import {
  getInitialPokemonSearchFilter,
  getPokemonSearchPageJump,
  matchesPokemonSearchStateFilter,
  searchPokemonItems,
  type PokemonSearchStateFilter,
  type PokemonSearchSlotState,
} from "@/lib/pokemon-search-state"

type SearchStateFilter = PokemonSearchStateFilter

export interface PokemonSearchResultMeta {
  previewImage?: string | null
  previewFitClass?: string
  previewToneClass?: string
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
}: PokemonSearchProps) {
  const [query, setQuery] = useState("")
  const [activeFilter, setActiveFilter] = useState<SearchStateFilter>(getInitialPokemonSearchFilter)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { pokemonList: cachedList } = usePokemonCache()
  
  const pokemonList = propPokemonList || cachedList
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
          placeholder="Search or browse Pokémon..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
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
        {visibleResults.length > 0 ? (
          <div className="h-full overflow-y-auto">
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
                      <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-muted to-muted/30">
                        {meta?.previewImage ? (
                          <img
                            src={meta.previewImage}
                            alt={displayName}
                            className={`absolute inset-1 m-auto h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] ${meta.previewFitClass || "object-contain"} ${meta.previewToneClass || ""}`}
                          />
                        ) : (
                          <div className="text-[10px] text-muted-foreground">No preview</div>
                        )}
                        {meta?.isFavorite ? (
                          <div className="absolute -right-1 -top-1 rounded-full bg-amber-500 p-1 text-white shadow">
                            <Star className="h-2.5 w-2.5 fill-current" />
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className={`truncate font-semibold ${isActive ? "text-primary" : ""}`}>{displayName}</div>
                            <div className="text-sm text-muted-foreground">#{pokemon.id}</div>
                          </div>
                          {meta?.stateLabel ? (
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${meta.stateToneClass || "bg-muted text-muted-foreground"}`}>
                              {meta.stateLabel}
                            </span>
                          ) : null}
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
