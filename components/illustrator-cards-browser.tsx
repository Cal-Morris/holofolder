"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Heart, Loader2, Palette, Search as SearchIcon, X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { PriceRisingBadge } from "@/components/price-rising-badge"
import type { PricingRegion } from "@/lib/pricing-region"
import { getProxiedThumbnailUrl } from "@/lib/card-show-prep"
import type { BrowseCard } from "@/lib/pokemon-card-browse"
import { loadIllustratorCards } from "@/lib/illustrator-client"
import {
  buildIllustratorEntries,
  countIllustratorEntries,
  ILLUSTRATOR_CARD_FILTERS,
  ILLUSTRATOR_CARD_SORTS,
  type IllustratorCard,
  type IllustratorCardFilter,
  type IllustratorCardSort,
  type IllustratorCollectionItem,
} from "@/lib/illustrators"

export interface IllustratorCardsBrowserProps {
  illustrator: string
  collection: readonly IllustratorCollectionItem[]
  isDesktop: boolean
  /** The user's pricing region; prices are re-weighted for it before sorting and display. */
  pricingRegion: PricingRegion
  /** Formats a headline price in the user's display currency. */
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  onClose: () => void
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; cards: IllustratorCard[]; fromDevice: boolean }
  | { status: "unavailable" }

/** Read-only view of every card by one illustrator, across all sets. Never enters the edit flow. */
export default function IllustratorCardsBrowser({ illustrator, collection, isDesktop, pricingRegion, formatPrice, onClose }: IllustratorCardsBrowserProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [filter, setFilter] = useState<IllustratorCardFilter>("all")
  const [sort, setSort] = useState<IllustratorCardSort>("newest")
  const [textFilter, setTextFilter] = useState("")

  useOverlay(true, onClose, { containerRef: dialogRef })
  const swipe = useSwipeToDismiss(dialogRef, onClose, !isDesktop)

  useEffect(() => {
    let cancelled = false
    void loadIllustratorCards(illustrator).then((result) => {
      if (cancelled) return
      setState(result.data
        ? { status: "ready", cards: result.data.cards, fromDevice: result.source === "device" }
        : { status: "unavailable" })
    })
    return () => {
      cancelled = true
    }
  }, [illustrator])

  const cards = state.status === "ready" ? state.cards : null
  const allEntries = useMemo(() => buildIllustratorEntries(cards ?? [], collection), [cards, collection])
  const counts = useMemo(() => countIllustratorEntries(allEntries), [allEntries])
  // One batched lookup for every card (served from the on-device cache first, so it also works offline).
  const priceLookups = useMemo(
    () => (cards ?? []).map((card) => ({ cardId: card.id, language: card.language ?? "en" })),
    [cards],
  )
  const { pricesByCardId, isLoading: isLoadingPrices } = useRegionalCardPrices(priceLookups, priceLookups.length > 0, pricingRegion)
  const priceOf = useCallback(
    (card: BrowseCard) => pricesByCardId[getCardPriceKey(card.id, card.language ?? "en")]?.gbpAmount ?? null,
    [pricesByCardId],
  )
  const visibleEntries = useMemo(
    () => buildIllustratorEntries(cards ?? [], collection, { filter, sort, text: textFilter, priceOf }),
    [cards, collection, filter, sort, textFilter, priceOf],
  )
  const isPriceSort = sort === "price-desc" || sort === "price-asc"
  const setCount = useMemo(() => new Set((cards ?? []).map((card) => card.set.id)).size, [cards])

  const content = (
    <>
      <div data-overlay-backdrop aria-hidden="true" className="fixed inset-0 z-[43] bg-black/55" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Cards illustrated by ${illustrator}`}
        className="fixed z-[44] flex flex-col overflow-hidden rounded-[1.6rem] border border-border/70 bg-card shadow-[0_28px_80px_-30px_rgba(15,23,42,0.6)] outline-none dark:border-border/50 dark:bg-background"
        style={isDesktop
          ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(calc(100vw - 2rem), 52rem)", maxHeight: "min(85vh, 56rem)" }
          : {
              left: "0.5rem",
              right: "0.5rem",
              // Sits above the bottom dock (which stays usable) and never under the status bar.
              bottom: "calc(var(--dock-clearance) + 0.375rem)",
              height: "calc(100dvh - env(safe-area-inset-top) - var(--dock-clearance) - 0.375rem - 0.5rem)",
            }}
      >
        <div data-sheet-grabber className="shrink-0 border-b border-border/50 px-4 pb-3 pt-2" {...(isDesktop ? {} : swipe)}>
          {!isDesktop ? <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" /> : null}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-muted to-muted/30 text-muted-foreground">
              <Palette className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Illustrator</p>
              <h2 className="truncate text-lg font-bold leading-tight">{illustrator}</h2>
              <p className="text-xs text-muted-foreground" data-testid="illustrator-summary">
                {state.status === "loading"
                  ? "Loading cards…"
                  : state.status === "unavailable"
                    ? "Card list unavailable"
                    : `${counts.all} card${counts.all === 1 ? "" : "s"} · ${setCount} set${setCount === 1 ? "" : "s"} · ${counts.owned} owned · ${counts.wanted} wanted`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close illustrator cards"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-no-swipe>
            <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Filter cards">
              {ILLUSTRATOR_CARD_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className={`h-9 rounded-full border px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    filter === option.id
                      ? "border-primary/35 bg-primary/12 text-primary"
                      : "border-border/50 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                  <span className="ml-1 opacity-70">{counts[option.id]}</span>
                </button>
              ))}
            </div>
            <label className="relative min-w-[8rem] flex-1">
              <span className="sr-only">Filter by card, set or number</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                data-overlay-escape="clear"
                placeholder="Card, set…"
                className="h-9 w-full min-w-0 rounded-full border border-border/60 bg-background/70 pl-8 pr-3 text-base md:text-sm outline-none focus:border-primary/50"
              />
            </label>
            <label className="shrink-0">
              <span className="sr-only">Sort cards</span>
              <select
                aria-label="Sort cards"
                value={sort}
                onChange={(event) => setSort(event.target.value as IllustratorCardSort)}
                className="h-9 rounded-full border border-border/60 bg-background/70 px-3 text-base md:text-xs font-semibold outline-none focus:border-primary/50"
              >
                {ILLUSTRATOR_CARD_SORTS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3">
          {isPriceSort && state.status === "ready" && visibleEntries.length > 0 ? (
            <p className="mb-2 text-[11px] text-muted-foreground" data-testid="illustrator-price-sort-note">
              {isLoadingPrices ? "Loading prices…" : "Cards without a price are listed last."}
            </p>
          ) : null}
          {state.status === "ready" && state.fromDevice ? (
            <p className="mb-2 rounded-xl border border-border/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Offline: showing the copy saved on this device.</p>
          ) : null}
          {state.status === "loading" ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading cards…
            </div>
          ) : state.status === "unavailable" ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Could not load this illustrator&apos;s cards. Offline, only illustrators you opened before are available.
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {counts.all === 0
                ? "No mirrored cards found for this illustrator yet."
                : filter === "owned"
                  ? "You don't own any of these cards yet."
                  : filter === "wanted"
                    ? "None of these cards are on your wanted list."
                    : "No cards match that filter."}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-label={`Cards by ${illustrator}`}>
              {visibleEntries.map((entry) => {
                const { card } = entry
                const image = getProxiedThumbnailUrl(card.image)
                const priceSnapshot = pricesByCardId[getCardPriceKey(card.id, card.language ?? "en")]
                const price = formatPrice(priceSnapshot)?.split(" (")[0] ?? null
                return (
                  <li
                    key={card.id}
                    data-card-id={card.id}
                    aria-label={`${card.name} ${entry.numberLabel} ${card.set.name}${entry.owned ? ", owned" : ""}${entry.wanted ? ", wanted" : ""}`}
                    data-price={price ?? undefined}
                    className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-background/60 ${
                      entry.owned ? "border-emerald-400/45" : entry.wanted ? "border-amber-400/45" : "border-border/50"
                    }`}
                  >
                    <div className="trading-card relative w-full bg-muted/40">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image} alt={`${card.name} – ${card.set.name} ${entry.numberLabel}`} loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">No image</div>
                      )}
                      <div className="absolute left-1.5 top-1.5 flex flex-col gap-1">
                        {entry.owned ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white shadow">
                            <Check className="h-3 w-3" /> Owned
                          </span>
                        ) : null}
                        {entry.wanted ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white shadow">
                            <Heart className="h-3 w-3 fill-current" /> Wanted
                          </span>
                        ) : null}
                      </div>
                      <PriceRisingBadge price={priceSnapshot} className="absolute right-1.5 top-1.5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
                      <p className="truncate text-xs font-semibold" title={card.name}>{card.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground" title={card.set.name}>{card.set.name}</p>
                      <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                        <span className="tabular-nums">{entry.numberLabel}</span>
                        {card.set.releaseDate ? <span className="tabular-nums">{card.set.releaseDate.slice(0, 4)}</span> : null}
                      </div>
                      <p className="truncate text-xs font-bold tabular-nums" data-testid="illustrator-card-price">
                        {price
                          ? <span className="text-foreground">{price}</span>
                          : <span className="font-medium text-muted-foreground">{isLoadingPrices ? "Pricing…" : "No price"}</span>}
                      </p>
                      {card.rarity || entry.variantLabels.length > 0 ? (
                        <p className="truncate text-[10px] text-muted-foreground">{[card.rarity, ...entry.variantLabels].filter(Boolean).join(" · ")}</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  )

  if (typeof document === "undefined") return null
  return createPortal(content, document.body)
}
