"use client"

import { useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { buildCollectionAnalytics } from "@/lib/collection-analytics"
import type { CardPriceSnapshot } from "@/lib/card-pricing"
import type { CollectedPokemon } from "@/lib/domain/cards"

export function BinderValue({ collection, prices, loading, onOpen }: {
  collection: CollectedPokemon[]
  prices: Record<string, CardPriceSnapshot>
  loading: boolean
  onOpen: () => void
}) {
  const summary = useMemo(() => buildCollectionAnalytics(collection, prices, undefined, { source: "cardmarket" }), [collection, prices])
  return <button type="button" aria-label="View binder value in Analytics" onClick={onOpen} className="mb-2 flex min-h-14 w-full shrink-0 items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/70 px-3 py-2 text-left">
    <span className="min-w-0"><span className="block text-sm font-medium">Binder value <span className="ml-1 text-lg font-semibold tabular-nums">{summary.pricedCards ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(summary.valueGbp) : loading ? "Loading…" : "Unknown"}</span></span>
      <span className="block text-xs text-muted-foreground">Cardmarket · {summary.pricedCards} of {summary.assignedCards} owned cards priced{summary.pricedCards < summary.assignedCards ? " · partial estimate" : ""}</span>
      {summary.oldestQuoteAt && <span className="block text-xs text-muted-foreground">Oldest quote {new Date(summary.oldestQuoteAt).toLocaleDateString("en-GB")}{summary.staleCards > 0 ? ` · ${summary.staleCards} stale` : ""}</span>}</span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </button>
}
