import { isCardLanguage } from "@/lib/domain/cards"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { InventoryCatalogEvidence } from "@/lib/domain/inventory-browse"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { formatPokemonDisplayName, getPokemonById } from "@/lib/pokemon-catalog"

type Row = Record<string, unknown>
/** Public mirror only. No owner filter, private cache key, upstream lookup or sync. */
export async function readInventoryCatalog(db: SupabaseClient, snapshot: InventorySnapshot, signal: AbortSignal, check: () => void): Promise<InventoryCatalogEvidence[]> {
  const ids = [...new Set([
    ...snapshot.items.flatMap(i => i.identity.kind === "card" ? [i.identity.cardId] : []),
    ...snapshot.binders.flatMap(b => b.slots.flatMap(s => [s.target?.kind === "card" ? s.target.cardId : null, ...s.wantedCards.map(w => w.card_id)])),
  ].filter((id): id is string => id !== null))].sort()
  const cards: Row[] = [], links: Row[] = [], sets: Row[] = []
  const read = async (table: string, select: string, key: string, values: string[], target: Row[], pageKey: string) => {
    for (let i = 0; i < values.length; i += 100) {
      let after: string | null = null
      const seen = new Set<string>()
      do {
        check()
        let query = db.from(table).select(select).in(key, values.slice(i, i + 100)).order(pageKey).limit(500)
        if (after !== null) query = query.gt(pageKey, after)
        const response = await query.abortSignal(signal)
        if (response.error || !Array.isArray(response.data) || response.data.length > 500) throw new Error("inventory_read_unavailable")
        const page = response.data as unknown as Row[]
        for (const row of page) {
          if (!values.slice(i, i + 100).includes(String(row[key])) || !isSlotContractId(row[pageKey]) || seen.has(String(row[pageKey]))) throw new Error("inventory_read_unavailable")
          seen.add(String(row[pageKey])); target.push(row)
        }
        after = page.length === 500 ? String(page.at(-1)![pageKey]) : null
      } while (after !== null)
    }
  }
  await read("tcg_cards", "id,set_id,local_id,name_en,name_json,external_ids_json", "id", ids, cards, "id")
  // Alias IDs are mirror evidence too. Ambiguous matches remain separate and cannot resolve a card.
  for (const id of ids.filter(id => !cards.some(c => c.id === id))) {
    for (const canonical of [false, true]) {
      check()
      let query = db.from("tcg_cards").select("id,set_id,local_id,name_en,name_json,external_ids_json").limit(2)
      query = canonical ? query.eq("external_ids_json->catalog->>canonicalId", id) : query.contains("external_ids_json", { catalog: { aliasIds: [id] } })
      const response = await query.abortSignal(signal)
      if (response.error || !Array.isArray(response.data)) throw new Error("inventory_read_unavailable")
      for (const row of response.data as unknown as Row[]) if (!cards.some(c => c.id === row.id)) cards.push(row)
    }
  }
  const cardIds = cards.map(c => String(c.id))
  // Composite dex key is paged per bounded card batch using range, never a 1000-row implicit cap.
  for (let i = 0; i < cardIds.length; i += 100) {
    let offset = 0
    do {
      check()
      const response = await db.from("tcg_card_dex_ids").select("card_id,dex_id").in("card_id", cardIds.slice(i, i + 100))
        .order("card_id").order("dex_id").range(offset, offset + 499).abortSignal(signal)
      if (response.error || !Array.isArray(response.data)) throw new Error("inventory_read_unavailable")
      links.push(...response.data as unknown as Row[])
      if (response.data.length < 500) break
      offset += 500
    } while (true)
  }
  await read("tcg_sets", "id,name_en", "id", [...new Set(cards.map(c => String(c.set_id)))].sort(), sets, "id")
  const result: InventoryCatalogEvidence[] = []
  for (const raw of cards) {
    const set = sets.find(s => s.id === raw.set_id)
    if (!isSlotContractId(raw.id) || !isSlotContractId(raw.local_id) || !set || !isSlotContractId(set.id)
      || typeof set.name_en !== "string" || !set.name_en.trim() || typeof raw.name_en !== "string" || !raw.name_en.trim()) continue
    const metadata = readCatalogMetadata(raw.external_ids_json)
    const names = [...new Set(links.filter(l => l.card_id === raw.id).flatMap(l => {
      const pokemon = typeof l.dex_id === "number" ? getPokemonById(l.dex_id) : undefined
      return pokemon ? [formatPokemonDisplayName(pokemon.name)] : []
    }))]
    const translations = raw.name_json && typeof raw.name_json === "object" ? raw.name_json as Record<string, unknown> : {}
    // Only attested languages, never infer a printing's language from the owner's preference.
    const languages = Object.keys(translations).filter(l => typeof translations[l] === "string" && String(translations[l]).trim())
    for (const language of languages.filter(isCardLanguage)) result.push({ card: { id: raw.id, localId: metadata.localId ?? raw.local_id,
      name: String(translations[language]), language, set: { id: set.id, name: set.name_en },
      ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}), ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}),
      ...(metadata.image ? { image: metadata.image } : {}) }, speciesNames: names })
    if (!languages.length) result.push({ card: { id: raw.id, localId: metadata.localId ?? raw.local_id, name: raw.name_en,
      set: { id: set.id, name: set.name_en }, ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}),
      ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}) }, speciesNames: names })
  }
  return result
}
