import { isCardLanguage } from "@/lib/domain/cards"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { formatPokemonDisplayName, getPokemonById } from "@/lib/pokemon-catalog"
import { buildTcgdexAssetImageUrl, pickImageLanguage } from "@/lib/tcgdex-shared"
import { pickExternalCardImageUrl } from "@/lib/card-image-sources"

type Row = Record<string, unknown>
// Preserve input order even when independent mirror queries finish out of order.
async function concurrent<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      result[index] = await read(values[index])
    }
  }))
  return result
}
function batches(values: string[]): string[][] {
  return Array.from({ length: Math.ceil(values.length / 100) }, (_, i) => values.slice(i * 100, i * 100 + 100))
}
/** Public mirror only. No owner filter, private cache key, upstream lookup or sync. */
export async function readInventoryCatalog(db: SupabaseClient, snapshot: InventorySnapshot, signal: AbortSignal, check: () => void, accountBytes?: (value: unknown) => void): Promise<InventoryCatalogEvidence[]> {
  const ids = [...new Set([
    ...snapshot.items.flatMap(i => i.identity.kind === "card" ? [i.identity.cardId] : []),
    ...snapshot.binders.flatMap(b => b.slots.flatMap(s => [s.target?.kind === "card" ? s.target.cardId : null, ...s.wantedCards.map(w => w.card_id)])),
  ].filter((id): id is string => id !== null))].sort()
  const cards: Row[] = [], sets: Row[] = []
  const read = async (table: string, select: string, key: string, values: string[], target: Row[], pageKey: string) => {
    const pages = await concurrent(batches(values), async batch => {
      const found: Row[] = []
      const batchIds = new Set(batch)
      let after: string | null = null
      const seen = new Set<string>()
      do {
        check()
        let query = db.from(table).select(select).in(key, batch).order(pageKey).limit(500)
        if (after !== null) query = query.gt(pageKey, after)
        const response = await query.abortSignal(signal)
        if (response.error || !Array.isArray(response.data) || response.data.length > 500) throw new Error("inventory_read_unavailable")
        accountBytes?.(response.data)
        const page = response.data as unknown as Row[]
        for (const row of page) {
          if (!batchIds.has(String(row[key])) || !isSlotContractId(row[pageKey]) || seen.has(String(row[pageKey]))) throw new Error("inventory_read_unavailable")
          seen.add(String(row[pageKey])); found.push(row)
        }
        after = page.length === 500 ? String(page.at(-1)![pageKey]) : null
      } while (after !== null)
      return found
    })
    for (const page of pages) target.push(...page)
  }
  await read("tcg_cards", "id,series_id,set_id,local_id,name_en,name_json,image_languages_json,external_ids_json", "id", ids, cards, "id")
  // Alias IDs are mirror evidence too. Ambiguous matches remain separate and cannot resolve a card.
  const knownCardIds = new Set(cards.map(c => c.id))
  const fallbacks = await concurrent(ids.filter(id => !knownCardIds.has(id)).flatMap(id => [false, true].map(canonical => ({ id, canonical }))), async ({ id, canonical }) => {
    const found: Row[] = []
    let after: string | null = null
    const seen = new Set<string>()
    do {
      check()
      let query = db.from("tcg_cards").select("id,series_id,set_id,local_id,name_en,name_json,image_languages_json,external_ids_json").order("id").limit(500)
      query = canonical ? query.eq("external_ids_json->catalog->>canonicalId", id) : query.contains("external_ids_json", { catalog: { aliasIds: [id] } })
      if (after !== null) query = query.gt("id", after)
      const response = await query.abortSignal(signal)
      if (response.error || !Array.isArray(response.data) || response.data.length > 500) throw new Error("inventory_read_unavailable")
      accountBytes?.(response.data)
      const page = response.data as unknown as Row[]
      for (const row of page) {
        const metadata = readCatalogMetadata(row.external_ids_json)
        if (!isSlotContractId(row.id) || seen.has(row.id)
          || (canonical ? metadata.canonicalId !== id : !metadata.aliasIds?.includes(id))) throw new Error("inventory_read_unavailable")
        seen.add(row.id)
        found.push(row)
      }
      after = page.length === 500 ? String(page.at(-1)!.id) : null
    } while (after !== null)
    return found
  })
  for (const page of fallbacks) for (const row of page) {
    if (!knownCardIds.has(row.id)) { knownCardIds.add(row.id); cards.push(row) }
  }
  const cardIds = cards.map(c => String(c.id))
  // Composite dex key is paged per bounded card batch using range, never a 1000-row implicit cap.
  const dexPages = await concurrent(batches(cardIds), async batch => {
    const found: Row[] = []
    let offset = 0
    do {
      check()
      const response = await db.from("tcg_card_dex_ids").select("card_id,dex_id").in("card_id", batch)
        .order("card_id").order("dex_id").range(offset, offset + 499).abortSignal(signal)
      if (response.error || !Array.isArray(response.data)) throw new Error("inventory_read_unavailable")
      accountBytes?.(response.data)
      found.push(...response.data as unknown as Row[])
      if (response.data.length < 500) break
      offset += 500
    } while (true)
    return found
  })
  const links = dexPages.flat()
  await read("tcg_sets", "id,name_en", "id", [...new Set(cards.map(c => String(c.set_id)))].sort(), sets, "id")
  const result: InventoryCatalogEvidence[] = []
  for (const raw of cards) {
    const set = sets.find(s => s.id === raw.set_id)
    if (!isSlotContractId(raw.id) || !isSlotContractId(raw.local_id) || !set || !isSlotContractId(set.id)
      || typeof set.name_en !== "string" || !set.name_en.trim() || typeof raw.name_en !== "string" || !raw.name_en.trim()) continue
    const metadata = readCatalogMetadata(raw.external_ids_json)
    const pokemonIds = [...new Set(links.filter(l => l.card_id === raw.id).flatMap(l => typeof l.dex_id === "number" && Number.isSafeInteger(l.dex_id) && l.dex_id > 0 ? [l.dex_id] : []))].sort((a, b) => a - b)
    const names = [...new Set(links.filter(l => l.card_id === raw.id).flatMap(l => {
      const pokemon = typeof l.dex_id === "number" ? getPokemonById(l.dex_id) : undefined
      return pokemon ? [formatPokemonDisplayName(pokemon.name)] : []
    }))]
    const imageForLanguage = (language: string) => {
      const imageLanguage = pickImageLanguage(raw.image_languages_json, language)
      return metadata.image ?? (imageLanguage && isSlotContractId(raw.series_id)
        ? buildTcgdexAssetImageUrl(imageLanguage, raw.series_id, String(set.id), String(raw.local_id))
        : pickExternalCardImageUrl(raw.external_ids_json)) ?? undefined
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
