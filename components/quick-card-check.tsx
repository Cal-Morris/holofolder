"use client"

// The card check (Show mode and plain Quick mode): what you need at a stall, one-handed. Ownership state, the market price for the
// chosen variant, an asking-price input with a verdict (lib/deal-check.ts), and big Bought / Add owned /
// Want / Mark got buttons with undo. Works offline from the device's cached prices and says how old they are.
import NativeWantedEntries from "@/components/native-wanted-entries"
import { nativeCardConsumers, nativeCardState, nativeCardLabel, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { useBillingContext } from "@/hooks/use-billing"
import { useGoogleAnalytics } from "@/components/google-analytics"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, ChevronDown, ExternalLink, Heart, Layers, Plus, ShoppingBag, TrendingUp, WifiOff } from "lucide-react"
import { useRegionalCardPrices } from "@/hooks/use-regional-card-prices"
import { getCardPriceKey } from "@/hooks/use-card-prices"
import { useShowSession } from "@/hooks/use-show-session"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatCardNumber, inferCardFinish, type SearchCardResult } from "@/lib/pokemon-card-browse"
import { getCardPickerFinishChoices } from "@/lib/card-picker-filters"
import { convertGbpForDisplay, formatMoney, getGbpPerUnit, getRegionalFinishPrices, type DisplayFxRates } from "@/lib/regional-price"
import type { DisplayCurrency, PricingRegion } from "@/lib/pricing-region"
import type { PricedCardFinish } from "@/lib/card-pricing"
import type { CardFinish } from "@/lib/domain/cards"
import { getPriceDataAgeDays } from "@/lib/price-freshness"
import { getRisingMomentum, isMomentumEligibleConfidence } from "@/lib/price-momentum"
import { nativeCatalogueQuote, nativeSoldEvidenceAllowed, type NativeBundleEvidence } from "@/lib/native-price-evidence"
import { buildDealPriceBands, checkDeal, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
import ShowBudget from "@/components/show-budget"
import ShowRevisitForm from "@/components/show-revisit-form"
import { toRecentCard } from "@/lib/recent-cards"
import { revisitAskingInput, revisitKey, type RevisitCard } from "@/lib/show-revisit"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import { buildSoldPriceGuide } from "@/lib/sold-price-guide"
import { CardPriceEvidence } from "@/components/card-price-evidence"
import { CardPriceComparison } from "@/components/card-price-comparison"
import { DealPriceScale } from "@/components/deal-price-scale"
import type { UndoAction } from "@/components/undo-snackbar"
import { DEAL_HIDE_WHILE_TYPING, DealPriceInput, DealVerdictPanel, PinnedDealVerdict } from "@/components/deal-keypad"

export type QuickCardAction = "bought" | "add-owned" | "want" | "got" | "remove-wanted"

import type { QuickCardState } from "@/lib/quick-card-state"
export type { QuickCardState } from "@/lib/quick-card-state"

/** A card waiting in the bundle, priced in the display currency when the check was made. */
export interface QuickBundleEntry {
  key: string
  card: SearchCardResult
  pokemon: { id: number; name: string }
  finish: CardFinish
  marketPrice: number | null
  currency: MoneyCurrency
  catalogMarketGbp?: number | null
  gbpPerUnit?: number | null
  soldCheck?: CardPriceCheck
  nativeEvidence?: NativeBundleEvidence
}

export type MoneyCurrency = Parameters<typeof formatMoney>[1]

export interface QuickCardCheckProps {
  nativeConsumer?: NativeConsumerBinding
  card: SearchCardResult
  pokemon: { id: number; name: string }
  state: QuickCardState
  getState?: (finish: CardFinish) => QuickCardState
  destinationName?: string
  budgetKey?: string | null
  savedDeal?: RevisitCard
  revisit?: { cards: RevisitCard[]; error: string | null; save: (entry: RevisitCard) => boolean }
  currency: DisplayCurrency
  fxRates?: DisplayFxRates | null
  pricingRegion: PricingRegion
  isOnline: boolean
  readOnly?: boolean
  /** Start on this printing (e.g. the finish on the want list) when the card has it. */
  initialFinish?: CardFinish | null
  onBack: () => void
  onRemoveOwned?: () => void
  onChangeCard?: (mode: "collect" | "wishlist", finish: CardFinish) => void
  onOpenDetails: (finish: CardFinish) => void
  onUndoAvailable: (action: UndoAction) => void
  /** Runs the action; resolves to an undo function, or null when nothing changed. */
  onAction: (action: QuickCardAction, finish: CardFinish) => Promise<(() => Promise<void>) | null>
  isInBundle: (key: string) => boolean
  onAddToBundle: (entry: QuickBundleEntry) => void
  /** Show mode's extras: Bought (logged to the show tally) and Bundle. Plain Quick mode keeps Own / Want / Got. */
  showTools?: boolean
}

export function bundleKey(card: SearchCardResult, finish: string) {
  return `${card.id}:${card.language ?? "en"}:${finish}`
}

export function formatPriceAge(fetchedAt: number | undefined, now: number) {
  if (!fetchedAt) return null
  const minutes = Math.max(0, Math.round((now - fetchedAt) / 60_000))
  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export default function QuickCardCheck({
  nativeConsumer,
  card,
  pokemon,
  state: initialState,
  getState,
  destinationName = "this binder",
  savedDeal,
  budgetKey,
  revisit,
  currency,
  fxRates: fxRatesProp,
  pricingRegion,
  isOnline,
  readOnly = false,
  initialFinish,
  onBack,
  onOpenDetails,
  onChangeCard,
  onRemoveOwned,
  onAction,
  onUndoAvailable,
  isInBundle,
  onAddToBundle,
  showTools = true,
}: QuickCardCheckProps) {
  const nativeModel = useMemo(() => nativeConsumer ? nativeCardConsumers(nativeConsumer) : null, [nativeConsumer])
  const trackGoogleEvent = useGoogleAnalytics()
  useEffect(() => {
    trackGoogleEvent("price_check_viewed", {})
  }, [card.id, trackGoogleEvent])
  const billing = useBillingContext()
  const premium = billing?.premium !== false
  const language = card.language ?? "en"
  const lookups = useMemo(() => [{ cardId: card.id, language: nativeConsumer ? card.language : language }], [card.id, card.language, language, nativeConsumer])
  const { pricesByCardId, fxRates: hookRates, isLoading } = useRegionalCardPrices(lookups, true, pricingRegion, Boolean(nativeConsumer))
  const snapshot = pricesByCardId[getCardPriceKey(card.id, language)]
  const fxRates = fxRatesProp ?? hookRates ?? null
  const context = useMemo(() => ({ currency, fxRates }), [currency, fxRates])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
  }, [])
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  const { logPurchases, removePurchases } = useShowSession()

  const inferred = inferCardFinish(card.rarity, card.variants)
  const finishChoices = useMemo(() => getCardPickerFinishChoices(card.variants, inferred, "any", snapshot?.finishPrices), [card.variants, inferred, snapshot?.finishPrices])
  const [finish, setFinish] = useState<CardFinish>(() =>
    initialFinish ?? finishChoices[0]?.finish ?? inferred)
  const state: QuickCardState = nativeConsumer ? nativeCardState(nativeModel, card, finish) : getState?.(finish) ?? initialState
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null)
  const replacementKey = state.replacing ? `${card.id}:${finish}:${state.replacing}` : null
  const needsConfirmation = Boolean(replacementKey && confirmedReplacement !== replacementKey)
  const [soldEvidence, setSoldEvidence] = useState<{ key: string; check: CardPriceCheck } | null>(null)
  const finishPrices = useMemo(() => getRegionalFinishPrices(snapshot, pricingRegion), [pricingRegion, snapshot])
  // Native lookups require reliable exact-finish evidence; legacy keeps its headline fallback.
  const exactPrice = finishPrices[finish as PricedCardFinish]
  const nativeQuote = nativeCatalogueQuote(card, finish, exactPrice, now)
  const nativeSoldAllowed = nativeSoldEvidenceAllowed(card, finish, Boolean(nativeQuote))
  const price = nativeConsumer ? (nativeQuote && exactPrice ? { ...exactPrice, confidence: nativeQuote.confidence } : undefined) : exactPrice ?? (finishChoices.length === 0 || finish === finishChoices[0]?.finish ? snapshot : undefined)

  const comparisonKey = bundleKey(card, finish)
  const soldGuide = buildSoldPriceGuide(premium && (!nativeConsumer || nativeSoldAllowed) && soldEvidence?.key === comparisonKey ? soldEvidence.check : null, price?.gbpAmount, finish, thresholds)
  const usesSoldGuide = soldGuide?.referenceGbp != null

  const toDisplay = useCallback((gbp: number | null | undefined) => (typeof gbp === "number" && gbp > 0 ? convertGbpForDisplay(gbp, context, snapshot) : null), [context, snapshot])
  const market = toDisplay(soldGuide?.referenceGbp ?? price?.gbpAmount)
  const low = toDisplay(usesSoldGuide ? soldGuide.q1 : price?.lowGbpAmount)
  const high = toDisplay(usesSoldGuide ? soldGuide.q3 : price?.highGbpAmount)
  const moneyCurrency = market?.currency ?? currency
  const money = (amount: number) => formatMoney(amount, moneyCurrency)

  const dataAgeDays = getPriceDataAgeDays(usesSoldGuide ? soldEvidence?.check.checkedAt : price?.updatedAt ?? snapshot?.updatedAt, now)
  const isRising = !usesSoldGuide && Boolean(getRisingMomentum(snapshot, now))
  const cacheAge = formatPriceAge(snapshot?.fetchedAt, now)
  const referenceUpdatedAt = usesSoldGuide ? soldEvidence?.check.checkedAt : price?.updatedAt ?? snapshot?.updatedAt
  const referenceAge = formatPriceAge(referenceUpdatedAt ? Date.parse(referenceUpdatedAt) : undefined, now)

  const currentSavedDeal = revisit?.cards.find(entry => revisitKey(entry.card) === revisitKey(toRecentCard(card, pokemon, undefined, finish)))
  const initialOffer = currentSavedDeal ?? (savedDeal && (savedDeal.card.finish ?? "normal") === finish ? savedDeal : undefined)
  const [editedInput, setInput] = useState<string | null>(null)
  const input = revisitAskingInput(initialOffer, moneyCurrency, editedInput)
  const askingPrice = parseAskingPrice(input)
  const deal = askingPrice && market
    ? checkDeal({ askingPrice, marketPrice: market.amount, thresholds, confidence: usesSoldGuide ? "medium" : price?.confidence, dataAgeDays, isRising })
    : null

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const run = async (action: QuickCardAction) => {
    if (nativeConsumer || busy || (action !== "want" && action !== "remove-wanted" && needsConfirmation)) return
    setBusy(true)
    setActionError(null)
    try {
      const revert = await onAction(action, finish)
      if (!revert) return
      const purchaseIds = action === "bought" && askingPrice
        ? logPurchases([{ cardId: card.id, cardName: card.name, language, finish, price: askingPrice, marketPrice: market?.amount ?? null, currency: moneyCurrency }])
        : []
      navigator.vibrate?.(action === "bought" ? [12, 40, 12] : 15)
      const message = action === "bought"
        ? `Bought ${card.name}${askingPrice ? ` for ${money(askingPrice)}` : ""}`
        : action === "remove-wanted" ? `${card.name} removed from want list` : action === "want" ? `${card.name} added to Wanted` : action === "got" ? `Got ${card.name}` : `${card.name} added to your binder`
      if (revert || purchaseIds.length > 0) {
        onUndoAvailable({
          message,
          run: async () => {
            await revert()
            if (purchaseIds.length > 0) removePurchases(purchaseIds)
          },
        })
      }
    } catch {
      setActionError("Could not update your binder. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const key = bundleKey(card, finish)
  const priceBands = market ? buildDealPriceBands(market.amount, thresholds) : null
  const canGuide = usesSoldGuide || isMomentumEligibleConfidence(price?.confidence)
  const verdictEmptyText = market
    ? canGuide ? `Type the asking price. Pay up to ${money(priceBands!.fair.high)}.` : "Thin price data. Enter an asking price for a rough comparison."
    : isOnline
    ? "No market price for this card yet, so no verdict."
    : "This card's price isn't saved on this device, and prices can't be fetched offline. Check again when you have signal."
  const soldMedian = usesSoldGuide ? null : toDisplay(soldGuide?.median)
  const inBundle = isInBundle(key)
  const thumb = card.image ? toCardImageSrc(card.image.replace(/\/high\.webp$/, "/low.webp")) : null
  const statusLabel = nativeConsumer ? nativeCardLabel(nativeCardState(nativeModel, card, finish)) : state.owned ? "Owned" : state.wanted ? "Wanted" : "Not in binder"
  const statusTone = state.owned
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : state.wanted ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground"
  const bigButton = "flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold disabled:opacity-45"

  return (
    <section aria-label={`Check ${card.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="quick-card-check">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back to results" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/70">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="trading-card relative w-14 shrink-0 overflow-hidden bg-muted/50">
            {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
            {thumb && <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight">{card.name}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {card.set.name} · {formatCardNumber(card)}{language !== "en" ? ` · ${language.toUpperCase()}` : ""}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span data-testid="quick-card-status" className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>{statusLabel}</span>
              {isRising && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <TrendingUp className="h-3 w-3" aria-hidden />Rising
                </span>
              )}
              <button type="button" onClick={() => onOpenDetails(finish)} className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary">
                More details<ExternalLink className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {!nativeConsumer && <div className="rounded-xl bg-muted/30 px-3 py-2 text-xs text-muted-foreground" aria-label="Acquisition destination">
          <p className="font-semibold">Adds to {destinationName}</p>
          {state.ownedElsewhere?.length ? <p>Already owned in {state.ownedElsewhere.join(", ")}</p> : null}
          {state.otherBindersIncomplete ? <p className="text-xs text-muted-foreground">Other binders haven&apos;t all loaded. Duplicate check is incomplete.</p> : !isOnline ? <p className="text-xs text-muted-foreground">Other binders use saved data and may have changed.</p> : null}
          {state.replacing && <label className="mt-2 flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={!needsConfirmation} onChange={event => setConfirmedReplacement(event.target.checked ? replacementKey : null)} />
            <span>Replace {state.replacing} in {destinationName}</span>
          </label>}
        </div>}

        {finishChoices.length > 0 && (
          <div role="radiogroup" aria-label="Variant" className="flex gap-1.5">
            {finishChoices.map((choice) => (
              <button
                key={choice.finish}
                type="button"
                role="radio"
                aria-checked={finish === choice.finish}
                onClick={() => setFinish(choice.finish)}
                className={`min-h-12 min-w-0 flex-1 rounded-xl border px-2 text-sm font-semibold ${finish === choice.finish ? "border-primary bg-primary text-primary-foreground" : "border-border/70 bg-card"}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2" data-testid="quick-card-market">
          <div className={`grid gap-2 ${soldMedian ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3">
              <p className="text-xs text-muted-foreground">{usesSoldGuide ? "Sold reference" : "Market"}</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums" data-testid="quick-card-market-price">
                {market ? money(market.amount) : isLoading && isOnline ? "…" : isOnline ? "No price" : "Not available offline"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{formatCardFinishLabel(finish)}</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Pay up to</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums" data-testid="quick-pay-up-to">{canGuide && priceBands ? money(priceBands.fair.high) : "Unknown"}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{canGuide && priceBands ? "Fair price ceiling" : market ? "Thin price data" : "No price guide"}</p>
            </div>
            {soldMedian && <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3">
              <p className="text-xs text-muted-foreground">Sold median</p>
              <p className="mt-1 break-words text-xl font-bold tabular-nums">{money(soldMedian.amount)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{soldGuide?.count} sales · Sample only</p>
            </div>}
          </div>
          {usesSoldGuide ? <p className="text-xs text-muted-foreground">Recent sold median · {soldGuide.count} sales. Catalogue: {toDisplay(price?.gbpAmount) ? money(toDisplay(price?.gbpAmount)!.amount) : "unavailable"}.</p> : null}
          {(low || high) && <p className="text-xs tabular-nums text-muted-foreground">
            {low ? `Low ${money(low.amount)}` : ""}{low && high ? " · " : ""}{high ? `High ${money(high.amount)}` : ""}
          </p>}
          {(cacheAge || !isOnline) && <p className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="quick-card-cache-age">
            {!isOnline && <WifiOff className="h-3 w-3" aria-hidden />}
            {cacheAge ? `${isOnline ? "Saved" : "Offline · saved price from"} ${cacheAge}` : "Offline · no saved price on this device"}
          </p>}
          <p className="text-[11px] text-muted-foreground">{usesSoldGuide ? "Sold check" : "Provider quote"}: {referenceAge ?? "date unknown"}</p>
        </div>

        <DealVerdictPanel deal={deal} money={money} emptyText={verdictEmptyText} />
        {(!nativeConsumer || nativeSoldAllowed) && <CardPriceComparison readOnly={Boolean(nativeConsumer)} key={`${card.id}:${language}:${finish}`} cardId={card.id} searchCard={{ name: card.name, localId: card.localId, setName: card.set.name }} language={language} finish={finish} catalogMarketGbp={price?.gbpAmount} thresholds={thresholds} showBuyingScale={false} offerGbp={askingPrice && getGbpPerUnit(moneyCurrency, fxRates, snapshot) ? askingPrice * getGbpPerUnit(moneyCurrency, fxRates, snapshot)! : null} onSoldCheck={check => { if (!nativeConsumer || nativeSoldAllowed) setSoldEvidence({ key: comparisonKey, check }) }} />}

        <details className="group min-w-0 rounded-2xl border border-border/60 bg-card px-3">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            Catalog price sources<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <section aria-label="Catalog price sources" className="min-w-0 pb-3">
            <p className="text-xs text-muted-foreground">{formatCardFinishLabel(finish)} · Catalog quotes and averages, not sold records. Values in GBP, converted from the original source currency shown.</p>
            <CardPriceEvidence price={finishPrices[finish as PricedCardFinish]} emptyMessage="No catalog evidence saved for this finish." />
          </section>
        </details>

        {currentSavedDeal && currentSavedDeal.currency !== moneyCurrency && currentSavedDeal.askingPrice !== null && <p className="text-sm">Saved asking price: {formatMoney(currentSavedDeal.askingPrice, currentSavedDeal.currency)}. Enter a new price to use {moneyCurrency}.</p>}
        {revisit && <ShowRevisitForm key={`revisit:${comparisonKey}`} card={toRecentCard(card, pokemon, undefined, finish)} entry={currentSavedDeal} askingPrice={askingPrice} currency={moneyCurrency} onSave={entry => revisit.save(editedInput === null && !askingPrice && currentSavedDeal ? { ...entry, askingPrice: currentSavedDeal.askingPrice, currency: currentSavedDeal.currency } : entry)} error={revisit.error} />}
      </div>

      {/* Short screens need room to scroll prices as well as reach the footer controls. */}
      <div className="max-h-[70%] min-h-0 min-w-0 shrink overflow-y-auto overscroll-contain scroll-pb-[calc(var(--safe-bottom)+0.75rem)] border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        {market ? <DealPriceScale market={market.amount} offer={askingPrice} overlap={soldGuide?.eligible && soldGuide.fairOverlap ? { low: toDisplay(soldGuide.fairOverlap.low)!.amount, high: toDisplay(soldGuide.fairOverlap.high)!.amount } : null} thresholds={thresholds} money={money} /> : null}
        <PinnedDealVerdict deal={deal} money={money} emptyText={verdictEmptyText} />
        {/* Show mode (and the Wanted price lookup) is about the asking price, so it opens the keyboard;
            plain Quick shows the price, verdict and Own / Want first, and Asking opens the keyboard on tap. */}
        {showTools && budgetKey && <ShowBudget compact storageKey={budgetKey} currency={moneyCurrency} />}
        {!readOnly && !nativeConsumer && onChangeCard && (state.wanted || state.owned) && <div className="flex flex-col gap-2">
          {state.wanted && <>
            <button type="button" disabled={busy} onClick={() => onChangeCard("wishlist", finish)} className="min-h-11 rounded-xl border border-border/70 px-3 py-2 text-sm font-semibold">Change wanted card</button>
            <button type="button" disabled={busy} onClick={() => void run("remove-wanted")} className="min-h-11 rounded-xl border border-destructive/30 px-3 py-2 text-sm font-semibold text-destructive">Remove from want list</button>
          </>}
          {state.owned && <>
            <button type="button" disabled={busy} onClick={() => onChangeCard("collect", finish)} className="min-h-11 rounded-xl border border-border/70 px-3 py-2 text-sm font-semibold">Change owned card</button>
            {onRemoveOwned && <button type="button" disabled={busy} onClick={onRemoveOwned} className="min-h-11 rounded-xl border border-destructive/30 px-3 py-2 text-sm font-semibold text-destructive">Remove owned card</button>}
          </>}
        </div>}
        {nativeConsumer && <NativeWantedEntries binding={readOnly ? { ...nativeConsumer, editingAvailable: false } : nativeConsumer} card={card} finish={finish} />}
        <DealPriceInput value={input} onChange={setInput} autoFocus={showTools && !nativeConsumer} />
        {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        {(showTools || !readOnly) && (
        <div className={`grid ${readOnly || nativeConsumer ? "grid-cols-1" : "grid-cols-2"} gap-2 ${DEAL_HIDE_WHILE_TYPING}`}>
          {showTools && !readOnly && !nativeConsumer && (
            <button type="button" disabled={busy || needsConfirmation} onClick={() => void run("bought")} className={`${bigButton} bg-primary text-primary-foreground`}>
              <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />Bought
            </button>
          )}
          {!readOnly && !nativeConsumer && (state.wanted && !state.owned ? (
            <button type="button" disabled={busy || needsConfirmation} onClick={() => void run("got")} aria-label="Mark got" className={`${bigButton} border border-border/70 bg-card`}>
              <Check className="h-5 w-5 shrink-0" aria-hidden />Got it
            </button>
          ) : (
            <button type="button" disabled={busy || state.owned || needsConfirmation} onClick={() => void run("add-owned")} aria-label={state.owned ? "Owned" : "Add owned"} className={`${bigButton} border border-border/70 bg-card`}>
              <Plus className="h-5 w-5 shrink-0" aria-hidden />{state.owned ? "Owned" : "Own"}
            </button>
          ))}
          {!readOnly && !nativeConsumer && !state.wanted && (
            <button type="button" disabled={busy} onClick={() => void run("want")} aria-label="Want" className={`${bigButton} border border-border/70 bg-card`}>
              <Heart className="h-5 w-5 shrink-0" aria-hidden />Want
            </button>
          )}
          {showTools && (
          <button
            type="button"
            disabled={inBundle}
            onClick={() => {
              navigator.vibrate?.(10)
              onAddToBundle({ key, card, pokemon, finish, marketPrice: market?.amount ?? null, currency: moneyCurrency, catalogMarketGbp: price?.gbpAmount ?? null, gbpPerUnit: getGbpPerUnit(moneyCurrency, fxRates, snapshot), soldCheck: premium && (!nativeConsumer || nativeSoldAllowed) && soldEvidence?.key === comparisonKey ? soldEvidence.check : undefined,
                ...(nativeConsumer ? { nativeEvidence: { catalogue: nativeQuote, soldExact: nativeSoldAllowed } } : {}) })
            }}
            aria-label={inBundle ? "In bundle" : "Add to bundle"}
            className={`${bigButton} border border-border/70 bg-card`}
          >
            <Layers className="h-5 w-5 shrink-0" aria-hidden />{inBundle ? "Added" : "Bundle"}
          </button>
          )}
        </div>
        )}
      </div>
    </section>
  )
}
