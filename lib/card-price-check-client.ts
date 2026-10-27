import { isCardPriceCheck, type PriceCheckSource } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"

export async function requestCardPriceCheck(cardId: string, language: string, finish: CardFinish | undefined, source: PriceCheckSource, signal: AbortSignal) {
  const exactFinish = finish && ["normal", "holo", "reverse_holo"].includes(finish) ? finish : "any"
  const params = new URLSearchParams({ cardId, language, finish: exactFinish, source })
  const response = await fetch(`/api/card-price-checks?${params}`, { method: "POST", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]) })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Price check unavailable.")
  const check: unknown = data?.[source]
  if (!(check === null || (isCardPriceCheck(check) && check.summary.kind === (source === "ebay" ? "asking" : "sold")))
    || !data?.errors || typeof data.errors !== "object" || (data.errors[source] !== undefined && typeof data.errors[source] !== "string")) throw new Error("Invalid price check response.")
  return { check, error: data.errors[source] as string | undefined }
}
