"use client"

import { useMemo, useState } from "react"
import { buildNativeAnalytics } from "@/lib/collection/native-analytics"
import { navigationIndex, type CollectionNavigationRead, type CollectionNavigationScope } from "@/lib/collection-navigation"
import { useInventoryPrices } from "@/hooks/use-inventory-prices"
import type { PricingRegion } from "@/lib/pricing-region"

type Props = { scope: CollectionNavigationScope; read: CollectionNavigationRead; collectionId?: string; region?: PricingRegion; compact?: boolean; onOpen?: () => void }
const money = (n: number | null) => n === null ? "Unknown" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n)

export default function NativeCollectionAnalytics(props: Props) {
  return <ScopedAnalytics key={JSON.stringify([props.scope, props.collectionId, props.compact])} {...props} />
}
function ScopedAnalytics({ scope, read, collectionId, region = "UK", compact, onOpen }: Props) {
  const [all, setAll] = useState(!collectionId)
  const [page, setPage] = useState(0)
  const selected = all ? undefined : collectionId
  const index = useMemo(() => navigationIndex(scope, read), [scope, read])
  const prices = useInventoryPrices(index.projection?.priceRequests ?? [])
  const summary = useMemo(() => buildNativeAnalytics(scope, read, selected, prices, region), [scope, read, selected, prices, region])
  if (!summary) return <section aria-label={compact ? "Storage dashboard" : "Collection analytics"} className="shrink-0 p-3" role="status">
    <h2>Storage totals unavailable</h2><p>A complete scoped inventory could not be loaded. This does not mean you own no cards.</p>
  </section>
  const currentPage = Math.min(page, Math.max(0, Math.ceil(summary.rows.length / 40) - 1))
  const saved = summary.kind === "cached"
  const value = <>
    <span className="block text-xl font-semibold tabular-nums">Saved raw value: {money(summary.rawValueGbp)}</span>
    <span className="block text-sm text-muted-foreground">{summary.pricedCopies} priced · {summary.unpricedRawCopies} raw unpriced · {summary.gradedUnknownCopies} graded {summary.gradedUnknownCopies === 1 ? "value" : "values"} unknown</span>
    <span className="block text-sm text-muted-foreground">{summary.physicalCopies} physical {summary.physicalCopies === 1 ? "copy" : "copies"} · {summary.uniqueSpecies} known species · {summary.actualSlots} actual slots</span>
    <span className="block text-sm text-muted-foreground">{summary.targetCount ? `${summary.completedTargets} / ${summary.targetCount} current targets complete` : "No current targets"} · {summary.explicitWants} explicit wants</span>
  </>
  const compactValue = <>
    <span className="block text-base font-semibold tabular-nums">Saved raw value: {money(summary.rawValueGbp)}</span>
    <span className="block text-xs text-muted-foreground">{summary.physicalCopies} physical {summary.physicalCopies === 1 ? "copy" : "copies"} · {summary.targetCount ? `${summary.completedTargets} / ${summary.targetCount} current targets complete` : "No current targets"}</span>
    <span className="block text-xs text-muted-foreground">{summary.pricedCopies} priced · {summary.unpricedRawCopies} raw unpriced · {summary.gradedUnknownCopies} graded {summary.gradedUnknownCopies === 1 ? "value" : "values"} unknown</span>
    {summary.pricedCopies > 0 && summary.pricedCopies < summary.physicalCopies && <span className="block text-xs text-muted-foreground">Partial estimate</span>}
  </>
  return <section aria-label={compact ? "Storage dashboard" : "Collection analytics"} className={compact ? "shrink-0 rounded-xl border border-border/60 p-3" : "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[var(--dock-clearance)]"}>
    {!compact && <><h1 className="text-2xl font-semibold">Collection analytics</h1><label className="my-3 block text-sm">Storage scope<select aria-label="Analytics storage scope" className="ml-2 min-h-9 max-w-full rounded-lg border bg-background p-2 text-base" value={all ? "all" : "selected"} onChange={e => { setAll(e.target.value === "all"); setPage(0) }}>
      {collectionId && <option value="selected">This storage</option>}<option value="all">All storage, including Unassigned</option>
    </select></label></>}
    {saved && <p role="status" className="mb-2 text-sm">Cached only. Last saved copies and targets, not your whole inventory. Current locations and uncached copies may be missing.</p>}
    {compact && onOpen ? <button type="button" aria-label="View storage value in Analytics" className="min-h-9 w-full text-left" onClick={onOpen}>{compactValue}</button> : value}
    {!compact && <>
      <p className="mt-3 text-sm text-muted-foreground">{summary.rawValueGbp !== null && summary.pricedCopies < summary.physicalCopies ? "Partial estimate. " : ""}Saved exact-finish evidence only, medium or high confidence. Unpriced and graded copies are excluded. No automatic price refresh.</p>
      <p className="text-sm text-muted-foreground">{summary.oldestQuoteAt ? `Oldest included quote: ${summary.oldestQuoteAt.slice(0, 10)}.` : "No reliable saved quotes."} Prices remain usable in this mounted view offline; reopening may leave prices unknown.</p>
      {summary.unknownSpeciesCopies > 0 && <p className="mt-2 text-sm">{summary.unknownSpeciesCopies} copies have unknown species metadata.</p>}
      {summary.unknownTargets > 0 && <p className="text-sm">{summary.unknownTargets} placed target matches have unknown catalog evidence.</p>}
      <section aria-label="Current target completion" className="mt-6 border-t pt-4"><h2 className="font-semibold">Current targets</h2><ul>{summary.goals.map(g => <li key={g.collectionId} className="break-words py-2 text-sm">{g.name}: {g.targetCount ? `${g.completedTargetCount} / ${g.targetCount} complete` : "No current targets"} · {g.assignedCount} placed copies · {g.slots} slots</li>)}</ul>
        <p className="text-sm text-muted-foreground">Targets, spacers and wants do not create ownership. Completion follows the current targets in each storage.</p></section>
      <section aria-label="Saved copy values" className="mt-6 border-t pt-4"><h2 className="font-semibold">Owned copies</h2><ul>{summary.rows.slice(currentPage * 40, (currentPage + 1) * 40).map(row => {
        const copy = summary.copies.find(c => c.itemId === row.itemId)!
        return <li key={row.itemId} className="break-words border-b py-3 text-sm"><p className="font-medium">{row.name ?? (row.speciesNames.join(", ") || "Unknown card")}</p>
          <p>{row.language ?? "Language unknown"} · {row.finish ?? "Finish unknown"} · {row.graded ? "Graded value unknown" : `Saved raw value: ${money(copy.amountGbp)}`}</p>
          <p className="text-muted-foreground">Copy {row.itemId} · {saved ? "Last saved: " : ""}{row.location.kind === "assigned" ? row.location.collectionName : row.location.kind === "unassigned" ? "Unassigned" : "Location unavailable"}</p>
          {copy.quote && <p className="text-muted-foreground">{copy.quote.confidence} confidence · {copy.quote.updatedAt?.slice(0, 10) ?? "Date unknown"}{copy.basis === "raw-reference" ? " · Raw reference excluded from graded value" : ""}</p>}</li>
      })}</ul><div className="flex gap-4 py-2">{currentPage > 0 && <button className="min-h-9 underline" onClick={() => setPage(currentPage - 1)}>Previous copies</button>}{summary.rows.length > (currentPage + 1) * 40 && <button className="min-h-9 underline" onClick={() => setPage(currentPage + 1)}>Next copies</button>}</div></section>
      <p className="mt-4 text-sm text-muted-foreground">Native activity and acquisition summaries are not included here. Frozen legacy history is not counted.</p>
    </>}
  </section>
}
