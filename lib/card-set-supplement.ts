import type { MirrorCardExternalSourceRow, MirrorCardRow, MirrorSetRow } from "./card-db-sync"
import { inferDexIdsFromCardName } from "./card-dex-inference"
import type { GapProduct } from "./card-gap-fill"

// Release date independently confirmed by Pokémon's 2026-11-06 launch announcement.
export const DELTA_REIGN = { id: "me06", group: 24831, name: "Delta Reign", abbreviation: "DLR", releaseDate: "2026-11-06" } as const
export type SupplementGroup = { groupId: number; name: string; abbreviation: string; publishedOn: string }

/** Additive fallback while TCGdex lacks this set. Never derive cards from packaging or prices. */
export function planDeltaReignSupplement(group: SupplementGroup, products: GapProduct[], availableImages: ReadonlySet<string>) {
  if (group.groupId !== DELTA_REIGN.group || group.name !== "ME06: Delta Reign" || group.abbreviation !== DELTA_REIGN.abbreviation || group.publishedOn.slice(0, 10) !== DELTA_REIGN.releaseDate) {
    throw new Error("Delta Reign source identity changed; review before importing")
  }
  const cards: MirrorCardRow[] = []
  const externalSources: MirrorCardExternalSourceRow[] = []
  const dexLinks: Array<{ card_id: string; dex_id: number }> = []
  const numbers = new Set<string>(), productIds = new Set<number>(), totals = new Set<number>()
  for (const product of products) {
    if (product.groupId !== group.groupId || !Number.isSafeInteger(product.productId) || product.productId <= 0) throw new Error("Unexpected source product identity")
    const details = Object.fromEntries((product.extendedData ?? []).map(field => [field.name, field.value]))
    if (!details.Number) continue // Sealed products have no collector number.
    const number = /^(\d{3})\/(\d{3})$/.exec(details.Number)
    if (!number || !Number(number[1]) || !Number(number[2])) throw new Error(`Invalid collector number for ${product.productId}`)
    if (numbers.has(number[1]) || productIds.has(product.productId)) throw new Error("Ambiguous duplicate printing in source")
    numbers.add(number[1]); productIds.add(product.productId); totals.add(Number(number[2]))
    const type = details["Card Type"] ?? ""
    const category = type.startsWith("Trainer - ") ? "Trainer" : type.endsWith(" Energy") ? "Energy" : /^\d+$/.test(details.HP ?? "") && Number(details.HP) > 0 ? "Pokemon" : null
    if (!category) throw new Error(`Unknown card category for ${product.productId}`)
    const name = product.name.replace(/\s+-\s+\d{3}\/\d{3}(?=\s|$)/, "").trim()
    if (!name) throw new Error("Missing card name")
    const id = `${DELTA_REIGN.id}-${number[1]}`
    const pid = String(product.productId)
    const image = `https://product-images.tcgplayer.com/${pid}.jpg`
    cards.push({ id, series_id: "me", set_id: DELTA_REIGN.id, local_id: number[1], local_id_sort: Number(number[1]), name_en: name, name_json: { en: name },
      category, rarity: details.Rarity || null, hp: category === "Pokemon" ? Number(details.HP) : null, illustrator: null,
      types_json: category === "Pokemon" ? [type] : [], image_languages_json: [], variants_json: {},
      external_ids_json: { catalog: { productId: pid, ...(availableImages.has(pid) ? { image } : {}) } },
      raw_json: { supplementalSources: { tcgcsv: product } },
    })
    externalSources.push({ card_id: id, source: "tcgcsv", source_card_id: pid, source_set_id: String(group.groupId), raw_json: { ...product } })
    if (category === "Pokemon") {
      const dexIds = inferDexIdsFromCardName(name)
      if (!dexIds.length) throw new Error(`No Pokédex match for ${name}`)
      for (const dex_id of dexIds) dexLinks.push({ card_id: id, dex_id })
    }
  }
  if (!cards.length || totals.size !== 1) throw new Error("Missing cards or conflicting printed set totals")
  const sets: MirrorSetRow[] = [{ id: DELTA_REIGN.id, series_id: "me", name_en: DELTA_REIGN.name, name_json: { en: DELTA_REIGN.name },
    official_card_count: [...totals][0], release_date: DELTA_REIGN.releaseDate, raw_json: { supplementalSources: { tcgcsv: group } } }]
  return { series: [], sets, cards, externalSources, dexLinks }
}
