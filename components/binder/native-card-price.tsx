"use client"

import { ChevronDown } from "lucide-react"
import { useMemo } from "react"
import { CardPriceComparison } from "@/components/card-price-comparison"
import { CardPriceEvidence } from "@/components/card-price-evidence"
import { getCardPriceKey } from "@/hooks/use-card-prices"
import { useInventoryPriceState } from "@/hooks/use-inventory-prices"
import { applyPriceStaleness } from "@/lib/price-freshness"
import { formatPriceConfidenceLabel, formatPriceSourceLabel } from "@/lib/card-labels"
import type { PricedCardFinish } from "@/lib/card-pricing"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { CardFinish, CardLanguage } from "@/lib/domain/cards"
import type { PricingRegion } from "@/lib/pricing-region"
import { getRegionalFinishPrices, regionalizeCardPrices } from "@/lib/regional-price"

export interface NativeCardPricing {
  region: PricingRegion
  formatAmount: (amount: number | null | undefined, price?: CardPriceSnapshot) => string | null
  formatRange: (low: number | null | undefined, high: number | null | undefined, price?: CardPriceSnapshot) => string | null
}

const valueSkeleton = <><span className="sr-only">Loading</span><span aria-hidden="true" className="holo-loading inline-block h-3.5 w-14 rounded align-middle" /></>

/**
 * The card detail's price block for one exact owned printing: saved prices only, read through the existing saved-price
 * lookup (no new pipeline and no refresh-capable request), region-weighted, for the copy's own finish. Unknown stays
 * "No price"; a failed read says so.
 */
export default function NativeCardPrice({ cardId, language, finish, name, setName, localId, pricing }: {
  cardId: string; language: CardLanguage; finish?: CardFinish; name: string; setName?: string; localId?: string; pricing: NativeCardPricing
}) {
  const lookups = useMemo(() => [{ cardId, language }], [cardId, language])
  const saved = useInventoryPriceState(lookups)
  const pricesByCardId = useMemo(() => Object.fromEntries(saved.prices.map(price => [getCardPriceKey(price.cardId, price.language), { ...price, ...applyPriceStaleness(price, price.fetchedAt) }])), [saved.prices])
  const isLoading = saved.status === "loading"
  const snapshot = regionalizeCardPrices(pricesByCardId, pricing.region)[getCardPriceKey(cardId, language)]
  // A finish without its own quote shows no price; only the standard normal/holo fall back to the card's headline price.
  const price = finish ? getRegionalFinishPrices(snapshot, pricing.region)[finish as PricedCardFinish] ?? (finish === "reverse_holo" ? undefined : snapshot) : snapshot
  const missing = isLoading ? valueSkeleton : saved.status === "unavailable" ? "Unavailable" : "No price"
  const low = pricing.formatAmount(price?.goodGbpAmount, snapshot)
  const market = pricing.formatAmount(price?.marketGbpAmount ?? price?.gbpAmount, snapshot)
  const range = pricing.formatRange(price?.lowGbpAmount, price?.highGbpAmount, snapshot)
  const confidence = formatPriceConfidenceLabel(snapshot)
  const source = formatPriceSourceLabel(snapshot)
  return <section aria-label="Prices" aria-busy={isLoading || undefined} className="rounded-2xl border border-border/60 bg-background/25 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-xl border border-border/50 bg-background/45 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Low</p>
        <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{low ?? missing}</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-background/45 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Market</p>
        <p className="mt-0.5 text-sm font-bold tabular-nums">{market ?? missing}</p>
      </div>
    </div>
    {(range || confidence) && <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
      {range && <span className="rounded-full border border-border/50 bg-background/35 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">Range {range}</span>}
      {confidence && <span className="rounded-full border border-border/50 bg-background/35 px-2 py-0.5 dark:border-white/10 dark:bg-white/[0.04]">{confidence}</span>}
    </div>}
    {source && <p className="mt-2 break-words px-1 text-xs text-muted-foreground">{source}</p>}
    {/* Reserves the confidence pill and source line a saved price brings, so the bottom-anchored sheet doesn't jump. */}
    {isLoading && <div aria-hidden="true">
      <div className="mt-2 flex px-1 text-[10px] text-transparent"><span className="holo-loading rounded-full px-2 py-0.5">Medium confidence</span></div>
      <p className="mt-2 px-1 text-xs"><span className="holo-loading inline-block h-3 w-44 max-w-full rounded align-middle" /></p>
    </div>}
    <details className="group mt-2">
      <summary className="flex min-h-9 cursor-pointer items-center justify-between text-xs font-semibold">
        Price details
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <CardPriceComparison key={`${cardId}:${language}:${finish}`} cardId={cardId} searchCard={{ name, setName, localId }} language={language} finish={finish}
        catalogMarketGbp={price?.marketGbpAmount ?? price?.gbpAmount ?? null} />
      <CardPriceEvidence price={snapshot} />
    </details>
  </section>
}
