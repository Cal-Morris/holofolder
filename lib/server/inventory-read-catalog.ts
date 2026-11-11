import { isCardLanguage } from "@/lib/domain/cards"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { formatPokemonDisplayName, getPokemonById } from "@/lib/pokemon-catalog"
import { buildTcgdexAssetImageUrl, pickImageLanguage } from "@/lib/tcgdex-shared"
import { pickCardImageUrl } from "@/lib/card-image-sources"

type Row = Record<string, unknown>
/** Public mirror rows from inventory_snapshot_v2's catalog: the cards the snapshot names, their dex links and sets. */
export interface InventoryCatalogRows { cards: Row[]; dex: Row[]; sets: Row[] }

export function buildInventoryCatalog({ cards, dex, sets }: InventoryCatalogRows): InventoryCatalogEvidence[] {
  const setsById = new Map(sets.map(s => [s.id, s]))
  const dexByCard = new Map<unknown, number[]>()
  for (const l of dex) {
    if (typeof l.dex_id !== "number" || !Number.isSafeInteger(l.dex_id) || l.dex_id <= 0) continue
    dexByCard.set(l.card_id, [...dexByCard.get(l.card_id) ?? [], l.dex_id])
  }
  const result: InventoryCatalogEvidence[] = []
  for (const raw of cards) {
    const set = setsById.get(raw.set_id)
    if (!isSlotContractId(raw.id) || !isSlotContractId(raw.local_id) || !set || !isSlotContractId(set.id)
      || typeof set.name_en !== "string" || !set.name_en.trim() || typeof raw.name_en !== "string" || !raw.name_en.trim()) continue
    const metadata = readCatalogMetadata(raw.external_ids_json)
    const pokemonIds = [...new Set(dexByCard.get(raw.id) ?? [])].sort((a, b) => a - b)
    const names = [...new Set((dexByCard.get(raw.id) ?? []).flatMap(id => {
      const pokemon = getPokemonById(id)
      return pokemon ? [formatPokemonDisplayName(pokemon.name)] : []
    }))]
    const imageForLanguage = (language: string) => {
      const imageLanguage = pickImageLanguage(raw.image_languages_json, language)
      const tcgdexImage = imageLanguage && isSlotContractId(raw.series_id) ? buildTcgdexAssetImageUrl(imageLanguage, raw.series_id, String(set.id), String(raw.local_id)) : null
      return pickCardImageUrl(raw.external_ids_json, tcgdexImage ? imageLanguage : null, tcgdexImage, language) ?? undefined
    }
    const translations = raw.name_json && typeof raw.name_json === "object" ? raw.name_json as Record<string, unknown> : {}
    // Only attested languages, never infer a printing's language from the owner's preference.
    const languages = Object.keys(translations).filter(l => typeof translations[l] === "string" && String(translations[l]).trim())
    for (const language of languages.filter(isCardLanguage)) result.push({ card: { id: raw.id, localId: metadata.localId ?? raw.local_id,
      name: String(translations[language]), language, set: { id: set.id, name: set.name_en },
      ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}), ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}),
      image: imageForLanguage(language) }, speciesNames: names, pokemonIds })
    if (!languages.length) result.push({ card: { id: raw.id, localId: metadata.localId ?? raw.local_id, name: raw.name_en,
      set: { id: set.id, name: set.name_en }, image: imageForLanguage("en"), ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}),
      ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}) }, speciesNames: names, pokemonIds })
  }
  return result
}
