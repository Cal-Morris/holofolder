import { currentCardImageKey, LEGACY_CARD_IMAGE_BLOB_PREFIX } from "../tcgdex-card-image"

/**
 * Moving card images from the old bucket (`binderdex-card-images`, keys `cards/...`) to `holofolder-assets`
 * (keys `pokemon/tcg/cards/...`). Pure planning; `scripts/card-assets.ts migrate-bucket` does the I/O.
 */

export interface ListedObject {
  /** URL-safe key, as `createR2Deps().list` returns it. */
  key: string
  size: number
  etag: string
}

/** ListObjectsV2 page parser that keeps size and ETag (the shared one only returns keys). */
export function parseListedObjects(xml: string) {
  const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, body]) => ({
    key: decode(/<Key>([\s\S]*?)<\/Key>/.exec(body)?.[1] ?? "").split("/").map(encodeURIComponent).join("/"),
    size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? -1),
    etag: decode(/<ETag>([\s\S]*?)<\/ETag>/.exec(body)?.[1] ?? "").replaceAll('"', ""),
  }))
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
  return { objects, nextContinuationToken: truncated && token ? decode(token) : null }
}

/**
 * What to copy: every old-layout object whose new key is missing from the destination. Objects already there
 * with a different size or ETag are reported, never overwritten.
 */
export function planBucketCopy(source: readonly ListedObject[], destination: readonly ListedObject[]) {
  const existing = new Map(destination.map(object => [object.key, object]))
  const copy: Array<{ from: string; to: string; size: number }> = []
  const mismatched: Array<{ from: string; to: string }> = []
  let matching = 0
  for (const object of source) {
    if (!object.key.startsWith(`${LEGACY_CARD_IMAGE_BLOB_PREFIX}/`)) continue
    const to = currentCardImageKey(object.key)
    const there = existing.get(to)
    if (!there) copy.push({ from: object.key, to, size: object.size })
    else if (there.size !== object.size || there.etag !== object.etag) mismatched.push({ from: object.key, to })
    else matching++
  }
  return { copy, mismatched, matching }
}
