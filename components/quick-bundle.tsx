"use client"

// Show mode's bundle check: several cards for one asking total ("all three for £20"), judged against their
// combined market price. "Bought bundle" adds every card as owned and logs the total, split by market price.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ShoppingBag, Trash2, X } from "lucide-react"
import { useShowSession } from "@/hooks/use-show-session"
import { checkBundle, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
import { requestCardPriceCheck } from "@/lib/card-price-check-client"
import type { CardPriceCheck, CardPriceChecks, PriceCheckSource } from "@/lib/card-price-checks"
import { buildBundlePriceGuide } from "@/lib/bundle-price-guide"
import { DealPriceScale } from "@/components/deal-price-scale"
import { splitBundlePrice } from "@/lib/show-session"
import { formatMoney } from "@/lib/regional-price"
import { formatCardNumber } from "@/lib/pokemon-card-browse"
import { formatCardFinishLabel } from "@/lib/card-labels"
import type { DisplayCurrency } from "@/lib/pricing-region"
import UndoSnackbar from "@/components/undo-snackbar"
import { DEAL_HIDE_WHILE_TYPING, DealKeypad, DealVerdictPanel, PinnedDealVerdict } from "@/components/deal-keypad"
import type { QuickBundleEntry, QuickCardAction } from "@/components/quick-card-check"

export interface QuickBundleProps {
  entries: QuickBundleEntry[]
  currency: DisplayCurrency
  readOnly?: boolean
  onBack: () => void
  onRemove: (key: string) => void
  onClear: () => void
  onSoldCheck: (key: string, check: CardPriceCheck) => void
  onAction: (action: QuickCardAction, entry: QuickBundleEntry) => Promise<(() => Promise<void>) | null>
}

export default function QuickBundle({ entries, currency, readOnly = false, onBack, onRemove, onClear, onAction, onSoldCheck }: QuickBundleProps) {
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
  const [undo, setUndo] = useState<{ message: string; run: () => Promise<void> } | null>(null)

  const buyAll = async () => {
    if (busy || entries.length === 0) return
    setBusy(true)
    try {
      const bought = [...pricedEntries]
      const reverts: Array<() => Promise<void>> = []
      for (const entry of bought) {
        const revert = await onAction("bought", entry)
        if (revert) reverts.push(revert)
      }
      const bundleId = `b-${Date.now().toString(36)}`
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
      setUndo({
        message: `Bought ${bought.length} card${bought.length === 1 ? "" : "s"}${askingTotal ? ` for ${money(askingTotal)}` : ""}`,
        run: async () => {
          removePurchases(ids)
          // Undo in reverse so cards for the same Pokémon unwind to where they started.
          for (const revert of reverts.reverse()) await revert()
        },
      })
    } finally {
      setBusy(false)
    }
  }

  const verdictEmptyText = result.marketTotal > 0
    ? `Type the asking total. Pay up to ${money(result.marketTotal * (1 + thresholds.fairPct / 100))}.`
    : "No market prices for these cards yet."

  return (
    <section aria-label="Bundle" className="flex min-h-0 flex-1 flex-col" data-testid="quick-bundle">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-3 pb-3 pt-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} aria-label="Back to results" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted/70">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight">Bundle · {entries.length} card{entries.length === 1 ? "" : "s"}</h3>
            <p className="text-xs text-muted-foreground" data-testid="bundle-market-total">
              Reference {money(result.marketTotal)}{result.unpricedCount > 0 ? ` · ${result.unpricedCount} unpriced` : ""}
            </p>
          </div>
          {entries.length > 0 && (
            <button type="button" onClick={onClear} aria-label="Clear bundle" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-1" aria-label="Cards in bundle">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex min-h-12 items-center gap-2 rounded-xl border border-border/50 bg-card pl-3 pr-1">
              <span className="min-w-0 flex-1">
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
              </span>
              <span className="text-sm font-bold tabular-nums">{guide.items[index].marketPrice !== null ? money(guide.items[index].marketPrice!) : "No price"}</span>
              <button type="button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.card.name} from bundle`} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="px-1 py-4 text-center text-sm text-muted-foreground">Add cards with Bundle on each card&apos;s check.</li>}
        </ul>

        <button type="button" onClick={() => void checkPrices()} disabled={checking || busy || entries.length === 0} className="min-h-10 rounded-xl border border-border px-3 text-sm font-semibold disabled:opacity-50">{checking ? "Checking bundle prices…" : "Check bundle prices"}</button>
        <p className="text-[11px] text-muted-foreground">Checks each English card and finish, reuses saved results for 12 hours. {guide.items.filter(item => item.source === "sold").length} of {entries.length} use qualified sold evidence.</p>
        {error ? <p role="status" className="text-xs text-muted-foreground">{error}</p> : null}
        <DealVerdictPanel deal={result.deal} money={money} testId="bundle-verdict" emptyText={verdictEmptyText} />
      </div>

      <div className="shrink-0 border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        <PinnedDealVerdict deal={result.deal} money={money} testId="bundle-verdict-pinned" emptyText={verdictEmptyText} />
        {guide.marketTotal > 0 ? <DealPriceScale market={guide.marketTotal} offer={askingTotal} overlap={guide.overlap} thresholds={thresholds} money={money} partial={!guide.complete} /> : null}
        <DealKeypad value={input} onChange={setInput} label="Bundle price" />
        {!readOnly && (
          <button
            type="button"
            disabled={busy || entries.length === 0}
            onClick={() => void buyAll()}
            className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-45 ${DEAL_HIDE_WHILE_TYPING}`}
          >
            <ShoppingBag className="h-5 w-5" aria-hidden />Bought bundle
          </button>
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
