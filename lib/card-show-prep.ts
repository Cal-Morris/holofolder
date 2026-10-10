// "Prepare for card show": download chosen sets (coverage data + card thumbnails through the image proxy)
// so they open offline. The service worker caches what this fetches: /api/tcg-set-slots in its data cache
// (network-first) and /api/card-image-proxy in its image cache (cache-first).
import type { TCGSetSlotsResponse, TCGSetSummary } from "@/lib/tcg-set-slots"

/** Rough size of one proxied low-res card thumbnail, used until real samples are measured. */
export const FALLBACK_THUMBNAIL_BYTES = 32 * 1024
export const ESTIMATE_SAMPLE_SIZE = 3
export const PREP_CONCURRENCY = 4

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

/** Every distinct card thumbnail a set's coverage view can show. */
export function getSetThumbnailUrls(payload: Pick<TCGSetSlotsResponse, "slots"> | null | undefined) {
  const urls = new Set<string>()
  for (const slot of payload?.slots ?? []) {
    for (const card of slot.cards ?? []) {
      const url = getProxiedThumbnailUrl(card.image)
      if (url) urls.add(url)
    }
  }
  return [...urls]
}

export interface CardShowPlan {
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

  for (const set of sets) {
    const url = getSetSlotsUrl(set)
    const response = await fetcher(url, { signal: options.signal })
    if (!response.ok) throw new Error(`Couldn't load ${set.name} (${response.status})`)
    const text = await response.text()
    const payload = JSON.parse(text) as TCGSetSlotsResponse
    planned.push({ set, url, dataBytes: text.length, imageUrls: getSetThumbnailUrls(payload) })
  }

  const imageUrls = [...new Set(planned.flatMap((entry) => entry.imageUrls))]
  const sampledImageBytes: number[] = []
  for (const url of imageUrls.slice(0, ESTIMATE_SAMPLE_SIZE)) {
    const response = await fetcher(url, { signal: options.signal }).catch(() => null)
    if (response?.ok) sampledImageBytes.push(await responseBytes(response))
  }
  const dataBytes = planned.reduce((sum, entry) => sum + entry.dataBytes, 0)

  return {
    sets: planned,
    imageUrls,
    dataBytes,
    sampledImageBytes,
    estimatedBytes: estimateCardShowBytes(imageUrls.length, dataBytes, sampledImageBytes),
  }
}

export interface CardShowProgress {
  done: number
  total: number
  failed: number
}

/** Step 2 (after the user confirms): download the remaining thumbnails, a few at a time. */
export async function downloadCardShowImages(
  plan: Pick<CardShowPlan, "imageUrls">,
  options: { fetcher?: Fetcher; signal?: AbortSignal; onProgress?: (progress: CardShowProgress) => void; concurrency?: number } = {},
): Promise<CardShowProgress> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const urls = plan.imageUrls.slice(ESTIMATE_SAMPLE_SIZE)
  const progress: CardShowProgress = { done: Math.min(ESTIMATE_SAMPLE_SIZE, plan.imageUrls.length), total: plan.imageUrls.length, failed: 0 }
  options.onProgress?.({ ...progress })

  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      if (options.signal?.aborted) return
      const url = urls[next]
      next += 1
      try {
        const response = await fetcher(url, { signal: options.signal })
        if (!response.ok) progress.failed += 1
        await response.arrayBuffer().catch(() => undefined)
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
