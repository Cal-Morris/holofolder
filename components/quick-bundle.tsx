"use client"

// Show mode's bundle check: several cards for one asking total ("all three for £20"), judged against their
// combined market price. "Bought bundle" adds every card as owned and logs the total, split by market price.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ShoppingBag, Trash2, X } from "lucide-react"
import ShowBudget from "@/components/show-budget"
import { useShowSession } from "@/hooks/use-show-session"
import { checkBundle, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
import { requestCardPriceCheck } from "@/lib/card-price-check-client"
import type { CardPriceCheck, CardPriceChecks, PriceCheckSource } from "@/lib/card-price-checks"
import { buildBundlePriceGuide } from "@/lib/bundle-price-guide"
import { PriceCheckRecords } from "@/components/price-check-records"
import { DealPriceScale } from "@/components/deal-price-scale"
import { splitBundlePrice } from "@/lib/show-session"
import { formatMoney } from "@/lib/regional-price"
import { formatCardNumber } from "@/lib/pokemon-card-browse"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { DisplayCurrency } from "@/lib/pricing-region"
import type { UndoAction } from "@/components/undo-snackbar"
import { DEAL_HIDE_WHILE_TYPING, DealPriceInput, DealVerdictPanel, PinnedDealVerdict } from "@/components/deal-keypad"
import type { QuickCardState, QuickBundleEntry, QuickCardAction } from "@/components/quick-card-check"

export interface QuickBundleProps {
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
  onUndoAvailable: (action: UndoAction) => void
  onAction: (action: QuickCardAction, entry: QuickBundleEntry) => Promise<(() => Promise<void>) | null>
}

export default function QuickBundle({ budgetKey, entries, destinationName = "this binder", getCardState, currency, readOnly = false, onBack, onRemove, onClear, onAction, onSoldCheck, onUndoAvailable }: QuickBundleProps) {
  const states = entries.map(entry => getCardState?.(entry))
  const replacementKey = JSON.stringify(entries.map((entry, index) => [entry.key, states[index]?.replacing]))
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null)
  const replacing = states.some(state => state?.replacing)
  const needsConfirmation = replacing && confirmedReplacement !== replacementKey
  const repeatedSlot = new Set(entries.map(entry => entry.pokemon.id)).size !== entries.length
  const alreadyOwned = states.some(state => state?.owned)
  const [input, setInput] = useState("")
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  const { logPurchases, removePurchases } = useShowSession()
  const moneyCurrency = entries[0]?.currency ?? currency
  const money = useCallback((amount: number) => formatMoney(amount, moneyCurrency), [moneyCurrency])
  const askingTotal = parseAskingPrice(input)
  const guide = useMemo(() => buildBundlePriceGuide(entries, moneyCurrency, thresholds), [entries, moneyCurrency, thresholds])
  const pricedEntries = entries.map((entry, index) => ({ ...entry, marketPrice: guide.items[index].marketPrice }))
  const result = checkBundle(pricedEntries, askingTotal, thresholds)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const [checking, setChecking] = useState(false)
  const [checks, setChecks] = useState<Record<string, CardPriceChecks>>({})
  const [pending, setPending] = useState<Record<string, Partial<Record<PriceCheckSource, boolean>>>>({})
  const [error, setError] = useState<string | null>(null)
  async function checkPrices() {
    if (checking || busy) return
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
  const [busy, setBusy] = useState(false)

  const buyAll = async (bundleId: string) => {
    if (busy || entries.length === 0 || needsConfirmation || repeatedSlot || alreadyOwned) return
    setBusy(true)
    const reverts: Array<() => Promise<void>> = []
    try {
      const bought = [...pricedEntries]
      for (const entry of bought) {
        const revert = await onAction("bought", entry)
        if (!revert) {
          throw new Error("A card could not be added")
        }
        reverts.push(revert)
      }
      const prices = askingTotal ? splitBundlePrice(askingTotal, bought.map((entry) => entry.marketPrice)) : []
      const ids = askingTotal
        ? logPurchases(bought.map((entry, index) => ({
          cardId: entry.card.id,
          cardName: entry.card.name,
          language: entry.card.language ?? "en",
          finish: entry.finish,
          price: prices[index],
          marketPrice: entry.marketPrice,
          currency: moneyCurrency,
          bundleId,
        })))
        : []
      navigator.vibrate?.([12, 40, 12])
      onClear()
      setInput("")
      onUndoAvailable({
        message: `Bought ${bought.length} card${bought.length === 1 ? "" : "s"}${askingTotal ? ` for ${money(askingTotal)}` : ""}`,
        run: async () => {
          // Undo in reverse so cards for the same Pokémon unwind to where they started.
          for (const revert of [...reverts].reverse()) await revert()
          removePurchases(ids)
        },
      })
    } catch {
      for (const revert of [...reverts].reverse()) {
        try { await revert() } catch { /* Keep unwinding the other cards. */ }
      }
      setError("Could not buy the bundle. Check your binder and try again.")
    } finally {
      setBusy(false)
    }
  }

  const verdictEmptyText = result.marketTotal > 0
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
              Reference {money(result.marketTotal)}{result.unpricedCount > 0 ? ` · ${result.unpricedCount} unpriced` : ""}
            </p>
          </div>
          {entries.length > 0 && (
            <button type="button" onClick={onClear} aria-label="Clear bundle" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        <section aria-label="Bundle destination" className="rounded-xl border border-border/60 p-3 text-sm">
          <p className="font-semibold">Adds to {destinationName}</p>
          {entries.map((entry, index) => states[index]?.ownedElsewhere?.length ? <p key={entry.key}>{entry.card.name}: already owned in {states[index]!.ownedElsewhere!.join(", ")}</p> : null)}
          {states.some(state => state?.otherBindersIncomplete) && <p>Other binders haven&apos;t all loaded. Duplicate check is incomplete.</p>}
          {repeatedSlot && <p role="status">Only one printing per Pokémon fits in this binder. Remove the extra printings before buying.</p>}
          {alreadyOwned && <p role="status">A card is already in this binder. Remove it from the bundle before buying.</p>}
          {replacing && <label className="mt-2 flex min-h-10 items-center gap-2"><input type="checkbox" checked={!needsConfirmation} onChange={event => setConfirmedReplacement(event.target.checked ? replacementKey : null)} /><span>Replace {states.filter(state => state?.replacing).map(state => state!.replacing).join(", ")} in {destinationName}</span></label>}
        </section>
        <ul className="flex flex-col gap-1" aria-label="Cards in bundle">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex min-h-12 items-center gap-2 rounded-xl border border-border/50 bg-card pl-3 pr-1">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{entry.card.name}</span>
                <span className="block text-[10px] text-muted-foreground">{guide.items[index].source === "sold" ? "Sold reference" : guide.items[index].source === "catalogue" ? "Catalogue reference" : guide.items[index].source === "saved" ? "Saved reference" : "No reference"}</span>
                <span className="block text-[10px] text-muted-foreground" aria-live="polite">{(["ebay", "soldcomps"] as const).map(source => {
                  const label = source === "ebay" ? "eBay" : "Sold"
                  const check = checks[entry.key]?.[source]
                  return <span key={source} className="mr-2 inline-block">{pending[entry.key]?.[source] ? `${label}: checking…` : checks[entry.key]?.errors[source] ? `${label}: ${checks[entry.key].errors[source]}` : check ? `${label}: ${check.summary.count} matches` : ""}</span>
                })}</span>
                {(entry.card.language ?? "en") !== "en" || entry.finish === "jumbo" ? <span className="block text-[10px] text-muted-foreground">Provider checks unavailable for this printing</span> : null}
                <span className="block truncate text-[11px] text-muted-foreground">
                  {entry.card.set.name} · {formatCardNumber(entry.card)} · {formatCardFinishLabel(entry.finish)}
                </span>
                <PriceCheckRecords checks={checks[entry.key]} />
              </div>
              <span className="text-sm font-bold tabular-nums">{guide.items[index].marketPrice !== null ? money(guide.items[index].marketPrice!) : "No price"}</span>
              <button type="button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.card.name} from bundle`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="px-1 py-4 text-center text-sm text-muted-foreground">Add cards with Bundle on each card&apos;s check.</li>}
        </ul>

        <button type="button" onClick={() => void checkPrices()} disabled={checking || busy || entries.length === 0} className="min-h-14 rounded-2xl border border-primary/40 bg-primary/10 px-4 text-base font-semibold disabled:opacity-50">{checking ? "Checking bundle prices…" : "Check bundle prices"}</button>
        <p className="text-[11px] text-muted-foreground">Checks each English card and finish, reuses saved results for 12 hours. {guide.items.filter(item => item.source === "sold").length} of {entries.length} use qualified sold evidence.</p>
        {error ? <p role="status" className="text-xs text-muted-foreground">{error}</p> : null}
        <DealVerdictPanel deal={result.deal} money={money} testId="bundle-verdict" emptyText={verdictEmptyText} />
      </div>

      <div className="min-w-0 shrink-0 border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        {guide.marketTotal > 0 ? <DealPriceScale market={guide.marketTotal} offer={askingTotal} overlap={guide.overlap} thresholds={thresholds} money={money} partial={!guide.complete} /> : null}
        <PinnedDealVerdict deal={result.deal} money={money} testId="bundle-verdict-pinned" emptyText={verdictEmptyText} />
        {budgetKey && <ShowBudget compact storageKey={budgetKey} currency={moneyCurrency} />}
        <DealPriceInput value={input} onChange={setInput} label="Bundle price" />
        {!readOnly && (
          <button
            type="button"
            disabled={busy || entries.length === 0 || needsConfirmation || repeatedSlot || alreadyOwned}
            onClick={() => void buyAll(`b-${Date.now().toString(36)}`)}
            className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground disabled:opacity-45 ${DEAL_HIDE_WHILE_TYPING}`}
          >
            <ShoppingBag className="h-5 w-5" aria-hidden />Bought bundle
          </button>
        )}
      </div>
    </section>
  )
}
