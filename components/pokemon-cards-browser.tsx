"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, Heart, Loader2, Plus, Search as SearchIcon, X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import { useTCGdex, type TCGCard } from "@/hooks/use-tcgdex"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/lib/pricing-region"
import { formatPokemonDisplayName, getOfficialArtworkUrl, formatDexNumber } from "@/lib/pokemon-catalog"
import { PriceRisingBadge } from "@/components/price-rising-badge"
import { CardHighlights } from "@/components/card-highlights"
import {
  buildBrowseEntries,
  type BrowseCardFilter,
  type BrowseCollectionState,
} from "@/lib/pokemon-card-browse"

export interface PokemonCardsBrowserProps {
  pokemon: { id: number; name: string }
  collectionItem?: BrowseCollectionState | null
  /** Card to scroll to and highlight (e.g. the hit picked in global search). */
  highlightCardId?: string | null
  isDesktop: boolean
  readOnly?: boolean
  onClose: () => void
  /** Optional secondary actions; the view itself never enters the edit flow. */
  onWantCard?: (card: TCGCard, isWanted: boolean) => void | Promise<void>
  onAddCard?: (card: TCGCard) => void | Promise<void>
  formatPrice: (price: CardPriceSnapshot | undefined) => string | null
  /** The user's pricing region; printing prices are weighted for it. */
  pricingRegion?: PricingRegion
}

const FILTERS: Array<{ id: BrowseCardFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owned", label: "Owned" },
  { id: "wanted", label: "Wanted" },
]

function thumbnailUrl(image?: string) {
  if (!image) return null
  return image.endsWith("/high.webp") ? image.replace(/\/high\.webp$/, "/low.webp") : image
}

export default function PokemonCardsBrowser({
  pokemon,
  collectionItem,
  highlightCardId,
  isDesktop,
  readOnly = false,
  onClose,
  onWantCard,
  onAddCard,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
}: PokemonCardsBrowserProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const { fetchCardsForPokemon, error: fetchError } = useTCGdex()
  const [cards, setCards] = useState<TCGCard[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState<BrowseCardFilter>("all")
  const [textFilter, setTextFilter] = useState("")
  const [pendingCardId, setPendingCardId] = useState<string | null>(null)
  const displayName = formatPokemonDisplayName(pokemon.name)

  useOverlay(true, onClose, { containerRef: dialogRef })
  const swipe = useSwipeToDismiss(dialogRef, onClose, !isDesktop)

  useEffect(() => {
    let cancelled = false
    void fetchCardsForPokemon(pokemon.id).then((result) => {
      if (cancelled) return
      setCards(result)
      setLoadError(result.length === 0)
    })
    return () => {
      cancelled = true
    }
  }, [fetchCardsForPokemon, pokemon.id])

  const allEntries = useMemo(() => buildBrowseEntries(cards ?? [], collectionItem), [cards, collectionItem])
  const counts = useMemo(() => ({
    all: allEntries.length,
    owned: allEntries.filter((entry) => entry.owned).length,
    wanted: allEntries.filter((entry) => entry.wanted).length,
  }), [allEntries])
  const visibleEntries = useMemo(() => {
    const byState = allEntries.filter((entry) => filter === "all" || (filter === "owned" ? entry.owned : entry.wanted))
    const needle = textFilter.trim().toLowerCase()
    if (!needle) return byState
    return byState.filter((entry) =>
      [entry.card.name, entry.card.set.name, entry.card.set.id, entry.numberLabel, entry.card.rarity ?? "", ...entry.variantLabels]
        .some((value) => value.toLowerCase().includes(needle)))
  }, [allEntries, filter, textFilter])

  const priceLookups = useMemo(
    () => allEntries.map((entry) => ({ cardId: entry.card.id, language: entry.card.language ?? "en" })),
    [allEntries],
  )
  const { pricesByCardId } = useRegionalCardPrices(priceLookups, priceLookups.length > 0, pricingRegion)
  const highlightCards = useMemo(() => allEntries.map((entry) => ({
    id: entry.card.id, language: entry.card.language, name: entry.card.name,
    numberLabel: entry.numberLabel, setName: entry.card.set.name, image: entry.card.image, rarity: entry.card.rarity,
  })), [allEntries])
  const showBreakout = filter === "all" && !textFilter.trim()

  const scrollToCard = useCallback((cardId: string) => {
    const target = bodyRef.current?.querySelector<HTMLElement>(`li[data-card-id="${CSS.escape(cardId)}"]`)
    target?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [])

  useEffect(() => {
    if (!highlightCardId || !cards) return
    const frame = window.requestAnimationFrame(() => {
      const target = bodyRef.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(highlightCardId)}"]`)
      target?.scrollIntoView({ block: "center" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [cards, highlightCardId])

  const runAction = useCallback(async (cardId: string, action: () => void | Promise<void>) => {
    setPendingCardId(cardId)
    try {
      await action()
    } finally {
      setPendingCardId(null)
    }
  }, [])

  const showActions = !readOnly && Boolean(onWantCard || onAddCard)

  const content = (
    <>
      <div data-overlay-backdrop aria-hidden="true" className="fixed inset-0 z-[43] bg-black/55" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`All ${displayName} cards`}
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
        <div
          data-sheet-grabber
          className="shrink-0 border-b border-border/50 px-4 pb-3 pt-2"
          {...(isDesktop ? {} : swipe)}
        >
          {!isDesktop ? <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" /> : null}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-muted to-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={getOfficialArtworkUrl(pokemon.id)} alt="" className="h-full w-full object-contain p-1" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{formatDexNumber(pokemon.id)}</p>
              <h2 className="truncate text-lg font-bold leading-tight">{displayName} cards</h2>
              <p className="text-xs text-muted-foreground">
                {cards === null ? "Loading cards…" : fetchError ? "Card catalogue unavailable" : `${counts.all} card${counts.all === 1 ? "" : "s"} · ${counts.owned} owned · ${counts.wanted} wanted`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close all cards"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/70 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" data-no-swipe>
            <div className="flex shrink-0 gap-1.5" role="group" aria-label="Filter cards">
              {FILTERS.map((option) => (
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
            <label className="relative min-w-[10rem] flex-1">
              <span className="sr-only">Filter by set, number or variant</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={textFilter}
                onChange={(event) => setTextFilter(event.target.value)}
                data-overlay-escape="clear"
                placeholder="Set, number…"
                className="h-9 w-full min-w-0 rounded-full border border-border/60 bg-background/70 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
              />
            </label>
          </div>
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-3">
          {cards === null ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading cards…
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {loadError
                ? fetchError ? "Could not load cards. Offline, only previously opened Pokémon card lists are available." : "No mirrored cards found for this Pokémon yet."
                : filter === "owned"
                  ? "You don't own any of these cards yet."
                  : filter === "wanted"
                    ? "No wanted cards yet."
                    : "No cards match that filter."}
            </div>
          ) : (
            <>
            {showBreakout ? <CardHighlights name={displayName} cards={highlightCards} prices={pricesByCardId} formatPrice={formatPrice} onSelectCard={scrollToCard} /> : null}
            <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4" aria-label={`${displayName} cards`}>
              {visibleEntries.map((entry) => {
                const { card } = entry
                const priceSnapshot = pricesByCardId[getCardPriceKey(card.id, card.language ?? "en")]
                const price = formatPrice(priceSnapshot)
                const image = thumbnailUrl(card.image)
                const isHighlighted = card.id === highlightCardId
                const isPending = pendingCardId === card.id
                return (
                  <li
                    key={card.id}
                    data-card-id={card.id}
                    aria-label={`${card.name} ${entry.numberLabel} ${card.set.name}${entry.owned ? ", owned" : ""}${entry.wanted ? ", wanted" : ""}`}
                    className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-background/60 ${
                      isHighlighted
                        ? "border-primary/70 ring-2 ring-primary/40"
                        : entry.owned
                          ? "border-emerald-400/45"
                          : entry.wanted
                            ? "border-amber-400/45"
                            : "border-border/50"
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
                    <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                      <p className="truncate text-xs font-semibold" title={card.set.name}>{card.set.name}</p>
                      <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">{entry.numberLabel}</span>
                        {price ? <span className="truncate font-semibold text-foreground">{price.split(" (")[0]}</span> : null}
                      </div>
                      {entry.variantLabels.length > 0 || card.rarity ? (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {[card.rarity, ...entry.variantLabels].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {showActions ? (
                        <div className="mt-auto grid grid-cols-2 gap-1 pt-1">
                          {onWantCard ? (
                            <button
                              type="button"
                              disabled={isPending}
                              aria-pressed={entry.wanted}
                              aria-label={`${entry.wanted ? "Unwant" : "Want"} ${card.name} ${entry.numberLabel}`}
                              onClick={() => void runAction(card.id, () => onWantCard(card, entry.wanted))}
                              className={`flex h-9 items-center justify-center gap-1 rounded-xl border text-[11px] font-bold disabled:opacity-50 ${
                                entry.wanted
                                  ? "border-amber-400/50 bg-amber-500/15 text-amber-600 dark:text-amber-300"
                                  : "border-border/55 bg-muted/40 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              <Heart className={`h-3.5 w-3.5 ${entry.wanted ? "fill-current" : ""}`} />
                              Want
                            </button>
                          ) : null}
                          {onAddCard ? (
                            <button
                              type="button"
                              disabled={isPending || entry.owned}
                              aria-label={entry.owned ? `${card.name} ${entry.numberLabel} is in your binder` : `Add ${card.name} ${entry.numberLabel} to binder`}
                              onClick={() => void runAction(card.id, () => onAddCard(card))}
                              className="flex h-9 items-center justify-center gap-1 rounded-xl border border-emerald-400/35 bg-emerald-500/10 text-[11px] font-bold text-emerald-600 disabled:opacity-50 dark:text-emerald-300"
                            >
                              {entry.owned ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                              {entry.owned ? "Owned" : "Add"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
            </>
          )}
        </div>
      </div>
    </>
  )

  if (typeof document === "undefined") return null
  return createPortal(content, document.body)
}
