"use client"

// Quick mode: a full-screen, one-handed launcher. One search field (pinned at the bottom, in thumb reach) finds
// app destinations, Pokémon, cards (offline: the cards on this device) and illustrators. See
// lib/quick-mode.ts for the pure helpers and docs in AGENTS.md (Quick mode).
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import dynamic from "next/dynamic"
import {
  BarChart3,
  Camera,
  Grid3X3,
  Heart,
  History,
  Layers,
  Layers3,
  ListChecks,
  Loader2,
  Palette,
  Search,
  Settings,
  Sparkles,
  Ticket,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react"
import { useOverlay } from "@/hooks/use-overlay"
import { useCardSearch, useIllustratorSearch } from "@/hooks/use-card-search"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { getCardPriceKey, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import { toCardImageSrc } from "@/lib/card-image-url"
import { POKEMON_CATALOG, formatPokemonDisplayName, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { formatCardNumber, type SearchCardResult } from "@/lib/pokemon-card-browse"
import { searchPokemonItems } from "@/lib/pokemon-search-state"
import { addRecentCard, readRecentCards, toRecentCard, writeRecentCards } from "@/lib/recent-cards"
import { DEFAULT_PRICING_REGION, type PricingRegion } from "@/lib/pricing-region"
import {
  addRecentQuickSearch,
  matchQuickDestinations,
  readRecentQuickSearches,
  writeRecentQuickSearches,
  type QuickDestination,
  type QuickDestinationId,
} from "@/lib/quick-mode"
import { formatMoney, type DisplayFxRates } from "@/lib/regional-price"
import type { DisplayCurrency } from "@/lib/pricing-region"
import type { CardFinish } from "@/lib/domain/cards"
import type { QuickBundleEntry, QuickCardAction, QuickCardState } from "@/components/quick-card-check"
import type { HuntSourceItem } from "@/lib/show-hunt"
// Bundled with Quick mode (not split) so the finder never needs a network round trip at a show.
import ShowHunt, { PokemonSprite } from "@/components/show-hunt"
import ShowPokemonCards from "@/components/show-pokemon-cards"

const QuickCardCheck = dynamic(() => import("@/components/quick-card-check"), { ssr: false })
const QuickBundle = dynamic(() => import("@/components/quick-bundle"), { ssr: false })

const BUNDLE_KEY = "binderdex:show-bundle:v1"

function readBundle(): QuickBundleEntry[] {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(BUNDLE_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.key === "string" && entry.card) : []
  } catch {
    return []
  }
}

/** Show mode's deal checker: tapping a card opens its check instead of the card browser. */
export interface QuickCardCheckOptions {
  currency: DisplayCurrency
  fxRates?: DisplayFxRates | null
  readOnly?: boolean
  getCardState: (card: SearchCardResult, pokemon: { id: number; name: string }) => QuickCardState
  onAction: (action: QuickCardAction, card: SearchCardResult, pokemon: { id: number; name: string }, finish: CardFinish) => Promise<(() => Promise<void>) | null>
  /** The collection on this device: Show mode's Hunting list and per-Pokémon view are built from it. */
  huntItems?: readonly HuntSourceItem[]
}

const DESTINATION_ICONS: Record<QuickDestinationId, LucideIcon> = {
  binder: Grid3X3,
  list: ListChecks,
  wanted: Heart,
  sets: Layers3,
  pokemon: Sparkles,
  analytics: BarChart3,
  settings: Settings,
  scan: Camera,
  "show-mode": Ticket,
}

export interface QuickModePokemonState {
  label: string
  toneClass: string
}

export interface QuickModeProps {
  onClose: () => void
  onNavigate: (destination: QuickDestinationId) => void
  onSelectPokemon: (pokemon: PokemonSummary) => void
  onSelectCard: (card: SearchCardResult, pokemon: { id: number; name: string }) => void
  onBrowseIllustrator: (name: string) => void
  getOfflineCards: () => Promise<SearchCardResult[]>
  /** Show mode's destination reads "Exit Show mode" while it's on. */
  showModeOn?: boolean
  getPokemonState?: (pokemonId: number) => QuickModePokemonState | null
  formatPrice?: (price: CardPriceSnapshot | undefined) => string | null
  pricingRegion?: PricingRegion
  isOnline: boolean
  /** Destinations hidden in this context (e.g. scan while read-only). */
  hiddenDestinations?: readonly QuickDestinationId[]
  /** Set (in Show mode) to check prices: a picked card opens its deal check. */
  cardCheck?: QuickCardCheckOptions
}

function cardThumbnail(image?: string) {
  if (!image) return null
  return toCardImageSrc(image.replace(/\/high\.webp$/, "/low.webp"))
}

const sectionTitle = "px-1 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
const rowClass = "flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none active:bg-muted"

export default function QuickMode({
  onClose,
  onNavigate,
  onSelectPokemon,
  onSelectCard,
  onBrowseIllustrator,
  getOfflineCards,
  getPokemonState,
  formatPrice,
  pricingRegion = DEFAULT_PRICING_REGION,
  isOnline,
  hiddenDestinations = [],
  showModeOn = false,
  cardCheck,
}: QuickModeProps) {
  const [checking, setChecking] = useState<{ card: SearchCardResult; pokemon: { id: number; name: string }; finish?: CardFinish | null } | null>(null)
  // Show mode: the Pokémon whose cards are listed (opened from a Pokémon result or a Hunting group).
  const [browsing, setBrowsing] = useState<{ id: number; name: string } | null>(null)
  const huntItems = cardCheck?.huntItems
  const [isBundleOpen, setIsBundleOpen] = useState(false)
  const [bundle, setBundle] = useState<QuickBundleEntry[]>(() => (typeof window === "undefined" ? [] : readBundle()))
  const updateBundle = useCallback((next: QuickBundleEntry[]) => {
    setBundle(next)
    try {
      window.sessionStorage.setItem(BUNDLE_KEY, JSON.stringify(next))
    } catch {
      // The bundle still works for this visit.
    }
  }, [])
  const [query, setQuery] = useState("")
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentQuickSearches(typeof window === "undefined" ? undefined : window.localStorage))
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useOverlay(true, onClose, { containerRef: dialogRef, autoFocus: false })

  // In Show mode the Hunting list opens unobscured; the keyboard comes up when the search field is tapped.
  const focusOnOpen = !cardCheck
  useEffect(() => {
    if (!focusOnOpen) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [focusOnOpen])

  const trimmed = query.trim()
  const destinations = useMemo(() => {
    const visible = (list: readonly QuickDestination[]) =>
      list
        .filter((entry) => !hiddenDestinations.includes(entry.id))
        .map((entry) => (entry.id === "show-mode" && showModeOn ? { ...entry, label: "Exit Show mode", hint: "Show mode is on" } : entry))
    return trimmed ? visible(matchQuickDestinations(trimmed)).slice(0, 3) : visible(matchQuickDestinations(""))
  }, [hiddenDestinations, showModeOn, trimmed])
  const pokemonResults = useMemo(() => (trimmed ? searchPokemonItems(trimmed, POKEMON_CATALOG, cardCheck ? 6 : 5) : []), [cardCheck, trimmed])
  const cardSearch = useCardSearch(query, true, getOfflineCards)
  const cardResults = useMemo(
    () => {
      const seen = new Set<string>()
      return cardSearch.groups
        .flatMap((group) => group.cards.map((card) => ({ card, pokemon: { id: group.dexId, name: group.name } })))
        .filter(({ card }) => {
          const key = `${card.id}:${card.language ?? "en"}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 10)
    },
    [cardSearch.groups],
  )
  const priceLookups = useMemo(
    () => (formatPrice ? cardResults.map(({ card }) => ({ cardId: card.id, language: card.language ?? "en" })) : []),
    [cardResults, formatPrice],
  )
  const { pricesByCardId } = useRegionalCardPrices(priceLookups, priceLookups.length > 0, pricingRegion)
  const illustrators = useIllustratorSearch(query, true).slice(0, 3)

  // Write storage directly (not inside a state updater): picking a result usually unmounts Quick mode
  // in the same tick, and a queued updater on an unmounting component never runs.
  const remember = useCallback(() => {
    if (!trimmed) return
    const next = addRecentQuickSearch(recentSearches, trimmed)
    writeRecentQuickSearches(window.localStorage, next)
    setRecentSearches(next)
  }, [recentSearches, trimmed])

  const pickCard = useCallback((card: SearchCardResult, pokemon: { id: number; name: string }, finish?: CardFinish | null) => {
    remember()
    writeRecentCards(window.localStorage, addRecentCard(readRecentCards(window.localStorage), toRecentCard(card, pokemon)))
    if (cardCheck) setChecking({ card, pokemon, finish })
    else onSelectCard(card, pokemon)
  }, [cardCheck, onSelectCard, remember])

  const go = useCallback((destination: QuickDestinationId) => {
    remember()
    onNavigate(destination)
  }, [onNavigate, remember])

  const pickPokemon = useCallback((pokemon: { id: number; name: string }) => {
    const summary = getPokemonSummary(pokemon.id)
    if (!summary) return
    remember()
    if (cardCheck) {
      // Show mode stays in the finder: list this Pokémon's cards, wanted first.
      setBrowsing({ id: summary.id, name: summary.name })
      setQuery("")
      inputRef.current?.blur()
    } else onSelectPokemon(summary)
  }, [cardCheck, onSelectPokemon, remember])
  const wantedCount = useCallback(
    (pokemonId: number) => huntItems?.find((item) => item.pokemon_id === pokemonId)?.wanted_cards?.length ?? 0,
    [huntItems],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !trimmed) return
    event.preventDefault()
    if (destinations[0] && pokemonResults.length === 0 && cardResults.length === 0) go(destinations[0].id)
    else if (pokemonResults[0]) pickPokemon(pokemonResults[0])
    else if (cardResults[0]) pickCard(cardResults[0].card, cardResults[0].pokemon)
    else if (destinations[0]) go(destinations[0].id)
  }

  const nothingFound = Boolean(trimmed) && !cardSearch.loading && destinations.length === 0 && pokemonResults.length === 0 && cardResults.length === 0 && illustrators.length === 0

  return (
    <div className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm" data-overlay-backdrop onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick mode"
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-[100dvh] w-full max-w-xl flex-col bg-background pt-[env(safe-area-inset-top)] sm:border-x sm:border-border/60"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold leading-tight">{cardCheck ? "Show mode" : "Quick mode"}</h2>
            <p className="truncate text-xs text-muted-foreground">{cardCheck ? "Find the cards you’re hunting, then check the price." : "Search anything, or jump straight there."}</p>
          </div>
          {!isOnline && (
            <span role="status" className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5" aria-hidden /> Offline
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick mode"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/70 text-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {cardCheck && checking ? (
          <QuickCardCheck
            key={`${checking.card.id}:${checking.card.language ?? "en"}`}
            card={checking.card}
            pokemon={checking.pokemon}
            state={cardCheck.getCardState(checking.card, checking.pokemon)}
            currency={cardCheck.currency}
            fxRates={cardCheck.fxRates}
            pricingRegion={pricingRegion}
            isOnline={isOnline}
            readOnly={cardCheck.readOnly}
            initialFinish={checking.finish}
            onBack={() => {
              setChecking(null)
              if (!browsing && trimmed) window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
            }}
            onOpenDetails={() => onSelectCard(checking.card, checking.pokemon)}
            onAction={(action, finish) => cardCheck.onAction(action, checking.card, checking.pokemon, finish)}
            isInBundle={(key) => bundle.some((entry) => entry.key === key)}
            onAddToBundle={(entry) => updateBundle([...bundle.filter((item) => item.key !== entry.key), entry])}
          />
        ) : cardCheck && isBundleOpen ? (
          <QuickBundle
            entries={bundle}
            currency={cardCheck.currency}
            readOnly={cardCheck.readOnly}
            onBack={() => setIsBundleOpen(false)}
            onRemove={(key) => updateBundle(bundle.filter((entry) => entry.key !== key))}
            onClear={() => updateBundle([])}
            onAction={(action, entry) => cardCheck.onAction(action, entry.card, entry.pokemon, entry.finish)}
          />
        ) : (
        <>
        {cardCheck && !trimmed && browsing ? (
          <ShowPokemonCards
            key={browsing.id}
            pokemon={browsing}
            wantedCards={huntItems?.find((item) => item.pokemon_id === browsing.id)?.wanted_cards ?? []}
            getCardState={cardCheck.getCardState}
            getOfflineCards={getOfflineCards}
            currency={cardCheck.currency}
            fxRates={cardCheck.fxRates}
            pricingRegion={pricingRegion}
            isOnline={isOnline}
            onBack={() => setBrowsing(null)}
            onPickCard={(card, finish) => pickCard(card, browsing, finish)}
          />
        ) : cardCheck && !trimmed ? (
          <ShowHunt
            items={huntItems ?? []}
            currency={cardCheck.currency}
            fxRates={cardCheck.fxRates}
            pricingRegion={pricingRegion}
            isOnline={isOnline}
            onPickCard={(card, pokemon, finish) => pickCard(card, pokemon, finish)}
            onPickPokemon={pickPokemon}
          />
        ) : (
        /* Results grow upwards from the search field so the best match sits nearest the thumb. */
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-2 pb-2" data-testid="quick-results">
          <div>
            {!trimmed && recentSearches.length > 0 && (
              <section aria-label="Recent searches">
                <h3 className={sectionTitle}>Recent</h3>
                <div className="flex flex-wrap gap-2 px-1">
                  {recentSearches.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => {
                        setQuery(entry)
                        inputRef.current?.focus({ preventScroll: true })
                      }}
                      className="flex h-11 items-center gap-1.5 rounded-full border border-border/70 bg-card px-4 text-sm font-medium"
                    >
                      <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {entry}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {illustrators.length > 0 && (
              <section aria-label="Illustrators">
                <h3 className={sectionTitle}>Illustrators</h3>
                {illustrators.map((illustrator) => (
                  <button
                    key={illustrator.name}
                    type="button"
                    className={rowClass}
                    onClick={() => {
                      remember()
                      onBrowseIllustrator(illustrator.name)
                    }}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-500"><Palette className="h-5 w-5" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{illustrator.name}</span>
                      <span className="block text-xs text-muted-foreground">{illustrator.cardCount} cards</span>
                    </span>
                  </button>
                ))}
              </section>
            )}

            {(cardResults.length > 0 || (trimmed.length >= 2 && cardSearch.loading)) && (
              <section aria-label="Cards">
                <h3 className={sectionTitle}>
                  Cards{cardSearch.offline ? " · on this device" : ""}
                  {cardSearch.loading && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" aria-label="Searching cards" />}
                </h3>
                {cardResults.map(({ card, pokemon }) => {
                  const thumb = cardThumbnail(card.image)
                  const priceLabel = formatPrice?.(pricesByCardId[getCardPriceKey(card.id, card.language ?? "en")]) ?? null
                  const state = getPokemonState?.(pokemon.id) ?? null
                  return (
                    <button
                      key={`${card.id}:${card.language ?? "en"}`}
                      type="button"
                      className={rowClass}
                      aria-label={`${card.name}, ${card.set.name} ${formatCardNumber(card)}${priceLabel ? `, ${priceLabel}` : ""}`}
                      onClick={() => pickCard(card, pokemon)}
                    >
                      <span className="trading-card relative w-10 shrink-0 overflow-hidden bg-muted/50">
                        {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
                        {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{card.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{card.set.name} · {formatCardNumber(card)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        {priceLabel && <span className="text-sm font-bold tabular-nums">{priceLabel}</span>}
                        {state && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${state.toneClass}`}>{state.label}</span>}
                      </span>
                    </button>
                  )
                })}
              </section>
            )}

            {!cardCheck && pokemonResults.length > 0 && (
              <section aria-label="Pokémon">
                <h3 className={sectionTitle}>Pokémon</h3>
                {pokemonResults.map((pokemon) => {
                  const state = getPokemonState?.(pokemon.id) ?? null
                  return (
                    <button key={pokemon.id} type="button" className={rowClass} onClick={() => pickPokemon(pokemon)}>
                      <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">#{String(pokemon.id).padStart(4, "0")}</span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{formatPokemonDisplayName(pokemon.name)}</span>
                      {state && <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${state.toneClass}`}>{state.label}</span>}
                    </button>
                  )
                })}
              </section>
            )}

            {destinations.length > 0 && (
              <section aria-label="Go to">
                <h3 className={sectionTitle}>Go to</h3>
                <div className={trimmed ? "" : "grid grid-cols-2 gap-2 px-1"}>
                  {destinations.map((destination) => {
                    const Icon = DESTINATION_ICONS[destination.id]
                    return (
                      <button
                        key={destination.id}
                        type="button"
                        onClick={() => go(destination.id)}
                        className={trimmed ? rowClass : "flex min-h-16 items-center gap-2.5 rounded-2xl border border-border/60 bg-card px-3 text-left active:bg-muted"}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">{destination.label}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{destination.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {cardCheck && pokemonResults.length > 0 && (
              <section aria-label="Pokémon">
                <h3 className={sectionTitle}>Pokémon · tap to see their cards</h3>
                {pokemonResults.map((pokemon) => {
                  const wanted = wantedCount(pokemon.id)
                  const state = getPokemonState?.(pokemon.id) ?? null
                  return (
                    <button key={pokemon.id} type="button" className={`${rowClass} min-h-16`} onClick={() => pickPokemon(pokemon)}>
                      <PokemonSprite id={pokemon.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-bold">{formatPokemonDisplayName(pokemon.name)}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">#{String(pokemon.id).padStart(4, "0")}</span>
                      </span>
                      {wanted > 0 ? (
                        <span className="shrink-0 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:text-rose-300">{wanted} wanted</span>
                      ) : state ? (
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${state.toneClass}`}>{state.label}</span>
                      ) : null}
                    </button>
                  )
                })}
              </section>
            )}

            {nothingFound && (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nothing found for “{trimmed}”.{!isOnline ? " Offline, only cards saved on this device can be found." : ""}
              </p>
            )}
          </div>
        </div>
        )}

        <div className="shrink-0 border-t border-border/50 bg-card/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3">
          {cardCheck && bundle.length > 0 && (
            <button
              type="button"
              onClick={() => setIsBundleOpen(true)}
              className="mb-2 flex h-12 w-full items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 text-left text-sm font-semibold text-primary"
            >
              <Layers className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                Bundle · {bundle.length} card{bundle.length === 1 ? "" : "s"}
                {bundle.some((entry) => entry.marketPrice !== null)
                  ? ` · market ${formatMoney(bundle.reduce((sum, entry) => sum + (entry.marketPrice ?? 0), 0), bundle[0].currency)}`
                  : ""}
              </span>
              <span className="shrink-0">Check bundle</span>
            </button>
          )}
          <label className="relative block">
            <span className="sr-only">Search cards, Pokémon, sets and pages</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              inputMode="search"
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              data-overlay-escape="clear"
              onChange={(event) => {
                setQuery(event.target.value)
                setBrowsing(null)
              }}
              onKeyDown={handleKeyDown}
              placeholder={cardCheck ? "Search a Pokémon, card or “44/102”…" : "Card, Pokémon, “44/102”, artist or page…"}
              className="h-14 w-full rounded-2xl border border-border/70 bg-background pl-12 pr-4 text-base font-medium outline-none placeholder:text-muted-foreground/80 focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
        </div>
        </>
        )}
      </div>
    </div>
  )
}
