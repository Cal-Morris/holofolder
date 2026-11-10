import type { CardCatalogIdentity } from "./domain/cards"

export function normalizeCatalogName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Hosts a reviewed catalog image may come from (TCGdex plus the fallback sources in lib/card-image-sources.ts). */
const CATALOG_IMAGE_HOSTS = new Set([
  "assets.tcgdex.net",
  "product-images.tcgplayer.com",
  "images.pokemontcg.io",
  "images.scrydex.com",
  "limitlesstcg.nyc3.cdn.digitaloceanspaces.com",
  "cdn.shopify.com",
])

type CatalogMetadata = CardCatalogIdentity & {
  localId?: string
  image?: string
  tcgdexCardId?: string
  variantId?: string
  productId?: string
  printingLabel?: string
}

export function readCatalogMetadata(value: unknown): CatalogMetadata {
  if (!value || typeof value !== "object" || !("catalog" in value)) return {}
  const raw = value.catalog
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const result: CatalogMetadata = {}
  for (const key of ["canonicalId", "localId", "tcgdexCardId", "variantId", "printingLabel"] as const) {
    const candidate = (raw as Record<string, unknown>)[key]
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 200) result[key] = candidate
  }
  const aliases = (raw as Record<string, unknown>).aliasIds
  if (Array.isArray(aliases) && aliases.length <= 1000 && aliases.every(id => typeof id === "string" && id.length > 0 && id.length <= 200)) {
    result.aliasIds = [...new Set(aliases)]
  }
  const productId = (raw as Record<string, unknown>).productId
  if ((typeof productId === "string" || typeof productId === "number") && /^[1-9]\d*$/.test(String(productId))) {
    result.productId = String(productId)
  }
  const image = (raw as Record<string, unknown>).image
  if (typeof image === "string") {
    try {
      const url = new URL(image)
      if (url.protocol === "https:" && CATALOG_IMAGE_HOSTS.has(url.hostname)) {
        result.image = image
      }
    } catch { /* Invalid source images stay unavailable. */ }
  }
  return result
}

type CatalogCard = CardCatalogIdentity & { id: string; external_ids_json?: unknown }

export function catalogCardIds(card: CatalogCard): string[] {
  const metadata = readCatalogMetadata(card.external_ids_json ?? { catalog: card })
  return [...new Set([card.id, ...(metadata.canonicalId ? [metadata.canonicalId] : []), ...(metadata.aliasIds ?? [])])]
}

/** Catalog entries by every ID they answer to (own, canonical, alias), each list in catalog order.
 * `lookup.get(id)` holds exactly the entries `matchesCatalogCardId(entry.card, id)` accepts, read once per entry. */
export function indexCatalogCardIds<E extends { card: CatalogCard }>(catalog: readonly E[]): Map<string, E[]> {
  const lookup = new Map<string, E[]>()
  for (const entry of catalog) for (const id of catalogCardIds(entry.card)) {
    const entries = lookup.get(id)
    if (entries) entries.push(entry)
    else lookup.set(id, [entry])
  }
  return lookup
}

export function matchesCatalogCardId(card: CatalogCard, id: string | null | undefined) {
  return typeof id === "string" && catalogCardIds(card).includes(id)
}

export function deduplicateCatalogCards<T extends CatalogCard>(rows: T[]): T[] {
  const preferred = new Map<string, T>()
  for (const row of rows) {
    const canonical = readCatalogMetadata(row.external_ids_json ?? { catalog: row }).canonicalId ?? row.id
    const previous = preferred.get(canonical)
    if (!previous) { preferred.set(canonical, row); continue }
    const chosen = row.id === canonical ? row : previous
    const aliasIds = [...new Set([...catalogCardIds(previous), ...catalogCardIds(row)])].filter(id => id !== chosen.id).sort()
    preferred.set(canonical, aliasIds.length ? { ...chosen, aliasIds } : chosen)
  }
  return [...preferred.values()]
}

export function preserveCatalogIds<C extends { id: string; set_id: string; local_id: string }, D extends { card_id: string }, S extends { card_id: string }>(
  payload: { cards: C[]; dexLinks: D[]; externalSources: S[] }, existing: Array<{ id: string; set_id: string; local_id: string }>,
) {
  const existingIds = new Map(existing.map(row => [`${row.set_id}:${row.local_id}`, row.id]))
  const remap = new Map(payload.cards.map(row => [row.id, existingIds.get(`${row.set_id}:${row.local_id}`) ?? row.id]))
  return {
    cards: payload.cards.map(row => ({ ...row, id: remap.get(row.id)! })),
    dexLinks: payload.dexLinks.map(row => ({ ...row, card_id: remap.get(row.card_id) ?? row.card_id })),
    externalSources: payload.externalSources.map(row => ({ ...row, card_id: remap.get(row.card_id) ?? row.card_id })),
  }
}

export function selectCatalogPricing(payload: Record<string, unknown> | null, catalog: Pick<CatalogMetadata, "variantId" | "productId">) {
  if (!payload) return null
  if (!catalog.variantId) return payload
  const variants = Array.isArray(payload.variants_detailed) ? payload.variants_detailed : []
  const variant = variants.find(v => v && typeof v === "object" && (
    v.variantId === catalog.variantId || (catalog.productId && String(v.thirdParty?.tcgplayer) === catalog.productId)
  ))
  return variant ? { pricing: variant.pricing, variants: { [variant.type]: true } } : null
}

/** Existing catalog IDs, optionally followed by one numeric TCGplayer printing identity. */
export function isPriceCheckCardId(value: string) {
  return value.length <= 100 && /^[a-zA-Z0-9._-]+(?:~[1-9][0-9]*)?$/.test(value)
}
