"use client"

import { useMemo } from "react"
import { ChevronRight, X } from "lucide-react"
import { buildCollectionAnalytics } from "@/lib/collection-analytics"
import type { CardPriceSnapshot } from "@/lib/card-pricing"
import type { CollectedPokemon } from "@/lib/domain/cards"

export function BinderValue({ collection, prices, loading, onOpen, onDismiss }: {
  collection: CollectedPokemon[]
  prices: Record<string, CardPriceSnapshot>
  loading: boolean
  onOpen: () => void
  onDismiss: () => void
}) {
  const summary = useMemo(() => buildCollectionAnalytics(collection, prices), [collection, prices])
  if (summary.assignedCards === 0) return null
  return <section aria-label="Binder value" className="holo-panel relative mb-2 shrink-0 rounded-2xl border border-border/60">
    <button type="button" aria-label="View binder value in Analytics" onClick={onOpen} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl py-2 pl-3 pr-14 text-left">
    <span className="min-w-0"><span className="block text-sm font-medium">Binder value <span className="ml-1 text-lg font-semibold tabular-nums">{summary.pricedCards ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(summary.valueGbp) : loading ? "Loading…" : "Unknown"}</span></span>
      <span className="block text-xs text-muted-foreground">All price sources · {summary.pricedCards} of {summary.assignedCards} owned cards priced{summary.pricedCards < summary.assignedCards ? " · partial estimate" : ""}</span>
      {summary.estimatedFinishCards > 0 && <span className="block text-xs text-muted-foreground">Includes {summary.estimatedFinishCards} finish estimate{summary.estimatedFinishCards === 1 ? "" : "s"}</span>}
      {summary.oldestQuoteAt && <span className="block text-xs text-muted-foreground">Oldest quote {new Date(summary.oldestQuoteAt).toLocaleDateString("en-GB")}{summary.staleCards > 0 ? ` · ${summary.staleCards} stale` : ""}</span>}</span>
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
    <button type="button" aria-label="Hide binder value" onClick={onDismiss} className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
      <X className="h-4 w-4" aria-hidden />
    </button>
  </section>
}
