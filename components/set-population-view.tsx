"use client"

import { useEffect, useMemo, useState, type SyntheticEvent } from "react"
import { Check, Heart, Loader2, Search, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCardPrices, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { CardHighlights } from "@/components/card-highlights"
import type { CollectedPokemon } from "@/hooks/use-collection"
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"
import { getOfflineStore } from "@/lib/offline-store/kv"
import { loadSetQuery, saveSetQuery } from "@/lib/offline-store/records"
import CardShowPrep from "@/components/card-show-prep"
import { getProxiedThumbnailUrl } from "@/lib/card-show-prep"
import { readOfflineSets, searchOfflineSets } from "@/lib/offline-card-index"
import { useCollapseOnScroll } from "@/hooks/use-collapse-on-scroll"

interface SetPopulationViewProps {
  collectionByPokemonId: Map<number, CollectedPokemon>
  pricesByKey: Record<string, CardPriceSnapshot>
  getPriceKey: (item?: { card_id?: string | null; card_language?: string | null } | null) => string | null
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  onSelectSlot: (slot: TCGSetDexSlot) => void
  onCollectCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void | Promise<void>
  onWantCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void | Promise<void>
  onCollectCards?: (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => void | Promise<void>
  onWantCards?: (cards: Array<{ slot: TCGSetDexSlot; card: TCGSetSlotCard }>) => void | Promise<void>
  readOnly: boolean
}

type SetSlotFilter = "all" | "open" | "owned" | "wanted" | "multiple"

const SET_SLOT_FILTERS: Array<{ id: SetSlotFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "owned", label: "Owned" },
  { id: "wanted", label: "Wanted" },
  { id: "multiple", label: "Variants" },
]

// Fallback shortcuts used until the live "latest sets" list loads (or if it fails).
// Newest English main-line releases per TCGdex (api.tcgdex.net/v2/en/sets), checked Oct 2026.
const SET_SHORTCUTS = [
  { label: "30th Celebration", query: "30th Celebration" },
  { label: "30th Classic Collection", query: "30th Classic Collection" },
  { label: "Pitch Black", query: "Pitch Black" },
  { label: "Chaos Rising", query: "Chaos Rising" },
  { label: "Perfect Order", query: "Perfect Order" },
  { label: "Ascended Heroes", query: "Ascended Heroes" },
]

/** Offline, a card image that was never loaded falls back to its saved thumbnail (via the image proxy). */
function savedThumbnailOnError(image: string | undefined) {
  return (event: SyntheticEvent<HTMLImageElement>) => {
    const element = event.currentTarget
    const fallback = getProxiedThumbnailUrl(image)
    if (!fallback || element.dataset.savedThumbnail === "1") return
    element.dataset.savedThumbnail = "1"
    element.src = fallback
  }
}

function formatDexNumber(id: number) {
  return `#${String(id).padStart(4, "0")}`
}

function formatSetMeta(set: TCGSetSummary) {
  return [
    set.seriesName,
    set.officialCardCount ? `${set.officialCardCount} cards` : null,
    set.releaseDate,
  ].filter(Boolean).join(" · ")
}

function getSelectedSetCard(slot: TCGSetDexSlot, selectedCardIdsByDexId: Record<number, string>) {
  return slot.cards.find((card) => card.id === selectedCardIdsByDexId[slot.dexId]) ?? slot.cards[0]
}

export default function SetPopulationView({
  collectionByPokemonId,
  pricesByKey,
  getPriceKey,
  formatPrice,
  onSelectSlot,
  onCollectCard,
  onWantCard,
  onCollectCards,
  onWantCards,
  readOnly,
}: SetPopulationViewProps) {
  const [query, setQuery] = useState("")
  const heading = useCollapseOnScroll()
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [sets, setSets] = useState<TCGSetSummary[]>([])
  const [selectedSet, setSelectedSet] = useState<TCGSetSummary | null>(null)
  const [setCards, setSetCards] = useState<TCGSetSlotCard[]>([])
  const [slots, setSlots] = useState<TCGSetDexSlot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slotSearch, setSlotSearch] = useState("")
  const [slotFilter, setSlotFilter] = useState<SetSlotFilter>("all")
  const [selectedCardIdsByDexId, setSelectedCardIdsByDexId] = useState<Record<number, string>>({})
  const [selectedDexIds, setSelectedDexIds] = useState<Set<number>>(() => new Set())
  const [recentSets, setRecentSets] = useState<TCGSetSummary[]>([])
  const priceLookups = useMemo(() => setCards.map((card) => ({ cardId: card.id, language: card.language })), [setCards])
  const setPrices = useCardPrices(priceLookups, Boolean(selectedSet) && !isLoading)
  const highlightCards = useMemo(() => setCards.map((card) => ({
    id: card.id, language: card.language, name: card.name,
    numberLabel: `${card.localId}/${card.set.officialCardCount ?? "?"}`,
    setName: card.set.name, image: card.image, rarity: card.rarity,
  })), [setCards])

  const [isShowingSavedSets, setIsShowingSavedSets] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    const offlineStore = getOfflineStore()
    void fetch("/api/tcg-set-slots?recent=1", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json().catch(() => null)) as TCGSetSlotsResponse | null
      })
      .then((payload) => {
        if (payload && Array.isArray(payload.sets)) {
          setRecentSets(payload.sets)
          if (offlineStore) void saveSetQuery(offlineStore, "recent=1", payload).catch(() => undefined)
        }
      })
      .catch(async () => {
        // Offline: the last saved list, else the static shortcuts below.
        const saved = offlineStore && !controller.signal.aborted ? await loadSetQuery(offlineStore, "recent=1").catch(() => null) : null
        if (saved && !controller.signal.aborted) setRecentSets(saved.sets)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const trimmedQuery = query.trim()

    if (trimmedQuery.length < 2 && !selectedSetId) {
      setSets([])
      setSelectedSet(null)
      setSetCards([])
      setSlots([])
      setError(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (trimmedQuery) params.set("query", trimmedQuery)
      if (selectedSetId) params.set("setId", selectedSetId)

      const queryString = params.toString()
      const offlineStore = getOfflineStore()
      const applyPayload = (payload: TCGSetSlotsResponse) => {
        setSets(payload.sets)
        setSelectedSet(payload.selectedSet)
        setSlots(payload.slots)
        setSetCards(payload.cards ?? payload.slots.flatMap((slot) => slot.cards))
      }

      setIsShowingSavedSets(false)
      void fetch(`/api/tcg-set-slots?${queryString}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(payload?.error || `Set lookup failed (${response.status})`)
          }
          return payload as TCGSetSlotsResponse
        })
        .then((payload) => {
          applyPayload(payload)
          // Remember sets the user looks at so they open offline (IndexedDB).
          if (offlineStore && payload.selectedSet) void saveSetQuery(offlineStore, queryString, payload).catch(() => undefined)
        })
        .catch(async (fetchError) => {
          if (controller.signal.aborted) return
          // Offline: first the exact copy saved for this lookup (IndexedDB), then any saved sets that match
          // the search, so one can be opened; only then the error.
          const saved = offlineStore ? await loadSetQuery(offlineStore, queryString).catch(() => null) : null
          if (controller.signal.aborted) return
          if (saved) {
            applyPayload(saved)
            return
          }
          if (!selectedSetId && trimmedQuery.length >= 2) {
            const savedSets = searchOfflineSets(await readOfflineSets().catch(() => []), trimmedQuery)
            if (controller.signal.aborted) return
            if (savedSets.length > 0) {
              setSets(savedSets)
              setSelectedSet(null)
              setSetCards([])
              setSlots([])
              setIsShowingSavedSets(true)
              return
            }
          }
          setError(fetchError instanceof Error ? fetchError.message : "Could not load set coverage.")
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false)
          }
        })
    }, 220)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, selectedSetId])

  useEffect(() => {
    const validDexIds = new Set(slots.map((slot) => slot.dexId))
    const validCardIdsByDexId = new Map(slots.map((slot) => [slot.dexId, new Set(slot.cards.map((card) => card.id))]))

    setSelectedCardIdsByDexId((current) => {
      const next: Record<number, string> = {}

      for (const [dexIdValue, cardId] of Object.entries(current)) {
        const dexId = Number(dexIdValue)
        if (validCardIdsByDexId.get(dexId)?.has(cardId)) {
          next[dexId] = cardId
        }
      }

      return next
    })

    setSelectedDexIds((current) => {
      const next = new Set<number>()
      for (const dexId of current) {
        if (validDexIds.has(dexId)) {
          next.add(dexId)
        }
      }
      return next
    })
  }, [slots])

  const summary = useMemo(() => {
    let owned = 0
    let wanted = 0

    for (const slot of slots) {
      const item = collectionByPokemonId.get(slot.dexId)
      if (item && item.status !== "wishlisted") owned += 1
      if (item?.wanted_cards?.length) wanted += 1
    }

    return {
      total: slots.length,
      owned,
      wanted,
      missing: Math.max(0, slots.length - owned),
    }
  }, [collectionByPokemonId, slots])

  const filterCounts = useMemo(() => {
    const counts: Record<SetSlotFilter, number> = {
      all: slots.length,
      open: 0,
      owned: 0,
      wanted: 0,
      multiple: 0,
    }

    for (const slot of slots) {
      const item = collectionByPokemonId.get(slot.dexId)
      const isOwned = Boolean(item && item.status !== "wishlisted")
      const isWanted = Boolean(item?.wanted_cards?.length)

      if (!isOwned) counts.open += 1
      if (isOwned) counts.owned += 1
      if (isWanted) counts.wanted += 1
      if (slot.cards.length > 1) counts.multiple += 1
    }

    return counts
  }, [collectionByPokemonId, slots])

  const filteredSlots = useMemo(() => {
    const normalizedSearch = slotSearch.trim().toLowerCase()

    return slots.filter((slot) => {
      const item = collectionByPokemonId.get(slot.dexId)
      const isOwned = Boolean(item && item.status !== "wishlisted")
      const isWanted = Boolean(item?.wanted_cards?.length)
      const matchesFilter =
        slotFilter === "all"
        || (slotFilter === "open" && !isOwned)
        || (slotFilter === "owned" && isOwned)
        || (slotFilter === "wanted" && isWanted)
        || (slotFilter === "multiple" && slot.cards.length > 1)

      if (!matchesFilter) return false
      if (!normalizedSearch) return true

      const haystack = [
        slot.pokemonName,
        String(slot.dexId),
        `#${slot.dexId}`,
        ...slot.cards.map((card) => `${card.name} ${card.localId} ${card.rarity ?? ""}`),
      ].join(" ").toLowerCase()

      return haystack.includes(normalizedSearch)
    })
  }, [collectionByPokemonId, slotFilter, slotSearch, slots])

  const selectedBulkCards = useMemo(
    () =>
      filteredSlots
        .filter((slot) => selectedDexIds.has(slot.dexId))
        .map((slot) => ({ slot, card: getSelectedSetCard(slot, selectedCardIdsByDexId) }))
        .filter((entry): entry is { slot: TCGSetDexSlot; card: TCGSetSlotCard } => Boolean(entry.card)),
    [filteredSlots, selectedCardIdsByDexId, selectedDexIds],
  )

  const setShortcutQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    setSelectedSetId(null)
  }

  const toggleSelectedDexId = (dexId: number) => {
    setSelectedDexIds((current) => {
      const next = new Set(current)
      if (next.has(dexId)) {
        next.delete(dexId)
      } else {
        next.add(dexId)
      }
      return next
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card/88 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-card/70">
      <div className="shrink-0 border-b border-border/45 p-4">
        <div data-testid="view-heading" data-collapsed={heading.collapsed ? "" : undefined} className={`flex items-start justify-between gap-3 ${heading.collapsed ? "max-sm:hidden" : ""}`}>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Set Mode</p>
            <h2 className="text-base font-semibold leading-tight tracking-tight sm:truncate sm:text-lg">Which dex slots can this set fill?</h2>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-xs font-semibold tabular-nums text-primary">
            {summary.total} slots
          </div>
        </div>

        <div className={`flex items-center gap-2 rounded-2xl border border-border/55 bg-background/58 px-3 py-2 dark:border-white/10 dark:bg-background/35 ${heading.collapsed ? "max-sm:mt-0 mt-4" : "mt-4"}`}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedSetId(null)
            }}
            placeholder="Search sets, e.g. Pitch Black or me05"
            aria-label="Search sets by name or code"
            enterKeyHint="search"
            className="min-w-0 -my-2 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setSelectedSetId(null)
              }}
              className="-my-1 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear set search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        {isShowingSavedSets ? (
          <p className="mt-2 text-[11px] text-muted-foreground">Offline: showing sets saved on this device.</p>
        ) : null}

        {sets.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {sets.map((set) => {
              const isActive = set.id === selectedSetId || set.id === selectedSet?.id

              return (
                <button
                  key={set.id}
                  type="button"
                  onClick={() => {
                    setSelectedSetId(set.id)
                    setQuery(set.name)
                  }}
                  className={`w-[min(14rem,72vw)] shrink-0 rounded-2xl border px-3 py-2 text-left transition-all ${
                    isActive
                      ? "border-primary/35 bg-primary/12 text-foreground"
                      : "border-border/55 bg-background/45 text-muted-foreground hover:text-foreground dark:border-white/10"
                  }`}
                >
                  <p className="truncate text-sm font-semibold">{set.name}</p>
                  <p className="mt-0.5 truncate text-[11px]">{formatSetMeta(set) || set.id}</p>
                </button>
              )
            })}
          </div>
        ) : null}

        <CardShowPrep
          candidateSets={[selectedSet, ...sets, ...recentSets].filter(
            (set, index, all): set is TCGSetSummary => Boolean(set) && all.findIndex((other) => other?.id === set?.id) === index,
          )}
        />

        {selectedSet ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              ["Dex", summary.total],
              ["Owned", summary.owned],
              ["Missing", summary.missing],
              ["Wanted", summary.wanted],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-2xl border border-border/45 bg-background/45 px-1.5 py-1.5 text-center sm:py-2 dark:border-white/10 sm:px-3">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:tracking-[0.16em]">{label}</p>
                <p className="mt-0.5 text-base font-bold tabular-nums sm:mt-1 sm:text-lg">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {selectedSet ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 rounded-2xl border border-border/45 bg-background/45 px-3 py-2 dark:border-white/10">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={slotSearch}
                onChange={(event) => setSlotSearch(event.target.value)}
                placeholder="Filter slots, names, numbers, rarities..."
                className="min-w-0 -my-2 flex-1 bg-transparent py-2 text-xs outline-none placeholder:text-muted-foreground/70"
              />
              {slotSearch ? (
                <button
                  type="button"
                  onClick={() => setSlotSearch("")}
                  className="-my-1 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear slot filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {SET_SLOT_FILTERS.map((filter) => {
                const isActive = slotFilter === filter.id
                const count = filterCounts[filter.id]

                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setSlotFilter(filter.id)}
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
            {!readOnly && selectedDexIds.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/8 px-3 py-2">
                <span className="mr-auto text-xs font-semibold text-primary">
                  {selectedBulkCards.length} selected
                </span>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  disabled={selectedBulkCards.length === 0}
                  onClick={() => {
                    if (onCollectCards) {
                      void onCollectCards(selectedBulkCards)
                    } else {
                      selectedBulkCards.forEach(({ slot, card }) => void onCollectCard(slot, card))
                    }
                    setSelectedDexIds(new Set())
                  }}
                >
                  Add selected
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px]"
                  disabled={selectedBulkCards.length === 0}
                  onClick={() => {
                    if (onWantCards) {
                      void onWantCards(selectedBulkCards)
                    } else {
                      selectedBulkCards.forEach(({ slot, card }) => void onWantCard(slot, card))
                    }
                    setSelectedDexIds(new Set())
                  }}
                >
                  Want selected
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-2.5 text-[11px]"
                  onClick={() => setSelectedDexIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div data-testid="view-scroller" onScroll={heading.onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: "touch" }}>
        {selectedSet && !isLoading ? <CardHighlights key={selectedSet.id} name={selectedSet.name} cards={highlightCards} prices={setPrices.pricesByCardId} formatPrice={formatPrice} showValues isLoading={setPrices.isLoading} /> : null}
        {error ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/8 p-4 text-sm text-destructive">{error}</div>
        ) : !selectedSet && query.trim().length < 2 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <Sparkles className="mx-auto h-8 w-8 text-primary" />
              <h3 className="mt-3 text-lg font-semibold">Start with a set</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Search a set, pick the right release, then mark the dex slots that set can populate.
              </p>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest sets</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {recentSets.length > 0
                  ? recentSets.map((set) => (
                      <button
                        key={set.id}
                        type="button"
                        onClick={() => {
                          setSelectedSetId(set.id)
                          setQuery(set.name)
                        }}
                        title={formatSetMeta(set) || set.id}
                        className="min-h-9 rounded-full border border-border/55 bg-background/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-background/85 hover:text-foreground dark:border-white/10"
                      >
                        {set.name}
                      </button>
                    ))
                  : SET_SHORTCUTS.map((shortcut) => (
                      <button
                        key={shortcut.label}
                        type="button"
                        onClick={() => setShortcutQuery(shortcut.query)}
                        className="min-h-9 rounded-full border border-border/55 bg-background/55 px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-background/85 hover:text-foreground dark:border-white/10"
                      >
                        {shortcut.label}
                      </button>
                    ))}
              </div>
            </div>
          </div>
        ) : selectedSet && slots.length === 0 && !isLoading ? (
          <div className="rounded-2xl border border-border/45 bg-background/45 p-4 text-sm text-muted-foreground">
            No Pokemon dex slots found for this set. Trainer, energy, and item-only cards are ignored here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {filteredSlots.length === 0 ? (
              <div className="rounded-2xl border border-border/45 bg-background/45 p-4 text-sm text-muted-foreground">
                No slots match the current filters.
              </div>
            ) : null}
            {filteredSlots.map((slot) => {
              const item = collectionByPokemonId.get(slot.dexId)
              const isOwned = Boolean(item && item.status !== "wishlisted")
              const wantedCount = item?.wanted_cards?.length ?? 0
              const primaryCard = getSelectedSetCard(slot, selectedCardIdsByDexId)
              const priceKey = getPriceKey(item)
              const priceLabel = priceKey ? formatPrice(pricesByKey[priceKey]) : null
              const isSelected = selectedDexIds.has(slot.dexId)

              return (
                <div
                  key={slot.dexId}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSlot(slot)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelectSlot(slot)
                    }
                  }}
                  className={`grid w-full ${readOnly ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[auto_auto_minmax(0,1fr)]"} items-center gap-3 rounded-2xl border p-2.5 text-left transition-all hover:border-border/60 hover:bg-background/70 dark:hover:border-white/10 ${
                    isSelected
                      ? "border-primary/35 bg-primary/8"
                      : "border-transparent bg-background/35 dark:bg-background/22"
                  }`}
                >
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleSelectedDexId(slot.dexId)
                      }}
                      aria-pressed={isSelected}
                      aria-label={`${isSelected ? "Deselect" : "Select"} ${slot.pokemonName}`}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/55 bg-background/55 text-muted-foreground hover:bg-background/85 hover:text-foreground dark:border-white/10"
                      }`}
                    >
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </button>
                  ) : null}
                  <div className="trading-card relative flex w-12 shrink-0 items-center justify-center border border-border/45 bg-muted/45">
                    {primaryCard?.image ? (
                      <img src={primaryCard.image} alt={primaryCard.name} className="h-full w-full object-contain" loading="lazy" onError={savedThumbnailOnError(primaryCard.image)} />
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">{formatDexNumber(slot.dexId)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold capitalize">{slot.pokemonName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {formatDexNumber(slot.dexId)} · {slot.cards.length} card{slot.cards.length === 1 ? "" : "s"} in {selectedSet?.name}
                        </p>
                        {primaryCard ? (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {primaryCard.set.officialCardCount ? `${primaryCard.localId}/${primaryCard.set.officialCardCount}` : `#${primaryCard.localId}`} · {primaryCard.rarity ?? "Unknown rarity"}
                          </p>
                        ) : null}
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
                        isOwned
                          ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-600 dark:text-emerald-300"
                          : wantedCount > 0
                            ? "border-amber-400/35 bg-amber-400/12 text-amber-600 dark:text-amber-300"
                            : "border-border/55 bg-muted/35 text-muted-foreground"
                      }`}>
                        {isOwned ? <Check className="h-3 w-3" /> : <Heart className="h-3 w-3" />}
                        {isOwned ? "Owned" : wantedCount > 0 ? "Wanted" : "Open"}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {priceLabel ? (
                        <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {priceLabel}
                        </span>
                      ) : null}
                      {slot.cards.length > 1 ? (
                        <div className="flex w-full gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                          {slot.cards.map((card) => {
                            const isActiveCard = primaryCard?.id === card.id

                            return (
                              <button
                                key={card.id}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setSelectedCardIdsByDexId((current) => ({
                                    ...current,
                                    [slot.dexId]: card.id,
                                  }))
                                }}
                                aria-pressed={isActiveCard}
                                className={`min-w-24 shrink-0 rounded-xl border px-2 py-1 text-left transition-colors ${
                                  isActiveCard
                                    ? "border-primary/45 bg-primary/12 text-foreground"
                                    : "border-border/45 bg-background/45 text-muted-foreground hover:bg-background/75 hover:text-foreground dark:border-white/10"
                                }`}
                              >
                                <p className="truncate text-[10px] font-semibold">
                                  {card.set.officialCardCount ? `${card.localId}/${card.set.officialCardCount}` : `#${card.localId}`}
                                </p>
                                <p className="truncate text-[10px]">
                                  {card.rarity ?? "Unknown"}
                                </p>
                              </button>
                            )
                          })}
                        </div>
                      ) : null}
                      {!readOnly && primaryCard ? (
                        <span className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 rounded-full px-3 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation()
                              onCollectCard(slot, primaryCard)
                            }}
                          >
                            Add
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation()
                              onWantCard(slot, primaryCard)
                            }}
                          >
                            Want
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
