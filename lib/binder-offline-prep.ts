import type { CollectedPokemon, CardFinish, CardLanguage } from "@/lib/domain/cards"
import { getCardPriceKey, isStandardFinishVariantKey, normalizeCardPriceLookups, type CardPriceSnapshot } from "@/lib/card-pricing"
import { getProxiedThumbnailUrl, SAVE_FOR_SHOW_HEADERS } from "@/lib/card-show-prep"
import { toCardImageSrc } from "@/lib/card-image-url"
import { isCardPriceCheck } from "@/lib/card-price-checks"
import { pinCardPriceCheck, priceCheckFinish, PRICE_CHECK_SOURCES, readPinnedCardPriceCheck } from "@/lib/card-price-check-cache"
import { collectionRecordKey } from "@/lib/binders/offline"
import { loadCollectionRecord } from "@/lib/offline-store/records"
import type { OfflineKeyValueStore } from "@/lib/offline-store/kv"
import { mapWithConcurrency } from "@/lib/card-db-sync-concurrency"

export const BINDER_IMAGE_CACHE = "binderdex-v1-show-images"
export interface BinderPrepScope { ownerUserId: string | null; binderId: string | null; isDefault: boolean }
export interface BinderPrinting {
  cardId: string
  language: CardLanguage
  finish: CardFinish
  images: string[]
}
export const printingKey = (card: BinderPrinting) => JSON.stringify([card.cardId, card.language, card.finish])
export const binderPrepKey = (scope: BinderPrepScope) => `binder-prep:${JSON.stringify([scope.ownerUserId, scope.binderId])}`

/** All assigned printings, independent of the visible page, filters, or Hunt ranking. */
export function binderPrintings(items: readonly CollectedPokemon[]): BinderPrinting[] {
  const cards = new Map<string, BinderPrinting>()
  for (const item of items) {
    for (const card of [...(item.card_id && item.status !== "wishlisted" ? [item] : []), ...item.wanted_cards]) {
      if (!card.card_id) continue
      const printing: BinderPrinting = { cardId: card.card_id, language: card.card_language ?? "en", finish: card.card_finish ?? "normal", images: [] }
      const key = printingKey(printing)
      const images = [toCardImageSrc(card.card_image), getProxiedThumbnailUrl(card.card_image)]
        .filter((url): url is string => Boolean(url?.startsWith("/api/card-image-proxy?")))
      printing.images = [...new Set([...(cards.get(key)?.images ?? []), ...images])]
      cards.set(key, printing)
    }
  }
  return [...cards.values()]
}

export const supportsSavedChecks = (card: BinderPrinting) => card.language === "en" && card.finish !== "jumbo"
const checkReceipt = (scope: BinderPrepScope, card: BinderPrinting, source: string) => `${binderPrepKey(scope)}:check:${card.cardId}:${priceCheckFinish(card.finish)}:${source}`
const priceReceipt = (scope: BinderPrepScope, card: { cardId: string; language?: unknown }) => `${binderPrepKey(scope)}:price:${getCardPriceKey(card.cardId, card.language)}`

export interface BinderPrepStatus {
  total: number
  cards: number
  images: number
  prices: number
  asking: number
  sold: number
  unsupported: number
  askingRecords: number
  soldRecords: number
  oldestCheck: string | null
  complete: boolean
  shell: boolean
}
export type BinderPrepPhase = "cards" | "images" | "prices" | "asking and sold" | "verifying"
interface Dependencies {
  shellReady: boolean
  store: OfflineKeyValueStore
  cache: Cache
  loadPrices: (lookups: { cardId: string; language: CardLanguage }[]) => Promise<readonly CardPriceSnapshot[]>
}

const isSavedImage = (response: Response | undefined) => Boolean(response?.ok && response.headers.get("content-type")?.startsWith("image/"))

function hasExactPrice(card: BinderPrinting, price: CardPriceSnapshot | undefined) {
  if (!price) return false
  const quotes = price.finishPrices?.filter(quote => quote.finish === card.finish && isStandardFinishVariantKey(quote.variantKey)) ?? []
  return quotes.some(quote => (quote.marketGbpAmount ?? quote.gbpAmount ?? 0) > 0)
}

/** Re-read actual records and files, including after cold reload. A previous success flag is not evidence. */
export async function inspectBinderPrep(cards: BinderPrinting[], scope: BinderPrepScope, deps: Dependencies): Promise<BinderPrepStatus> {
  const status: BinderPrepStatus = { total: cards.length, cards: 0, images: 0, prices: 0, asking: 0, sold: 0,
    unsupported: cards.filter(card => !supportsSavedChecks(card)).length, askingRecords: 0, soldRecords: 0, oldestCheck: null, complete: false, shell: deps.shellReady }
  const record = await loadCollectionRecord(deps.store, collectionRecordKey(scope.binderId, scope.isDefault))
  const savedCards = record?.ownerUserId === scope.ownerUserId && (record.binderId ?? null) === scope.binderId
    ? new Set(binderPrintings(record.collection).map(printingKey)) : new Set<string>()
  const prices = new Map((await deps.loadPrices(cards)).map(price => [getCardPriceKey(price.cardId, price.language), price]))
  const countedChecks = new Set<string>()
  await mapWithConcurrency(cards, 4, async card => {
    if (savedCards.has(printingKey(card))) status.cards++
    if (card.images.length && (await Promise.all(card.images.map(url => deps.cache.match(url)))).every(isSavedImage)) status.images++
    if (await deps.store.get(priceReceipt(scope, card)) && hasExactPrice(card, prices.get(getCardPriceKey(card.cardId, card.language)))) status.prices++
    if (!supportsSavedChecks(card)) return
    for (const source of PRICE_CHECK_SOURCES) {
      const check = await readPinnedCardPriceCheck(card.cardId, card.finish, source, deps.store)
      if (!check || !await deps.store.get(checkReceipt(scope, card, source))) continue
      // Legacy summaries without records cannot supply the offline records/chart. Keep them, but
      // report partial coverage until a manual refresh has saved the underlying evidence.
      const records = source === "ebay" ? check.listings : check.sales
      if (check.summary.count > 0 && records?.length === check.summary.count) {
        if (source === "ebay") status.asking++
        else status.sold++
        const key = `${card.cardId}:${priceCheckFinish(card.finish)}:${source}`
        if (!countedChecks.has(key)) {
          countedChecks.add(key)
          if (source === "ebay") status.askingRecords += records.length
          else status.soldRecords += records.length
        }
      }
      if (!status.oldestCheck || Date.parse(check.checkedAt) < Date.parse(status.oldestCheck)) status.oldestCheck = check.checkedAt
    }
  })
  status.complete = status.shell && status.total > 0 && [status.cards, status.images, status.prices, status.asking, status.sold].every(count => count === status.total)
  return status
}

/** GET only: stale saved checks remain useful. No provider refresh, spend confirmation or 60-card cap. */
export async function downloadBinderPrep(cards: BinderPrinting[], scope: BinderPrepScope, options: Dependencies & {
  signal: AbortSignal
  savePrices: (prices: unknown[]) => Promise<void>
  fetcher?: typeof fetch
  onProgress: (phase: BinderPrepPhase, done: number, total: number) => void
}) {
  const fetcher = options.fetcher ?? fetch
  const request = (url: string, init?: RequestInit) => fetcher(url, { ...init, cache: "no-store", signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) })
  const run = async <T>(phase: BinderPrepPhase, items: T[], action: (item: T) => Promise<void>) => {
    let done = 0
    options.onProgress(phase, done, items.length)
    await mapWithConcurrency(items, 4, async item => {
      if (options.signal.aborted) return
      try { await action(item) } catch { /* Final inspection reports missing data; retry resumes durable successes. */ }
      if (!options.signal.aborted) options.onProgress(phase, ++done, items.length)
    })
    options.signal.throwIfAborted()
  }
  await options.store.set(binderPrepKey(scope), { startedAt: new Date().toISOString(), printings: cards.map(printingKey) })
  await run("images", [...new Set(cards.flatMap(card => card.images))], async url => {
    if (isSavedImage(await options.cache.match(url))) return
    const response = await request(url, { headers: SAVE_FOR_SHOW_HEADERS })
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("Image unavailable")
    // Await the durable write ourselves; the worker's waitUntil may finish after fetch resolves.
    await options.cache.put(url, response)
  })
  const lookups = normalizeCardPriceLookups(cards)
  // A new preparation must pick up evidence saved on the server since the previous show.
  const batches = Array.from({ length: Math.ceil(lookups.length / 25) }, (_, index) => lookups.slice(index * 25, index * 25 + 25))
  await run("prices", batches, async batch => {
    const response = await request(`/api/card-prices?${new URLSearchParams({ cards: JSON.stringify(batch) })}`)
    if (!response.ok) throw new Error("Saved prices unavailable")
    const data = await response.json()
    if (!Array.isArray(data.prices)) throw new Error("Invalid saved prices")
    const keys = new Set(batch.map(card => getCardPriceKey(card.cardId, card.language)))
    const prices = data.prices.filter((price: CardPriceSnapshot) => typeof price?.cardId === "string" && keys.has(getCardPriceKey(price.cardId, price.language)))
    await options.savePrices(prices)
    // Missing rows get no receipt, so Retry can discover evidence saved on the server since this run.
    await options.store.setMany(prices.map((price: CardPriceSnapshot) => [priceReceipt(scope, price), true] as const))
  })
  const checks = [...new Map(cards.filter(supportsSavedChecks).map(card => [`${card.cardId}:${priceCheckFinish(card.finish)}`, card])).values()]
  await run("asking and sold", checks, async card => {
    const params = new URLSearchParams({ cardId: card.cardId, language: card.language, finish: priceCheckFinish(card.finish) })
    const response = await request(`/api/card-price-checks?${params}`)
    if (!response.ok) throw new Error("Saved checks unavailable")
    const data = await response.json()
    for (const source of PRICE_CHECK_SOURCES) {
      if (isCardPriceCheck(data[source])) {
        await pinCardPriceCheck(card.cardId, card.finish, source, data[source], options.store)
        const pinned = await readPinnedCardPriceCheck(card.cardId, card.finish, source, options.store)
        if (pinned && Date.parse(pinned.checkedAt) >= Date.parse(data[source].checkedAt)) await options.store.set(checkReceipt(scope, card, source), true)
      }
    }
  })
  options.onProgress("verifying", 0, cards.length)
  return inspectBinderPrep(cards, scope, options)
}
