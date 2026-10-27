"use client"

import { buildDealPriceBands, type DealThresholds } from "@/lib/deal-check"
import type { BuyingBand } from "@/lib/sold-price-guide"

export function DealPriceScale({ market, offer, overlap, thresholds, money, partial = false }: {
  market: number; offer?: number | null; overlap?: BuyingBand | null; thresholds?: DealThresholds; money: (amount: number) => string; partial?: boolean
}) {
  const bands = buildDealPriceBands(market, thresholds)
  if (!bands) return null
  const min = bands.greatBelow * 0.75, max = Math.max(market * 1.5, bands.fair.high * 1.1)
  const x = (value: number) => 12 + Math.max(0, Math.min(1, (value - min) / (max - min))) * 276
  const hasOffer = typeof offer === "number" && Number.isFinite(offer) && offer > 0
  const zones = [
    { low: min, high: bands.greatBelow, color: "#047857", label: "Great deal" },
    { low: bands.greatBelow, high: bands.fair.low, color: "#059669", label: "Bargain" },
    { low: bands.fair.low, high: bands.fair.high, color: "#0284c7", label: "Fair / expected" },
    { low: bands.fair.high, high: bands.walkAwayAbove, color: "#d97706", label: "Above market" },
    { low: bands.walkAwayAbove, high: max, color: "#dc2626", label: "Walk away" },
  ]
  return <figure aria-label="Buying range" className="text-[11px]">
    <figcaption className="flex flex-wrap justify-between gap-x-2"><span className="font-semibold">{partial ? "Priced cards · fair" : "Fair / expected"} {money(bands.fair.low)} to {money(bands.fair.high)}</span>{hasOffer ? <span>Your offer {money(offer)}</span> : null}</figcaption>
    <svg viewBox="0 0 300 36" className="h-9 w-full" role="img" aria-label={`Fair range ${money(bands.fair.low)} to ${money(bands.fair.high)}${hasOffer ? `, your offer ${money(offer)}` : ""}`}>
      {zones.map(zone => <rect key={zone.label} x={x(zone.low)} y="8" width={Math.max(0, x(zone.high) - x(zone.low))} height="10" fill={zone.color} fillOpacity="0.65"><title>{zone.label}: {money(zone.low)} to {money(zone.high)}</title></rect>)}
      {overlap ? <rect x={x(overlap.low)} y="5" width={Math.max(1, x(overlap.high) - x(overlap.low))} height="16" rx="3" fill="none" stroke="#7c3aed" strokeWidth="1.5"><title>Catalogue agreement {money(overlap.low)} to {money(overlap.high)}</title></rect> : null}
      <line x1={x(market)} x2={x(market)} y1="5" y2="21" stroke="currentColor" strokeOpacity="0.5" />
      <text x="12" y="34" fontSize="9" fill="currentColor">Bargain</text>
      <text x={x(market)} y="34" textAnchor="middle" fontSize="9" fill="currentColor">Market {money(market)}</text>
      <text x="288" y="34" textAnchor="end" fontSize="9" fill="currentColor">Above market</text>
      {hasOffer ? <g data-testid="offer-price-dot" data-price={offer} data-outside={offer < min || offer > max ? "true" : "false"}>
        <circle cx={x(offer)} cy="13" r="6" fill="currentColor" stroke="var(--background)" strokeWidth="2" />
        {offer < min || offer > max ? <text x={x(offer)} y="34" textAnchor={offer < min ? "start" : "end"} fontSize="10" fill="currentColor">{offer < min ? "←" : "→"}</text> : null}
      </g> : null}
    </svg>
  </figure>
}
