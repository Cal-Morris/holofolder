"use client"

// Show mode's bundle check: several cards for one asking total ("all three for £20"), judged against their
// combined market price. "Bought bundle" adds every card as owned and logs the total, split by market price.
import { useCallback, useMemo, useState } from "react"
import { ArrowLeft, ShoppingBag, Trash2, X } from "lucide-react"
import { useShowSession } from "@/hooks/use-show-session"
import { checkBundle, parseAskingPrice, readDealThresholds } from "@/lib/deal-check"
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
  onAction: (action: QuickCardAction, entry: QuickBundleEntry) => Promise<(() => Promise<void>) | null>
}

export default function QuickBundle({ entries, currency, readOnly = false, onBack, onRemove, onClear, onAction }: QuickBundleProps) {
  const [input, setInput] = useState("")
  const [thresholds] = useState(() => readDealThresholds(typeof window === "undefined" ? undefined : window.localStorage))
  const { logPurchases, removePurchases } = useShowSession()
  const moneyCurrency = entries[0]?.currency ?? currency
  const money = useCallback((amount: number) => formatMoney(amount, moneyCurrency), [moneyCurrency])
  const askingTotal = parseAskingPrice(input)
  const result = useMemo(() => checkBundle(entries, askingTotal, thresholds), [askingTotal, entries, thresholds])
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<{ message: string; run: () => Promise<void> } | null>(null)

  const buyAll = async () => {
    if (busy || entries.length === 0) return
    setBusy(true)
    try {
      const bought = [...entries]
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
              Market {money(result.marketTotal)}{result.unpricedCount > 0 ? ` · ${result.unpricedCount} unpriced` : ""}
            </p>
          </div>
          {entries.length > 0 && (
            <button type="button" onClick={onClear} aria-label="Clear bundle" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>

        <ul className="flex flex-col gap-1" aria-label="Cards in bundle">
          {entries.map((entry) => (
            <li key={entry.key} className="flex min-h-12 items-center gap-2 rounded-xl border border-border/50 bg-card pl-3 pr-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{entry.card.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {entry.card.set.name} · {formatCardNumber(entry.card)} · {formatCardFinishLabel(entry.finish)}
                </span>
              </span>
              <span className="text-sm font-bold tabular-nums">{entry.marketPrice !== null ? money(entry.marketPrice) : "No price"}</span>
              <button type="button" onClick={() => onRemove(entry.key)} aria-label={`Remove ${entry.card.name} from bundle`} className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="px-1 py-4 text-center text-sm text-muted-foreground">Add cards with Bundle on each card&apos;s check.</li>}
        </ul>

        <DealVerdictPanel deal={result.deal} money={money} testId="bundle-verdict" emptyText={verdictEmptyText} />
      </div>

      <div className="shrink-0 border-t border-border/50 bg-card/95 px-3 pb-[calc(var(--safe-bottom)+0.75rem)] pt-2">
        <PinnedDealVerdict deal={result.deal} money={money} testId="bundle-verdict-pinned" emptyText={verdictEmptyText} />
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
