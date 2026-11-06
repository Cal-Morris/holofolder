// "Prepare for card show": download chosen sets (coverage data + card thumbnails through the image proxy)
// so they open offline. The service worker caches what this fetches: /api/tcg-set-slots in its data cache
// (network-first) and /api/card-image-proxy in its image cache (cache-first).
import type { TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"
import { getCardPriceKey, normalizeCardPriceLookups, type CardPriceLookup } from "@/lib/card-pricing"

/** Rough size of one proxied low-res card thumbnail, used until real samples are measured. */
export const FALLBACK_THUMBNAIL_BYTES = 32 * 1024
export const ESTIMATE_SAMPLE_SIZE = 3
export const PREP_CONCURRENCY = 4
/**
 * Marks thumbnail downloads as card show prep. The service worker then keeps them in its own image
 * cache (`binderdex-v1-show-images`), which everyday browsing can't evict.
 */
export const SAVE_FOR_SHOW_HEADERS = { "X-Binderdex-Save": "show" } as const

/** Exactly the URL the Sets view requests when a set is picked (query = set name, then setId). */
export function getSetSlotsUrl(set: Pick<TCGSetSummary, "id" | "name">) {
  return `/api/tcg-set-slots?${new URLSearchParams({ query: set.name, setId: set.id }).toString()}`
}

/** The low-res thumbnail of a card image, through the image proxy. */
export function getProxiedThumbnailUrl(image: string | undefined | null) {
  if (!image) return null
  const trimmed = image.trim()
  if (!trimmed) return null
  const low = trimmed.replace(/\/high\.(webp|png|jpg)$/, "/low.$1")
  if (low.startsWith("/")) return low
  try {
    const url = new URL(low)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return `/api/card-image-proxy?url=${encodeURIComponent(url.toString())}`
  } catch {
    return null
  }
}

/** Every distinct card thumbnail in the set, including value-ranking printings. */
export function getSetThumbnailUrls(payload: Pick<TCGSetSlotsResponse, "slots" | "cards"> | null | undefined) {
  const urls = new Set<string>()
  const cards = payload?.cards ?? payload?.slots.flatMap((slot) => slot.cards ?? []) ?? []
  for (const card of cards) {
    const url = getProxiedThumbnailUrl(card.image)
    if (url) urls.add(url)
  }
  return [...urls]
}

export interface CardShowPlan {
  sampledImageUrls?: string[]
  priceLookups: CardPriceLookup[]
  sets: Array<{ set: TCGSetSummary; url: string; dataBytes: number; imageUrls: string[] }>
  imageUrls: string[]
  dataBytes: number
  sampledImageBytes: number[]
  estimatedBytes: number
}

export function estimateCardShowBytes(imageCount: number, dataBytes: number, sampledImageBytes: number[]) {
  const sampled = sampledImageBytes.filter((bytes) => bytes > 0)
  const perImage = sampled.length > 0 ? sampled.reduce((sum, bytes) => sum + bytes, 0) / sampled.length : FALLBACK_THUMBNAIL_BYTES
  return Math.round(dataBytes + perImage * imageCount)
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

// Bodies are read in full (thumbnails are small) so the service worker's copy is never cut short.
async function responseBytes(response: Response) {
  return (await response.arrayBuffer()).byteLength
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Step 1 (small): load each set's coverage (also caches it), list its thumbnails and download a few of them
 * to measure a real per-image size. Nothing big is downloaded before the user sees the estimate.
 */
export async function planCardShowPrep(sets: TCGSetSummary[], options: { fetcher?: Fetcher; signal?: AbortSignal } = {}): Promise<CardShowPlan> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const planned: CardShowPlan["sets"] = []
  const priceLookups: CardPriceLookup[] = []

  for (const set of sets) {
    const url = getSetSlotsUrl(set)
    const response = await fetcher(url, { signal: options.signal })
    if (!response.ok) throw new Error(`Couldn't load ${set.name} (${response.status})`)
    const text = await response.text()
    const payload = JSON.parse(text) as TCGSetSlotsResponse
    const cards = payload.cards ?? payload.slots.flatMap(slot => slot.cards ?? [])
    priceLookups.push(...cards.map(card => ({ cardId: card.id, language: card.language ?? "en" })))
    planned.push({ set, url, dataBytes: text.length, imageUrls: getSetThumbnailUrls(payload) })
  }

  const imageUrls = [...new Set(planned.flatMap((entry) => entry.imageUrls))]
  const sampledImageBytes: number[] = []
  const sampledImageUrls: string[] = []
  for (const url of imageUrls.slice(0, ESTIMATE_SAMPLE_SIZE)) {
    const response = await fetcher(url, { signal: options.signal, headers: SAVE_FOR_SHOW_HEADERS }).catch(() => null)
    if (response?.ok) {
      try { sampledImageBytes.push(await responseBytes(response)); sampledImageUrls.push(url) } catch { /* Retry when downloading. */ }
    }
  }
  const dataBytes = planned.reduce((sum, entry) => sum + entry.dataBytes, 0)

  return {
    priceLookups: normalizeCardPriceLookups(priceLookups),
    sets: planned,
    imageUrls,
    dataBytes,
    sampledImageBytes,
    sampledImageUrls,
    estimatedBytes: estimateCardShowBytes(imageUrls.length, dataBytes, sampledImageBytes),
  }
}

/** Save full price evidence before claiming the chosen sets are ready without signal. */
export async function downloadCardShowPrices(plan: Pick<CardShowPlan, "priceLookups">, options: {
  savePrices: (prices: unknown[]) => void | Promise<void>
  fetcher?: Fetcher
  signal?: AbortSignal
  onProgress?: (progress: { done: number; total: number; priced: number }) => void
}) {
  const fetcher = options.fetcher ?? fetch
  const lookups = normalizeCardPriceLookups(plan.priceLookups)
  const progress = { done: 0, total: lookups.length, priced: 0 }
  for (let offset = 0; offset < lookups.length; offset += 25) {
    options.signal?.throwIfAborted()
    const batch = lookups.slice(offset, offset + 25)
    const response = await fetcher(`/api/card-prices?${new URLSearchParams({ cards: JSON.stringify(batch) })}`, { signal: options.signal, cache: "no-store" })
    if (!response.ok) throw new Error(`Couldn't download prices (${response.status})`)
    const payload = await response.json()
    if (!Array.isArray(payload?.prices)) throw new Error("The price download was incomplete")
    const requested = new Set(batch.map(card => getCardPriceKey(card.cardId, card.language)))
    const prices = payload.prices.filter((price: { cardId?: unknown; language?: unknown }) => typeof price?.cardId === "string" && requested.has(getCardPriceKey(price.cardId, price.language)))
    await options.savePrices(prices)
    progress.done += batch.length
    progress.priced += prices.filter((price: { marketGbpAmount?: unknown }) => typeof price.marketGbpAmount === "number" && Number.isFinite(price.marketGbpAmount) && price.marketGbpAmount > 0).length
    options.onProgress?.({ ...progress })
  }
  return progress
}

export interface CardShowProgress {
  done: number
  total: number
  failed: number
}

/** Step 2 (after the user confirms): download the remaining thumbnails, a few at a time. */
export async function downloadCardShowImages(
  plan: Pick<CardShowPlan, "imageUrls" | "sampledImageUrls">,
  options: { fetcher?: Fetcher; signal?: AbortSignal; onProgress?: (progress: CardShowProgress) => void; concurrency?: number } = {},
): Promise<CardShowProgress> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const sampled = new Set(plan.sampledImageUrls ?? [])
  const urls = plan.imageUrls.filter(url => !sampled.has(url))
  const progress: CardShowProgress = { done: plan.imageUrls.length - urls.length, total: plan.imageUrls.length, failed: 0 }
  options.onProgress?.({ ...progress })

  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      if (options.signal?.aborted) return
      const url = urls[next]
      next += 1
      try {
        const response = await fetcher(url, { signal: options.signal, headers: SAVE_FOR_SHOW_HEADERS })
        if (!response.ok) progress.failed += 1
        if (response.ok) await response.arrayBuffer()
      } catch {
        if (options.signal?.aborted) return
        progress.failed += 1
      }
      progress.done += 1
      options.onProgress?.({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? PREP_CONCURRENCY) }, worker))
  return progress
}

export interface SavedShowSet {
  set: TCGSetSummary
  images: number
  imageTotal: number
  priced: number
  priceTotal: number
}

/** Inspect the actual cached coverage and thumbnails, never a previous run's success flag. */
export async function inspectSavedShowSets(options: {
  cacheStorage: CacheStorage
  loadPrices: (lookups: CardPriceLookup[]) => Promise<readonly { marketGbpAmount?: number | null }[]>
}): Promise<SavedShowSet[]> {
  const names = await options.cacheStorage.keys()
  const imageUrls = new Set<string>()
  for (const name of names.filter(name => /^binderdex-.*-(?:show-)?images$/.test(name))) {
    for (const request of await (await options.cacheStorage.open(name)).keys()) imageUrls.add(request.url)
  }
  const saved = new Map<string, SavedShowSet>()
  for (const name of names.filter(name => /^binderdex-.*-data$/.test(name))) {
    const cache = await options.cacheStorage.open(name)
    for (const request of await cache.keys()) {
      const url = new URL(request.url)
      if (url.pathname !== "/api/tcg-set-slots" || !url.searchParams.has("setId")) continue
      const response = await cache.match(request)
      const payload = await response?.json().catch(() => null) as TCGSetSlotsResponse | null
      if (!payload?.selectedSet || typeof payload.selectedSet.id !== "string" || typeof payload.selectedSet.name !== "string" || !Array.isArray(payload.slots)) continue
      const cards = payload.cards ?? payload.slots.flatMap(slot => slot.cards ?? [])
      const lookups = normalizeCardPriceLookups(cards.map(card => ({ cardId: card.id, language: card.language ?? "en" })))
      const thumbnails = getSetThumbnailUrls(payload)
      const prices = await options.loadPrices(lookups)
      saved.set(payload.selectedSet.id, {
        set: payload.selectedSet,
        images: thumbnails.filter(image => imageUrls.has(new URL(image, url.origin).href)).length,
        imageTotal: thumbnails.length,
        priced: prices.filter(price => typeof price.marketGbpAmount === "number" && Number.isFinite(price.marketGbpAmount) && price.marketGbpAmount > 0).length,
        priceTotal: lookups.length,
      })
    }
  }
  return [...saved.values()]
}
