"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Heart, Loader2, Search, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { CollectedPokemon } from "@/hooks/use-collection"
import type { TCGSetDexSlot, TCGSetSlotCard, TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"

interface SetPopulationViewProps {
  collectionByPokemonId: Map<number, CollectedPokemon>
  pricesByKey: Record<string, CardPriceSnapshot>
  getPriceKey: (item?: { card_id?: string | null; card_language?: string | null } | null) => string | null
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  onSelectSlot: (slot: TCGSetDexSlot) => void
  onCollectCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void
  onWantCard: (slot: TCGSetDexSlot, card: TCGSetSlotCard) => void
  readOnly: boolean
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

export default function SetPopulationView({
  collectionByPokemonId,
  pricesByKey,
  getPriceKey,
  formatPrice,
  onSelectSlot,
  onCollectCard,
  onWantCard,
  readOnly,
}: SetPopulationViewProps) {
  const [query, setQuery] = useState("")
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [sets, setSets] = useState<TCGSetSummary[]>([])
  const [selectedSet, setSelectedSet] = useState<TCGSetSummary | null>(null)
  const [slots, setSlots] = useState<TCGSetDexSlot[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmedQuery = query.trim()

    if (trimmedQuery.length < 2 && !selectedSetId) {
      setSets([])
      setSelectedSet(null)
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

      void fetch(`/api/tcg-set-slots?${params.toString()}`, {
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
          setSets(payload.sets)
          setSelectedSet(payload.selectedSet)
          setSlots(payload.slots)
        })
        .catch((fetchError) => {
          if (controller.signal.aborted) return
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

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.6rem] border border-border/60 bg-card/88 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-card/70">
      <div className="shrink-0 border-b border-border/45 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Set Mode</p>
            <h2 className="truncate text-lg font-semibold tracking-tight">Which dex slots can this set fill?</h2>
          </div>
          <div className="rounded-full border border-primary/20 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary">
            {summary.total} slots
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-border/55 bg-background/58 px-3 py-2 dark:border-white/10 dark:bg-background/35">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedSetId(null)
            }}
            placeholder="Search set name or code, e.g. 151, surging, sv3..."
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                setSelectedSetId(null)
              }}
              className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Clear set search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

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
                  className={`w-56 shrink-0 rounded-2xl border px-3 py-2 text-left transition-all ${
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

        {selectedSet ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              ["Dex", summary.total],
              ["Owned", summary.owned],
              ["Missing", summary.missing],
              ["Wanted", summary.wanted],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-border/45 bg-background/45 px-3 py-2 text-center dark:border-white/10">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" style={{ WebkitOverflowScrolling: "touch" }}>
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
            </div>
          </div>
        ) : selectedSet && slots.length === 0 && !isLoading ? (
          <div className="rounded-2xl border border-border/45 bg-background/45 p-4 text-sm text-muted-foreground">
            No Pokemon dex slots found for this set. Trainer, energy, and item-only cards are ignored here.
          </div>
        ) : (
          <div className="space-y-1.5">
            {slots.map((slot) => {
              const item = collectionByPokemonId.get(slot.dexId)
              const isOwned = Boolean(item && item.status !== "wishlisted")
              const wantedCount = item?.wanted_cards?.length ?? 0
              const primaryCard = slot.cards[0]
              const priceKey = getPriceKey(item)
              const priceLabel = priceKey ? formatPrice(pricesByKey[priceKey]) : null

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
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-transparent bg-background/35 p-2.5 text-left transition-all hover:border-border/60 hover:bg-background/70 dark:bg-background/22 dark:hover:border-white/10"
                >
                  <div className="relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/45 bg-muted/45">
                    {primaryCard?.image ? (
                      <img src={primaryCard.image} alt={primaryCard.name} className="h-full w-full object-contain" loading="lazy" />
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
                            {primaryCard.localId}/{primaryCard.set.officialCardCount ?? "?"} · {primaryCard.rarity ?? "Unknown rarity"}
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
                      {!readOnly && primaryCard ? (
                        <span className="ml-auto flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 rounded-full px-2.5 text-[11px]"
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
                            className="h-7 rounded-full px-2.5 text-[11px]"
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
