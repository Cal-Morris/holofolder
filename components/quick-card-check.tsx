"use client"

// The card check (Show mode and plain Quick mode): what you need at a stall, one-handed. Ownership state, the market price for the
// chosen variant, an asking-price input with a verdict (lib/deal-check.ts), and big Bought / Add owned /
// Want / Mark got buttons with undo. Works offline from the device's cached prices and says how old they are.
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, ExternalLink, Heart, Layers, Plus, ShoppingBag, TrendingUp, WifiOff } from "lucide-react"
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
import { getRisingMomentum } from "@/lib/price-momentum"
import { checkDeal, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import { buildSoldPriceGuide } from "@/lib/sold-price-guide"
import { CardPriceEvidence } from "@/components/card-price-evidence"
import { CardPriceComparison } from "@/components/card-price-comparison"
import { DealPriceScale } from "@/components/deal-price-scale"
import UndoSnackbar from "@/components/undo-snackbar"
import { DEAL_HIDE_WHILE_TYPING, DealPriceInput, DealVerdictPanel, PinnedDealVerdict } from "@/components/deal-keypad"

export type QuickCardAction = "bought" | "add-owned" | "want" | "got"

export interface QuickCardState {
  owned: boolean
  wanted: boolean
}

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
}

export type MoneyCurrency = Parameters<typeof formatMoney>[1]

export interface QuickCardCheckProps {
  card: SearchCardResult
  pokemon: { id: number; name: string }
  state: QuickCardState
  currency: DisplayCurrency
  fxRates?: DisplayFxRates | null
  pricingRegion: PricingRegion
  isOnline: boolean
  readOnly?: boolean
  /** Start on this printing (e.g. the finish on the want list) when the card has it. */
  initialFinish?: CardFinish | null
  onBack: () => void
  onOpenDetails: () => void
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
  card,
  pokemon,
  state,
  currency,
  fxRates: fxRatesProp,
  pricingRegion,
  isOnline,
  readOnly = false,
  initialFinish,
  onBack,
  onOpenDetails,
  onAction,
  isInBundle,
  onAddToBundle,
  showTools = true,
}: QuickCardCheckProps) {
  const language = card.language ?? "en"
  const lookups = useMemo(() => [{ cardId: card.id, language }], [card.id, language])
  const { pricesByCardId, fxRates: hookRates, isLoading } = useRegionalCardPrices(lookups, true, pricingRegion)
  const snapshot = pricesByCardId[getCardPriceKey(card.id, language)]
  const fxRates = fxRatesProp ?? hookRates ?? null
  const context = useMemo(() => ({ currency, fxRates }), [currency, fxRates])
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  const { logPurchases, removePurchases } = useShowSession()

  const inferred = inferCardFinish(card.rarity, card.variants)
  const finishChoices = useMemo(() => getCardPickerFinishChoices(card.variants, inferred, "any"), [card.variants, inferred])
  const [finish, setFinish] = useState<CardFinish>(() =>
    initialFinish && finishChoices.some((choice) => choice.finish === initialFinish) ? initialFinish : finishChoices[0]?.finish ?? inferred)
  const [soldEvidence, setSoldEvidence] = useState<{ key: string; check: CardPriceCheck } | null>(null)
  const finishPrices = useMemo(() => getRegionalFinishPrices(snapshot, pricingRegion), [pricingRegion, snapshot])
  // A variant with its own quote uses it; otherwise the headline price stands for the card's main printing.
  const price = finishPrices[finish as PricedCardFinish] ?? (finishChoices.length === 0 || finish === finishChoices[0]?.finish ? snapshot : undefined)

  const comparisonKey = bundleKey(card, finish)
  const soldGuide = buildSoldPriceGuide(soldEvidence?.key === comparisonKey ? soldEvidence.check : null, price?.gbpAmount, finish, thresholds)
  const usesSoldGuide = soldGuide?.referenceGbp != null

  const toDisplay = useCallback((gbp: number | null | undefined) => (typeof gbp === "number" && gbp > 0 ? convertGbpForDisplay(gbp, context, snapshot) : null), [context, snapshot])
  const market = toDisplay(soldGuide?.referenceGbp ?? price?.gbpAmount)
  const low = toDisplay(usesSoldGuide ? soldGuide.q1 : price?.lowGbpAmount)
  const high = toDisplay(usesSoldGuide ? soldGuide.q3 : price?.highGbpAmount)
  const moneyCurrency = market?.currency ?? currency
  const money = (amount: number) => formatMoney(amount, moneyCurrency)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const dataAgeDays = getPriceDataAgeDays(usesSoldGuide ? soldEvidence?.check.checkedAt : price?.updatedAt ?? snapshot?.updatedAt, now)
  const isRising = !usesSoldGuide && Boolean(getRisingMomentum(snapshot, now))
  const cacheAge = formatPriceAge(snapshot?.fetchedAt, now)

  const [input, setInput] = useState("")
  const askingPrice = parseAskingPrice(input)
  const deal = askingPrice && market
    ? checkDeal({ askingPrice, marketPrice: market.amount, thresholds, confidence: usesSoldGuide ? "medium" : price?.confidence, dataAgeDays, isRising })
    : null

  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<{ message: string; run: () => Promise<void> } | null>(null)
  const run = async (action: QuickCardAction) => {
    if (busy) return
    setBusy(true)
    try {
      const revert = await onAction(action, finish)
      const purchaseIds = action === "bought" && askingPrice
        ? logPurchases([{ cardId: card.id, cardName: card.name, language, finish, price: askingPrice, marketPrice: market?.amount ?? null, currency: moneyCurrency }])
        : []
      navigator.vibrate?.(action === "bought" ? [12, 40, 12] : 15)
      const message = action === "bought"
        ? `Bought ${card.name}${askingPrice ? ` for ${money(askingPrice)}` : ""}`
        : action === "want" ? `${card.name} added to Wanted` : action === "got" ? `Got ${card.name}` : `${card.name} added to your binder`
      if (revert || purchaseIds.length > 0) {
        setUndo({
          message,
          run: async () => {
            if (purchaseIds.length > 0) removePurchases(purchaseIds)
            await revert?.()
          },
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const key = bundleKey(card, finish)
  const verdictEmptyText = market
    ? `Type the asking price. Pay up to ${money(market.amount * (1 + thresholds.fairPct / 100))}.`
    : isOnline
    ? "No market price for this card yet, so no verdict."
    : "This card's price isn't saved on this device, and prices can't be fetched offline. Check again when you have signal."
  const inBundle = isInBundle(key)
  const thumb = card.image ? toCardImageSrc(card.image.replace(/\/high\.webp$/, "/low.webp")) : null
  const statusLabel = state.owned ? "Owned" : state.wanted ? "Wanted" : "Not in binder"
  const statusTone = state.owned
    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
    : state.wanted ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground"
  const bigButton = "flex h-14 min-w-0 items-center justify-center gap-2 rounded-2xl px-3 text-base font-bold disabled:opacity-45"

  return (
    <section aria-label={`Check ${card.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="quick-card-check">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Back to results" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted/70">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="trading-card relative w-14 shrink-0 overflow-hidden bg-muted/50">
            {/* eslint-disable-next-line @next/next/no-img-element -- proxied card thumbnails, cached by the service worker */}
            {thumb && <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold leading-tight">{card.name}</h3>
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
              <button type="button" onClick={onOpenDetails} className="flex min-h-12 items-center gap-2 rounded-xl bg-primary/10 px-3 text-sm font-semibold text-primary">
                More details<ExternalLink className="h-3 w-3" aria-hidden />
              </button>
            </div>
          </div>
        </div>

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

        <div className="rounded-2xl border border-border/60 bg-card px-3 py-2" data-testid="quick-card-market">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {usesSoldGuide ? "Sold reference" : "Market"}{finishChoices.length > 0 ? ` · ${formatCardFinishLabel(finish)}` : ""}
            </span>
            <span className="text-2xl font-black tabular-nums" data-testid="quick-card-market-price">
              {market ? money(market.amount) : isLoading && isOnline ? "…" : isOnline ? "No price" : "Not available offline"}
            </span>
          </div>
          {usesSoldGuide ? <p className="text-xs text-muted-foreground">Recent sold median · {soldGuide.count} sales. Catalogue: {toDisplay(price?.gbpAmount) ? money(toDisplay(price?.gbpAmount)!.amount) : "unavailable"}.</p> : null}
          {(low || high) && (
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {low ? `Low ${money(low.amount)}` : ""}{low && high ? " · " : ""}{high ? `High ${money(high.amount)}` : ""}
            </p>
          )}
          {(cacheAge || !isOnline) && (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground" data-testid="quick-card-cache-age">
              {!isOnline && <WifiOff className="h-3 w-3" aria-hidden />}
              {cacheAge ? `${isOnline ? "Updated" : "Offline · saved price from"} ${cacheAge}` : "Offline · no saved price on this device"}
            </p>
          )}
        </div>

        <section aria-label="Catalog price sources" className="min-w-0 rounded-2xl border border-border/60 bg-card px-3 py-2">
          <h4 className="text-sm font-semibold">Catalog price sources · {formatCardFinishLabel(finish)}</h4>
          <p className="text-xs text-muted-foreground">Catalog quotes and averages, not sold records. Values in GBP, converted from the original source currency shown.</p>
          <CardPriceEvidence
            price={finishPrices[finish as PricedCardFinish]}
            emptyMessage="No catalog evidence saved for this finish."
          />
        </section>

        <CardPriceComparison key={`${card.id}:${language}:${finish}`} cardId={card.id} language={language} finish={finish} catalogMarketGbp={price?.gbpAmount} thresholds={thresholds} showBuyingScale={false} offerGbp={askingPrice && getGbpPerUnit(moneyCurrency, fxRates, snapshot) ? askingPrice * getGbpPerUnit(moneyCurrency, fxRates, snapshot)! : null} onSoldCheck={check => setSoldEvidence({ key: comparisonKey, check })} />

        <DealVerdictPanel deal={deal} money={money} emptyText={verdictEmptyText} />
      </div>

      {/* Short screens need room to scroll prices as well as reach the footer controls. */}
      <div className="max-h-[70%] min-h-0 min-w-0 shrink overflow-y-auto overscroll-contain scroll-pb-[calc(var(--safe-bottom)+0.75rem)] border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        {market ? <DealPriceScale market={market.amount} offer={askingPrice} overlap={soldGuide?.eligible && soldGuide.fairOverlap ? { low: toDisplay(soldGuide.fairOverlap.low)!.amount, high: toDisplay(soldGuide.fairOverlap.high)!.amount } : null} thresholds={thresholds} money={money} /> : null}
        <PinnedDealVerdict deal={deal} money={money} emptyText={verdictEmptyText} />
        {/* Show mode (and the Wanted price lookup) is about the asking price, so it opens the keyboard;
            plain Quick shows the price, verdict and Own / Want first, and Asking opens the keyboard on tap. */}
        <DealPriceInput value={input} onChange={setInput} autoFocus={showTools} />
        {(showTools || !readOnly) && (
        <div className={`grid ${readOnly ? "grid-cols-1" : "grid-cols-2"} gap-2 ${DEAL_HIDE_WHILE_TYPING}`}>
          {showTools && !readOnly && (
            <button type="button" disabled={busy} onClick={() => void run("bought")} className={`${bigButton} bg-primary text-primary-foreground`}>
              <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden />Bought
            </button>
          )}
          {!readOnly && (state.wanted && !state.owned ? (
            <button type="button" disabled={busy} onClick={() => void run("got")} aria-label="Mark got" className={`${bigButton} border border-border/70 bg-card`}>
              <Check className="h-5 w-5 shrink-0" aria-hidden />Got it
            </button>
          ) : (
            <button type="button" disabled={busy || state.owned} onClick={() => void run("add-owned")} aria-label={state.owned ? "Owned" : "Add owned"} className={`${bigButton} border border-border/70 bg-card`}>
              <Plus className="h-5 w-5 shrink-0" aria-hidden />{state.owned ? "Owned" : "Own"}
            </button>
          ))}
          {!readOnly && (
            <button type="button" disabled={busy || state.wanted || state.owned} onClick={() => void run("want")} aria-label="Want" className={`${bigButton} border border-border/70 bg-card`}>
              <Heart className="h-5 w-5 shrink-0" aria-hidden />Want
            </button>
          )}
          {showTools && (
          <button
            type="button"
            disabled={inBundle}
            onClick={() => {
              navigator.vibrate?.(10)
              onAddToBundle({ key, card, pokemon, finish, marketPrice: market?.amount ?? null, currency: moneyCurrency, catalogMarketGbp: price?.gbpAmount ?? null, gbpPerUnit: getGbpPerUnit(moneyCurrency, fxRates, snapshot), soldCheck: soldEvidence?.key === comparisonKey ? soldEvidence.check : undefined })
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

      {undo && (
        <UndoSnackbar
          message={undo.message}
          onUndo={() => {
            const current = undo
            setUndo(null)
            void current.run()
          }}
          onDismiss={() => setUndo(null)}
        />
      )}
    </section>
  )
}
