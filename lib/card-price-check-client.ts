import { isCardPriceCheck, type PriceCheckSource } from "@/lib/card-price-checks"
import { pinCardPriceCheck, priceCheckFinish } from "@/lib/card-price-check-cache"
import type { CardFinish } from "@/lib/domain/cards"

/** A failed check request; `status` lets batch callers back off on 429/503 instead of retrying hot. */
export class PriceCheckRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// POST: the server returns its saved check while it is under 12 hours old and only then calls the provider
// (claim_card_price_check rate-limits that). Every good answer is pinned on this device for offline reads.
export async function requestCardPriceCheck(cardId: string, language: string, finish: CardFinish | undefined, source: PriceCheckSource, signal: AbortSignal) {
  const exactFinish = priceCheckFinish(finish)
  const params = new URLSearchParams({ cardId, language, finish: exactFinish, source })
  const response = await fetch(`/api/card-price-checks?${params}`, { method: "POST", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new PriceCheckRequestError(typeof data?.error === "string" ? data.error : "Price check unavailable.", response.status)
  const check: unknown = data?.[source]
  if (!(check === null || (isCardPriceCheck(check) && check.summary.kind === (source === "ebay" ? "asking" : "sold")))
    || !data?.errors || typeof data.errors !== "object" || (data.errors[source] !== undefined && typeof data.errors[source] !== "string")) throw new Error("Invalid price check response.")
  if (check) void pinCardPriceCheck(cardId, exactFinish, source, check)
  return { check, error: data.errors[source] as string | undefined }
}
