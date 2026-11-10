"use client"

// Show mode's bundle check: several cards for one asking total ("all three for £20"), judged against their
// combined market price. "Bought bundle" adds every card as owned and logs the total, split by market price.
import { nativeCardConsumers, nativeCardState, nativeCardLabel, type NativeConsumerBinding } from "@/lib/collection/native-card-consumers"
import { useBillingContext } from "@/hooks/use-billing"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ShoppingBag, Trash2, X } from "lucide-react"
import ShowBudget from "@/components/show-budget"
import { checkBundle, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
import { requestCardPriceCheck } from "@/lib/card-price-check-client"
import type { CardPriceCheck, CardPriceChecks, PriceCheckSource } from "@/lib/card-price-checks"
import { buildBundlePriceGuide } from "@/lib/bundle-price-guide"
import { PriceCheckRecords } from "@/components/price-check-records"
import { DealPriceScale } from "@/components/deal-price-scale"
import { formatMoney } from "@/lib/regional-price"
import { formatCardNumber } from "@/lib/pokemon-card-browse"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { DisplayCurrency } from "@/lib/pricing-region"
import { DEAL_HIDE_WHILE_TYPING, DealPriceInput, DealVerdictPanel, PinnedDealVerdict } from "@/components/deal-keypad"
import type { QuickCardState, QuickBundleEntry, QuickCardAction } from "@/components/quick-card-check"

export interface QuickBundleProps {
  nativeConsumer?: NativeConsumerBinding
  entries: QuickBundleEntry[]
  budgetKey?: string | null
  destinationName?: string
  getCardState?: (entry: QuickBundleEntry) => QuickCardState
  currency: DisplayCurrency
  readOnly?: boolean
  onBack: () => void
  onRemove: (key: string) => void
  onClear: () => void
  onSoldCheck: (key: string, check: CardPriceCheck) => void
  onAction: (action: QuickCardAction, entry: QuickBundleEntry) => Promise<void>
}

export default function QuickBundle({ nativeConsumer, budgetKey, entries, destinationName = "this binder", getCardState, currency, readOnly = false, onBack, onRemove, onClear, onAction, onSoldCheck }: QuickBundleProps) {
  const nativeModel = useMemo(() => nativeConsumer ? nativeCardConsumers(nativeConsumer) : null, [nativeConsumer])
  const comparisonOnly = Boolean(nativeConsumer) || readOnly
  const billing = useBillingContext()
  const premium = billing?.premium !== false
  const states = entries.map(entry => getCardState?.(entry))
  const replacementKey = JSON.stringify(entries.map((entry, index) => [entry.key, states[index]?.replacing]))
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null)
  const replacing = states.some(state => state?.replacing)
  const needsConfirmation = replacing && confirmedReplacement !== replacementKey
  const repeatedSlot = new Set(entries.map(entry => entry.pokemon.id)).size !== entries.length
  const alreadyOwned = states.some(state => state?.owned)
  const [input, setInput] = useState("")
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  const moneyCurrency = entries[0]?.currency ?? currency
  const money = useCallback((amount: number) => formatMoney(amount, moneyCurrency), [moneyCurrency])
  const askingTotal = parseAskingPrice(input)
  const [now, setNow] = useState(() => Date.now())
  const native = Boolean(nativeConsumer)
  useEffect(() => {
    if (!native) return
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh) }
  }, [native])
  const guide = useMemo(() => buildBundlePriceGuide(entries, moneyCurrency, thresholds, native ? now : undefined, premium, native), [entries, moneyCurrency, thresholds, premium, native, now])
  const pricedEntries = entries.map((entry, index) => ({ ...entry, marketPrice: guide.items[index].marketPrice }))
  const result = checkBundle(pricedEntries, askingTotal, thresholds, Boolean(nativeConsumer))
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const [checking, setChecking] = useState(false)
  const [checks, setChecks] = useState<Record<string, CardPriceChecks>>({})
  const [pending, setPending] = useState<Record<string, Partial<Record<PriceCheckSource, boolean>>>>({})
  const [error, setError] = useState<string | null>(null)
  async function checkPrices() {
    if (nativeConsumer) return
    if (!premium) { billing?.upgrade(); return }
    if (checking) return
    if (!navigator.onLine) { setError("Connect to the internet to check prices."); return }
    setError(null)
    setChecking(true)
    const abort = new AbortController()
    controller.current = abort
    const supported = entries.filter(entry => (entry.card.language ?? "en") === "en" && entry.finish !== "jumbo")
    setPending(Object.fromEntries(supported.map(entry => [entry.key, { ebay: true, soldcomps: true }])))
    let cursor = 0
    async function worker() {
      while (cursor < supported.length && !abort.signal.aborted) {
        const entry = supported[cursor++]
        await Promise.all((["ebay", "soldcomps"] as const).map(async source => {
          try {
            const { check, error } = await requestCardPriceCheck(entry.card.id, entry.card.language ?? "en", entry.finish, source, abort.signal)
            if (abort.signal.aborted) return
            setChecks(previous => ({ ...previous, [entry.key]: { ...(previous[entry.key] ?? { ebay: null, soldcomps: null }), [source]: check, errors: { ...previous[entry.key]?.errors, [source]: error } } }))
            if (source === "soldcomps" && check) onSoldCheck(entry.key, check)
          } catch (failure) {
            if (abort.signal.aborted) return
            const message = failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "Price check timed out. Try again later."
            setChecks(previous => ({ ...previous, [entry.key]: { ...(previous[entry.key] ?? { ebay: null, soldcomps: null }), errors: { ...previous[entry.key]?.errors, [source]: message } } }))
          } finally {
            if (!abort.signal.aborted) setPending(previous => ({ ...previous, [entry.key]: { ...previous[entry.key], [source]: false } }))
          }
        }))
      }
    }
    await Promise.all([worker(), worker()])
    if (!abort.signal.aborted) setChecking(false)
  }
  const buyAll = async () => {
    if (comparisonOnly || entries.length === 0 || needsConfirmation || repeatedSlot || alreadyOwned) return
    // Only guests reach Buy here (native hosts are read-only); the host asks them to join.
    await onAction("bought", pricedEntries[0])
  }

  const verdictEmptyText = nativeConsumer && !guide.complete
    ? "Incomplete price evidence. Every selected printing needs a saved reference in the same currency, so no bundle verdict."
    : result.marketTotal > 0
    ? `Type the asking total. Pay up to ${money(result.marketTotal * (1 + thresholds.fairPct / 100))}.`
    : "No market prices for these cards yet."

  return (
    <section aria-label="Bundle" className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="quick-bundle">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back to results" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted/70">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight">Bundle · {entries.length} card{entries.length === 1 ? "" : "s"}</h3>
            <p className="text-xs text-muted-foreground" data-testid="bundle-market-total">
              {nativeConsumer && !guide.complete ? "Saved subtotal" : "Reference"} {money(result.marketTotal)}{result.unpricedCount > 0 ? ` · ${result.unpricedCount} unpriced` : ""}
            </p>
          </div>
          {entries.length > 0 && (
            <button type="button" onClick={onClear} aria-label="Clear bundle" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        {nativeConsumer ? <section aria-label="Bundle comparison" className="rounded-xl border border-border/60 p-3 text-sm">
          <p className="font-semibold">Read-only comparison</p>
          <p>{nativeModel?.kind === "cached" ? "Cached only, read-only" : nativeModel ? "Saved scoped inventory" : "Ownership unavailable"}. Selected printings are lookups, not copies to acquire.</p>
        </section> : <section aria-label="Bundle destination" className="rounded-xl border border-border/60 p-3 text-sm">
          <p className="font-semibold">Adds to {destinationName}</p>
          {entries.map((entry, index) => states[index]?.ownedElsewhere?.length ? <p key={entry.key}>{entry.card.name}: already owned in {states[index]!.ownedElsewhere!.join(", ")}</p> : null)}
          {states.some(state => state?.otherBindersIncomplete) && <p>Other binders haven&apos;t all loaded. Duplicate check is incomplete.</p>}
          {repeatedSlot && <p role="status">Only one printing per Pokémon fits in this binder. Remove the extra printings before buying.</p>}
          {alreadyOwned && <p role="status">A card is already in this binder. Remove it from the bundle before buying.</p>}
          {replacing && <label className="mt-2 flex min-h-10 items-center gap-2"><input type="checkbox" checked={!needsConfirmation} onChange={event => setConfirmedReplacement(event.target.checked ? replacementKey : null)} /><span>Replace {states.filter(state => state?.replacing).map(state => state!.replacing).join(", ")} in {destinationName}</span></label>}
        </section>}
        <ul className="flex flex-col gap-1" aria-label="Cards in bundle">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex min-h-12 items-center gap-2 rounded-xl border border-border/50 bg-card pl-3 pr-1">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{entry.card.name}</span>
                {nativeConsumer && <span className="block text-xs text-muted-foreground">{nativeCardLabel(nativeCardState(nativeModel, entry.card, entry.finish))}</span>}
                <span className="block text-[10px] text-muted-foreground">{guide.items[index].source === "sold" ? "Sold reference" : guide.items[index].source === "catalogue" ? "Catalogue reference" : guide.items[index].source === "saved" ? "Saved reference" : "No reference"}</span>
                <span className="block text-[10px] text-muted-foreground" aria-live="polite">{(["ebay", "soldcomps"] as const).map(source => {
                  const label = source === "ebay" ? "eBay" : "Sold"
                  if (!premium) return null
                  const check = checks[entry.key]?.[source]
                  return <span key={source} className="mr-2 inline-block">{pending[entry.key]?.[source] ? `${label}: checking…` : checks[entry.key]?.errors[source] ? `${label}: ${checks[entry.key].errors[source]}` : check ? `${label}: ${check.summary.count} matches` : ""}</span>
                })}</span>
                {(entry.card.language ?? "en") !== "en" || entry.finish === "jumbo" ? <span className="block text-[10px] text-muted-foreground">Provider checks unavailable for this printing</span> : null}
                <span className="block truncate text-[11px] text-muted-foreground">
                  {entry.card.set.name} · {formatCardNumber(entry.card)}{nativeConsumer ? ` · ${entry.card.language ?? "Unknown language"}` : ""} · {formatCardFinishLabel(entry.finish)}
                </span>
                {premium && <PriceCheckRecords checks={checks[entry.key]} />}
              </div>
              <span className="text-sm font-bold tabular-nums">{guide.items[index].marketPrice !== null ? money(guide.items[index].marketPrice!) : "No price"}</span>
              <button type="button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.card.name} from bundle`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="px-1 py-4 text-center text-sm text-muted-foreground">Add cards with Bundle on each card&apos;s check.</li>}
        </ul>

        {!nativeConsumer && <><button type="button" onClick={() => void checkPrices()} disabled={checking || entries.length === 0} className="min-h-14 rounded-2xl border border-primary/40 bg-primary/10 px-4 text-base font-semibold disabled:opacity-50">{!premium ? "Unlock bundle comparisons" : checking ? "Checking bundle prices…" : "Check bundle prices"}</button>
        <p className="text-[11px] text-muted-foreground">Checks each English card and finish, reuses saved results until you refresh them on the card. {guide.items.filter(item => item.source === "sold").length} of {entries.length} use qualified sold evidence.</p></>}
        {nativeConsumer && <p className="text-[11px] text-muted-foreground">Saved price evidence only. No provider checks, purchase recording or ownership changes. Each selected entry counts once, including repeated printings.</p>}
        {error ? <p role="status" className="text-xs text-muted-foreground">{error}</p> : null}
        <DealVerdictPanel deal={result.deal} money={money} testId="bundle-verdict" emptyText={verdictEmptyText} />
      </div>

      <div className="min-w-0 shrink-0 border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        {guide.marketTotal > 0 && (!nativeConsumer || guide.complete) ? <DealPriceScale market={guide.marketTotal} offer={askingTotal} overlap={guide.overlap} thresholds={thresholds} money={money} partial={!guide.complete} /> : null}
        <PinnedDealVerdict deal={result.deal} money={money} testId="bundle-verdict-pinned" emptyText={verdictEmptyText} />
        {!nativeConsumer && budgetKey && <ShowBudget compact storageKey={budgetKey} currency={moneyCurrency} />}
        <DealPriceInput value={input} onChange={setInput} label="Bundle price" />
        {!comparisonOnly && (
          <button
            type="button"
            disabled={entries.length === 0 || needsConfirmation || repeatedSlot || alreadyOwned}
            onClick={() => void buyAll()}
            className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground disabled:opacity-45 ${DEAL_HIDE_WHILE_TYPING}`}
          >
            <ShoppingBag className="h-5 w-5" aria-hidden />Bought bundle
          </button>
        )}
      </div>
    </section>
  )
}
