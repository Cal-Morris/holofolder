import { scorePriceObservationMatch, type PriceSubject } from "@/lib/price-intelligence"

export interface EbayListingSummary {
  kind: "asking"
  currency: "GBP"
  count: number
  median: number | null
  low: number | null
  high: number | null
}

export function summarizeEbayListings(subject: PriceSubject, items: unknown[]): EbayListingSummary {
  const prices = new Map<string, number>()
  for (const item of items) {
    if (!item || typeof item !== "object" || subject.language !== "en") continue
    const row = item as Record<string, unknown>
    const price = row.price as { value?: unknown; currency?: unknown } | undefined
    const location = row.itemLocation as { country?: unknown } | undefined
    if (typeof row.itemId !== "string" || !row.itemId || typeof row.title !== "string" || price?.currency !== "GBP" || location?.country !== "GB"
      || !Array.isArray(row.buyingOptions) || !row.buyingOptions.includes("FIXED_PRICE") || row.buyingOptions.includes("AUCTION") || row.itemGroupHref) continue
    if (/\b(booster|sealed|empty|sleeves?|binder|poster|art print|code card)\b/i.test(row.title)) continue
    if (typeof price.value !== "string" && typeof price.value !== "number") continue
    if (typeof price.value === "string" && !/^\d+(?:\.\d+)?$/.test(price.value)) continue
    const amount = Number(price.value)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const title = row.title
    if (/\b(japanese|jpn|jap|jp|korean|kor|kr|german|ger|deu|de|french|fre|fra|fr|italian|ita|it|spanish|spa|esp|es|portuguese|por|pt|chinese|chi|chn|cn|zh|dutch|dut|nl|1st|first edition|shadowless|unlimited error)\b/i.test(title)) continue
    if (subject.variant === "holo" && (!/\bholo(?:foil)?\b/i.test(title) || /non[ -]?holo/i.test(title))) continue
    if (subject.variant === "normal" && /\bholo(?:foil)?\b/i.test(title) && !/non[ -]?holo/i.test(title)) continue
    const number = subject.localId?.replace(/^0+(?=\d)/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (!number || !new RegExp(`(?:^|[^a-z0-9])(?:[a-z]+[- ]?)?0*${number}(?=$|[^a-z0-9])`, "i").test(title)) continue
    const match = scorePriceObservationMatch(subject, { provider: "ebay", title, sourceUrl: "", amount, currency: "GBP", observedAt: "" })
    if (match.rating !== "exact") continue
    prices.set(row.itemId, amount)
  }
  const amounts = [...prices.values()].sort((a, b) => a - b)
  const middle = Math.floor(amounts.length / 2)
  return {
    kind: "asking", currency: "GBP", count: amounts.length,
    median: amounts.length ? Math.round((amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2) * 100) / 100 : null,
    low: amounts[0] ?? null, high: amounts.at(-1) ?? null,
  }
}
