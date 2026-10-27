"use client"

import { normalizeDealThresholds, type DealThresholds } from "@/lib/deal-check"
import type { BuyingBand } from "@/lib/sold-price-guide"

export function DealPriceScale({ market, offer, overlap, thresholds, money, partial = false }: {
  market: number; offer?: number | null; overlap?: BuyingBand | null; thresholds?: DealThresholds; money: (amount: number) => string; partial?: boolean
}) {
  if (!(market > 0) || !Number.isFinite(market)) return null
  const { greatPct, fairPct } = normalizeDealThresholds(thresholds)
  const low = market * (1 - greatPct / 100), high = market * (1 - fairPct / 100)
  const min = Math.min(low, overlap?.low ?? low) * 0.8, max = market * 1.25
  const x = (value: number) => 12 + Math.max(0, Math.min(1, (value - min) / (max - min))) * 276
  const hasOffer = typeof offer === "number" && Number.isFinite(offer) && offer > 0
  return <figure aria-label="Buying range" className="text-[11px]">
    <figcaption className="flex flex-wrap justify-between gap-x-2"><span className="font-semibold">{partial ? "Priced cards only" : "Good range"} {money(low)} to {money(high)}</span>{hasOffer ? <span>Your offer {money(offer)}</span> : null}</figcaption>
    <svg viewBox="0 0 300 36" className="h-9 w-full" role="img" aria-label={`Good range ${money(low)} to ${money(high)}${hasOffer ? `, your offer ${money(offer)}` : ""}`}>
      <line x1="12" x2="288" y1="13" y2="13" stroke="currentColor" strokeOpacity="0.12" strokeWidth="8" strokeLinecap="round" />
      <rect x={x(low)} y="8" width={Math.max(1, x(high) - x(low))} height="10" rx="3" fill="#059669" />
      {overlap ? <rect x={x(overlap.low)} y="6" width={Math.max(1, x(overlap.high) - x(overlap.low))} height="14" rx="3" fill="#7c3aed"><title>Catalogue overlap {money(overlap.low)} to {money(overlap.high)}</title></rect> : null}
      <line x1={x(market)} x2={x(market)} y1="5" y2="21" stroke="currentColor" strokeOpacity="0.5" />
      <text x={x(market)} y="34" textAnchor="middle" fontSize="9" fill="currentColor">Ref {money(market)}</text>
      {hasOffer ? <g data-testid="offer-price-dot" data-price={offer} data-outside={offer < min || offer > max ? "true" : "false"}>
        <circle cx={x(offer)} cy="13" r="6" fill="currentColor" stroke="var(--background)" strokeWidth="2" />
        {offer < min || offer > max ? <text x={x(offer)} y="34" textAnchor={offer < min ? "start" : "end"} fontSize="10" fill="currentColor">{offer < min ? "←" : "→"}</text> : null}
      </g> : null}
    </svg>
  </figure>
}
