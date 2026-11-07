"use client"

import { useEffect, useMemo, useState } from "react"
import CollectionPriceCheck from "@/components/collection-price-check"
import { buildRefinedValuation } from "@/lib/binder-valuation"
import { priceCheckKey, readPinnedCardPriceCheck, formatPriceCheckAge } from "@/lib/card-price-check-cache"
import type { CardPriceCheck } from "@/lib/card-price-checks"
import type { AnalyticsCard } from "@/lib/collection-analytics"
import type { CollectedPokemon } from "@/lib/domain/cards"

export function BinderValuationRefinement({ cards, collection, isOnline, readOnly, isAllBinders }: {
  cards: AnalyticsCard[]
  collection: CollectedPokemon[]
  isOnline: boolean
  readOnly: boolean
  isAllBinders: boolean
}) {
  const [checks, setChecks] = useState<Record<string, CardPriceCheck | null>>({})
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    const targets = new Map(cards.filter(entry => entry.scope === "owned" && (entry.card.card_language ?? "en") === "en").map(({ card }) => [priceCheckKey(card.card_id, card.card_finish ?? "normal", "soldcomps"), card]))
    void Promise.all([...targets].map(async ([key, card]) => [key, await readPinnedCardPriceCheck(card.card_id, card.card_finish ?? "normal", "soldcomps")] as const))
      .then(entries => { if (!cancelled) setChecks(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [cards, revision])
  const refined = useMemo(() => buildRefinedValuation(cards, checks), [cards, checks])
  return <section aria-label="Refine binder valuation" className="mt-4 space-y-3 rounded-xl bg-muted/40 p-3 text-sm">
    {!readOnly && <CollectionPriceCheck collection={collection} kind="owned" isOnline={isOnline} label="Refine valuation" scopeLabel={isAllBinders ? "all binders" : "this binder"} onComplete={() => setRevision(value => value + 1)} />}
    <p className="text-muted-foreground">Use matching sold prices where the evidence is strong enough. Active eBay listings are supporting evidence.</p>
    <div>
      <h3 className="font-medium">Sales-based estimate</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{refined.soldCards ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(refined.totalGbp) : "Not enough sold evidence"}</p>
      <p className="mt-1 text-muted-foreground">{refined.soldCards} sold · {refined.fallbackCards} Cardmarket fallback · {refined.unpricedCards} unpriced</p>
      {refined.oldestCheck && <p className="mt-1 text-muted-foreground">Oldest used sold check: {formatPriceCheckAge(refined.oldestCheck)}.</p>}
    </div>
  </section>
}
