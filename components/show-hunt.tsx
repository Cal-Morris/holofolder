"use client"

// Show mode's home: the "Hunting" list. The want list grouped by Pokémon (most wanted or dearest first), with
// era/set and illustrator filters to match how a dealer's binder is sorted. Every card shows what to pay up to;
// one tap opens the deal check. Built from the collection on this device, so it works offline.
import NativeWantedEntries from "@/components/native-wanted-entries"
import type { NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronRight, Heart, Target, TrendingDown } from "lucide-react"
import { PriceDropBadge } from "@/components/price-drop-badge"
import { BackgroundPriceCheck } from "@/components/collection-price-check"
import { useBillingContext } from "@/hooks/use-billing"
import { checkCompsTargets } from "@/lib/check-comps"
import ShowCheckComps from "@/components/show-check-comps"
import { useDisplayCardPrices } from "@/hooks/use-display-card-prices"
import { toCardImageSrc } from "@/lib/card-image-url"
import type { CheckCompsTarget } from "@/lib/check-comps"
import { formatCardFinishLabel } from "@/lib/card-labels"
import { readDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { CardFinish, WantedCard } from "@/lib/domain/cards"
import { loadIllustratorCards, loadIllustratorDirectory } from "@/lib/illustrator-client"
import type { IllustratorSummary } from "@/lib/illustrators"
import { formatPokemonDisplayName, getOfficialArtworkUrl } from "@/lib/pokemon-catalog"
import { formatCardNumber, type SearchCardResult } from "@/lib/pokemon-card-browse"
import { formatMomentumChange } from "@/lib/price-momentum"
import { formatMoney, type DisplayFxRates } from "@/lib/regional-price"
import type { DisplayCurrency, PricingRegion } from "@/lib/pricing-region"
import {
  buildGoodPickups,
  buildHuntGroups,
  collectHuntCards,
  getHuntFilterOptions,
  matchesHuntFilters,
  wantedToSearchCard,
  type HuntGroup,
  type HuntPickup,
  type HuntSort,
  type HuntSourceItem,
} from "@/lib/show-hunt"

type Money = { amount: number; currency: Parameters<typeof formatMoney>[1] }

export function cardThumb(image?: string | null) {
  if (!image) return null
  return toCardImageSrc(image.replace(/\/high\.webp$/, "/low.webp"))
}

export function payUpTo(market: number, thresholds: DealThresholds) {
  return Math.round(market * (1 + thresholds.fairPct / 100) * 100) / 100
}

export function useDealThresholds() {
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  return thresholds
}

export function PokemonSprite({ id, size = "h-12 w-12" }: { id: number; size?: string }) {
  return (
    <span className={`${size} relative shrink-0 overflow-hidden rounded-2xl bg-muted/60`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied artwork, cached by the service worker */}
      <img src={getOfficialArtworkUrl(id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain p-0.5" />
    </span>
  )
}

/** A big, scannable card row: thumbnail, name, set and number, then the price to pay up to. */
export function HuntCardRow({
  card,
  finish,
  market,
  thresholds,
  standing,
  showStanding = true,
  onPick,
}: {
  card: SearchCardResult
  finish?: CardFinish | null
  market: Money | null
  thresholds: DealThresholds
  standing: "wanted" | "missing" | "owned"
  showStanding?: boolean
  onPick: () => void
}) {
  const thumb = cardThumb(card.image)
  const limit = market ? formatMoney(payUpTo(market.amount, thresholds), market.currency) : null
  const tone = standing === "owned" ? "border-border/40 opacity-55" : "border-border/60 bg-card"
  const finishLabel = finish && finish !== "normal" ? formatCardFinishLabel(finish) : null
  return (
    <button
      type="button"
      onClick={onPick}
      data-standing={standing}
      aria-label={`${card.name}, ${card.set.name} ${formatCardNumber(card)}${finishLabel ? `, ${finishLabel}` : ""}${standing === "missing" ? "" : `, ${standing}`}${limit ? `, pay up to ${limit}` : ""}`}
      className={`holo-tile flex min-h-[5.5rem] w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left active:bg-muted ${tone}`}
    >
      <span className="trading-card relative w-14 shrink-0 overflow-hidden bg-muted/50">
        {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
        {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold leading-tight">{card.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{card.set.name} · {formatCardNumber(card)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {showStanding && standing === "wanted" && <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300"><Heart className="h-3 w-3" aria-hidden />Wanted</span>}
          {standing === "owned" && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">✓ Owned</span>}
          {finishLabel && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{finishLabel}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end text-right">
        {limit ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pay up to</span>
            <span className="text-lg font-black tabular-nums leading-tight" data-testid="hunt-pay-up-to">{limit}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">Market {formatMoney(market!.amount, market!.currency)}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No price</span>
        )}
      </span>
    </button>
  )
}

/**
 * "Good pickups": an expandable list of wanted cards whose catalogue price has dropped (price-momentum's drop
 * rule), biggest fall first. Each tile shows the drop and what to pay up to; one tap opens the deal check.
 */
const GoodPickups = memo(function GoodPickups({
  pickups,
  thresholds,
  marketOf,
  snapshotOf,
  onPick,
}: {
  pickups: readonly HuntPickup[]
  thresholds: DealThresholds
  marketOf: (card: WantedCard) => Money | null
  snapshotOf: (card: WantedCard) => Parameters<typeof PriceDropBadge>[0]["price"]
  onPick: (pickup: HuntPickup) => void
}) {
  return (
    <section aria-label="Good pickups" data-testid="show-good-pickups" className="pt-3">
      <details className="group/pickups">
        <summary className="flex min-h-10 cursor-pointer items-center gap-1.5 px-1 text-sm font-semibold">
          <TrendingDown className="h-4 w-4 text-emerald-600" aria-hidden />
          Good pickups <span className="font-normal text-muted-foreground">{pickups.length} price drops</span>
          <ChevronRight className="ml-auto h-4 w-4 group-open/pickups:rotate-90" aria-hidden />
        </summary>
        <div className="grid grid-cols-1 gap-2 @min-[28rem]:grid-cols-2 @min-[48rem]:grid-cols-3">
          {pickups.map((pickup) => {
            const { wanted } = pickup.card
            const market = marketOf(wanted)
            const limit = market ? formatMoney(payUpTo(market.amount, thresholds), market.currency) : null
            const thumb = cardThumb(wanted.card_image)
            const drop = formatMomentumChange(pickup.momentum.change).replace("-", "")
            return (
              <button
                key={pickup.card.key}
                type="button"
                onClick={() => onPick(pickup)}
                data-testid="good-pickup"
                aria-label={`${wanted.card_name}, ${pickup.card.setName}, price dropped ${drop} over ${pickup.momentum.timeframe}${limit ? `, pay up to ${limit}` : ""}`}
                className="flex min-h-18 w-full min-w-0 items-center gap-2 rounded-2xl border border-border/60 bg-card px-2 py-2 text-left active:bg-muted"
              >
                <span className="trading-card relative w-9 shrink-0 overflow-hidden bg-muted/50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
                  {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold leading-tight">{wanted.card_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{pickup.card.setName}</span>
                  <PriceDropBadge price={snapshotOf(wanted)} className="mt-1" />
                  {limit && <span className="mt-0.5 block text-xs font-black tabular-nums" data-testid="good-pickup-pay-up-to">≤ {limit}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </details>
    </section>
  )
})


const selectClass = "h-11 w-full min-w-0 rounded-xl border border-border/70 bg-card px-3 text-sm font-medium"

export interface ShowHuntProps {
  recentCards?: ReactNode
  items: readonly HuntSourceItem[]
  currency: DisplayCurrency
  fxRates?: DisplayFxRates | null
  pricingRegion: PricingRegion
  isOnline: boolean
  onPickCard: (card: SearchCardResult, pokemon: { id: number; name: string }, finish: CardFinish | null) => void
  onPickPokemon: (pokemon: { id: number; name: string }) => void
}

function ShowHunt({ recentCards, items, currency, fxRates, pricingRegion, isOnline, onPickCard, onPickPokemon }: ShowHuntProps) {
  const billing = useBillingContext()
  const thresholds = useDealThresholds()
  const [sort, setSort] = useState<HuntSort>("wanted")
  const [era, setEra] = useState<string | null>(null)
  const [setId, setSetId] = useState<string | null>(null)
  const [illustrator, setIllustrator] = useState("")
  const [directory, setDirectory] = useState<IllustratorSummary[]>([])
  const [illustratorCards, setIllustratorCards] = useState<{ name: string; ids: Set<string> | null } | null>(null)

  const lookups = useMemo(
    () => items.flatMap((item) => (item.wanted_cards ?? []).map((card) => ({ cardId: card.card_id, language: card.card_language ?? "en", finish: card.card_finish }))),
    [items],
  )
  const { priceOf, snapshotOf } = useDisplayCardPrices(lookups, pricingRegion, currency, fxRates)
  // Everything below is derived from the want list and its prices, so it is memoised: Show mode's parents
  // re-render often (prices streaming in, sync status, the deal check opening beside it) and rebuilding the
  // groups, filters, pickups and every row on each of those made the Hunting list feel sluggish on phones.
  const priceOfWanted = useCallback(
    (card: WantedCard) => priceOf({ cardId: card.card_id, language: card.card_language ?? "en", finish: card.card_finish }),
    [priceOf],
  )
  const snapshotOfWanted = useCallback(
    (card: WantedCard) => snapshotOf({ cardId: card.card_id, language: card.card_language ?? "en" }),
    [snapshotOf],
  )
  const cards = useMemo(() => collectHuntCards(items, (card) => priceOfWanted(card)?.amount ?? null), [items, priceOfWanted])
  const options = useMemo(() => getHuntFilterOptions(cards), [cards])
  const visibleSets = useMemo(() => (era ? options.sets.filter((entry) => entry.era.id === era) : options.sets), [era, options.sets])

  useEffect(() => {
    let cancelled = false
    void loadIllustratorDirectory().then((result) => {
      if (!cancelled && result.data) setDirectory([...result.data].sort((a, b) => a.name.localeCompare(b.name)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!illustrator) return
    let cancelled = false
    void loadIllustratorCards(illustrator).then((result) => {
      if (cancelled) return
      setIllustratorCards({ name: illustrator, ids: result.data ? new Set(result.data.cards.map((card) => card.id)) : null })
    })
    return () => {
      cancelled = true
    }
  }, [illustrator])

  // The want list remembers each card's illustrator, so the filter works offline; the directory adds older entries.
  const illustratorIds = useMemo(() => (illustrator
    ? new Set([
        ...(illustratorCards?.name === illustrator ? illustratorCards.ids ?? [] : []),
        ...cards.filter((card) => card.wanted.illustrator === illustrator).map((card) => card.wanted.card_id),
      ])
    : null), [cards, illustrator, illustratorCards])
  // ~435 directory names: sorted once per want list / directory change, not on every render.
  const illustratorNames = useMemo(
    () => [...new Set([...cards.flatMap((card) => (card.wanted.illustrator ? [card.wanted.illustrator] : [])), ...directory.map((entry) => entry.name)])]
      .sort((a, b) => a.localeCompare(b)),
    [cards, directory],
  )
  const groups = useMemo(
    () => buildHuntGroups(items, cards, sort, { era, setId, cardIds: illustratorIds }, { priceOf: (card) => snapshotOfWanted(card.wanted), stableWantedOrder: true }),
    [cards, era, illustratorIds, items, setId, snapshotOfWanted, sort],
  )
  const pickups = useMemo(
    () => buildGoodPickups(cards, (card) => snapshotOfWanted(card.wanted), { era, setId, cardIds: illustratorIds }),
    [cards, era, illustratorIds, setId, snapshotOfWanted],
  )
  const pickPickup = useCallback(
    ({ card }: HuntPickup) => onPickCard(wantedToSearchCard(card.wanted, card.pokemonId), { id: card.pokemonId, name: card.pokemonName }, card.wanted.card_finish ?? null),
    [onPickCard],
  )
  // Comps follow the Hunting filters, dearest first (the warm engine keeps the order and caps the run).
  const compsTargets = useMemo<CheckCompsTarget[]>(
    () => cards
      .filter((card) => matchesHuntFilters(card, { era, setId, cardIds: illustratorIds }))
      .sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
      .map((card) => ({ cardId: card.wanted.card_id, language: card.wanted.card_language ?? "en", finish: card.wanted.card_finish ?? null })),
    [cards, era, illustratorIds, setId],
  )
  const fullWantTargets = useMemo(() => checkCompsTargets(lookups, "collection"), [lookups])
  const total = cards.length
  const filtering = Boolean(era || setId || illustrator)

  return (
    <section aria-label="Hunting" className="flex min-h-0 flex-1 flex-col" data-testid="show-hunt">
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {recentCards}
        <div data-hunt-controls className="holo-panel sticky top-0 z-10 my-3 space-y-2 rounded-3xl border border-border/60 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Target className="h-5 w-5 shrink-0 text-rose-500" aria-hidden />
            <h3 className="min-w-0 flex-1 truncate text-base font-bold">
              Hunting <span className="font-medium text-muted-foreground">· {total} card{total === 1 ? "" : "s"}{isOnline ? "" : " · offline"}</span>
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 @min-[48rem]:grid-cols-4">
            <select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value as HuntSort)} className={selectClass}>
              <option value="wanted">Most wanted</option>
              <option value="value">Top value</option>
              <option value="falling">Biggest price drop</option>
              <option value="rising">Biggest price rise</option>
            </select>
            <select aria-label="Era" value={era ?? ""} onChange={(event) => { setEra(event.target.value || null); setSetId(null) }} className={selectClass}>
              <option value="">All eras</option>
              {options.eras.map(({ era: entry, count }) => <option key={entry.id} value={entry.id}>{entry.label} ({count})</option>)}
            </select>
            <label className="min-w-0">
              <span className="sr-only">Set</span>
              <select aria-label="Set" value={setId ?? ""} onChange={(event) => setSetId(event.target.value || null)} className={selectClass}>
                <option value="">Any set</option>
                {visibleSets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.count})</option>)}
              </select>
            </label>
            <label className="relative min-w-0">
              <span className="sr-only">Illustrator</span>
              <select aria-label="Illustrator" value={illustrator} onChange={(event) => setIllustrator(event.target.value)} className={selectClass}>
                <option value="">Any illustrator</option>
                {illustratorNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
        </div>

        {total > 0 && (
          <div className="pt-3">
            {billing?.access?.source === "perpetual" ? (
              <BackgroundPriceCheck targets={fullWantTargets} kind="wanted" ownerId={billing.access.ownerUserId} isOnline={isOnline} label="Check prices" scopeLabel="your want list" />
            ) : <ShowCheckComps targets={compsTargets} isOnline={isOnline} />}
          </div>
        )}

        {pickups.length > 0 && (
          <GoodPickups
            pickups={pickups}
            thresholds={thresholds}
            marketOf={priceOfWanted}
            snapshotOf={snapshotOfWanted}
            onPick={pickPickup}
          />
        )}

        {groups.length === 0 ? (
          <div role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
            {total === 0 && !filtering
              ? <>Your want list is empty. Search a Pokémon and tap <b>Want</b> on the cards you&apos;re after.</>
              : illustrator && illustratorCards?.name === illustrator && illustratorCards.ids === null
              ? `None of your wanted cards are by ${illustrator}, as far as this device knows.`
              : "Nothing on your want list matches these filters."}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 pt-3 @min-[48rem]:grid-cols-2">
            {groups.map((group) => (
              <HuntGroupSection
                key={group.pokemonId}
                group={group}
                priceOfWanted={priceOfWanted}
                thresholds={thresholds}
                onPickCard={onPickCard}
                onPickPokemon={onPickPokemon}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** One Pokémon's block of the Hunting list. Memoised so a parent re-render with the same want list and
 *  prices skips its rows (a long want list is hundreds of rows with thumbnails). */
const HuntGroupSection = memo(function HuntGroupSection({
  group,
  priceOfWanted,
  thresholds,
  onPickCard,
  onPickPokemon,
}: {
  group: HuntGroup
  priceOfWanted: (card: WantedCard) => Money | null
  thresholds: DealThresholds
  onPickCard: ShowHuntProps["onPickCard"]
  onPickPokemon: ShowHuntProps["onPickPokemon"]
}) {
  const pokemon = { id: group.pokemonId, name: group.pokemonName }
  const name = formatPokemonDisplayName(group.pokemonName)
  return (
    <section
      aria-label={`Hunting ${name}`}
      className="show-hunt-group space-y-1.5"
      // Remember each group's measured height when the browser can safely skip its contents.
      style={{ containIntrinsicBlockSize: `auto ${3.5 + group.cards.length * 6.4}rem` }}
    >
      <button type="button" onClick={() => onPickPokemon(pokemon)} aria-label={`${name}: all cards`} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-muted">
        <PokemonSprite id={group.pokemonId} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold">{name}</span>
          <span className="block text-xs text-muted-foreground">
            #{String(group.pokemonId).padStart(4, "0")} · {group.anyCard ? "any card" : `${group.cards.length} wanted`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">All cards<ChevronRight className="h-4 w-4" aria-hidden /></span>
      </button>
      {group.cards.map((entry) => {
        const card = wantedToSearchCard(entry.wanted, group.pokemonId)
        return (
          <HuntCardRow
            key={entry.key}
            card={card}
            finish={entry.wanted.card_finish}
            market={priceOfWanted(entry.wanted)}
            thresholds={thresholds}
            standing="wanted"
            showStanding={false}
            onPick={() => onPickCard(card, pokemon, entry.wanted.card_finish ?? null)}
          />
        )
      })}
    </section>
  )
})

export default memo(function ShowHuntConsumer(props: ShowHuntProps & { nativeConsumer?: NativeConsumerBinding }) {
  if (props.nativeConsumer) return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{props.recentCards && <div className="px-3">{props.recentCards}</div>}<NativeWantedEntries binding={props.nativeConsumer} onCheck={(card, finish) => props.onPickCard(card, { id: card.dexIds?.[0] ?? 0, name: card.name }, finish ?? null)} /></div>
  return <ShowHunt {...props} />
})
