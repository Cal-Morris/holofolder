import { isCardFinish, isCardLanguage } from "@/lib/domain/cards"
import { importItem, type ImportLookup } from "@/lib/collection-import"
import { inferCardFinish, normalizeLocalId, type SearchCardResult } from "@/lib/pokemon-card-browse"

export function readImportLookups(body: unknown): ImportLookup[] {
  if (!body || typeof body !== "object" || !("lookups" in body) || !Array.isArray(body.lookups) || !body.lookups.length || body.lookups.length > 25) throw new Error("Send between 1 and 25 card lookups.")
  const fields = new Set(["language", "finish", "list", "cardId", "tcgplayerId", "cardName", "set", "number"])
  return body.lookups.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid lookup.")
    const value = raw as Record<string, unknown>
    if (Object.entries(value).some(([key, v]) => !fields.has(key) || typeof v !== "string" || v.length > 240 || /[\u0000-\u001f]/.test(v)) || !isCardLanguage(value.language) || !isCardFinish(value.finish) || (value.list !== "owned" && value.list !== "wanted")) throw new Error("Invalid card identity, language, finish or list.")
    if (value.tcgplayerId && !/^\d{1,12}$/.test(String(value.tcgplayerId))) throw new Error("TCGplayer IDs must be numeric.")
    if (value.cardId && value.tcgplayerId) throw new Error("Choose one ID namespace.")
    if (!value.cardId && !value.tcgplayerId && !(value.cardName && value.set && value.number)) throw new Error("Map a catalogue ID, TCGplayer product ID, or name, set and number.")
    return value as unknown as ImportLookup
  })
}

const equal = (a: string, b: string) => a.normalize("NFKC").trim().toLowerCase() === b.normalize("NFKC").trim().toLowerCase()
export function resolveImportLookup(lookup: ImportLookup, candidates: SearchCardResult[]) {
  const matches = candidates.filter(card => {
    if (card.language !== lookup.language) return false
    if (lookup.cardId && ![card.id, card.canonicalId, ...(card.aliasIds ?? [])].includes(lookup.cardId)) return false
    if (lookup.cardName && !equal(card.name, lookup.cardName)) return false
    if (lookup.set && !equal(card.set.id, lookup.set) && !equal(card.set.name, lookup.set)) return false
    if (lookup.number) {
      const [number, total, extra] = lookup.number.split("/")
      if (extra !== undefined || normalizeLocalId(number) !== normalizeLocalId(card.localId)) return false
      if (total && (!card.set.officialCardCount || Number(total) !== card.set.officialCardCount)) return false
    }
    const inferred = inferCardFinish(card.rarity, card.variants)
    const finishes = new Set<typeof inferred>()
    if (inferred !== "normal" || card.variants?.normal === true) finishes.add(inferred)
    if (card.variants?.normal) finishes.add("normal")
    if (card.variants?.holo) finishes.add("holo")
    if (card.variants?.reverse) finishes.add("reverse_holo")
    if (card.variants?.jumbo) finishes.add("jumbo")
    return finishes.has(lookup.finish)
  })
  const unique = [...new Map(matches.map(card => [card.id, card])).values()]
  if (unique.length !== 1) return { problem: unique.length ? "Multiple catalogue printings match. Supply an exact catalogue ID." : "No exact catalogue match for this identity, language and finish." }
  const card = unique[0]
  if (card.dexIds.length !== 1) return { problem: "Multi-Pokémon cards require a manual binder selection." }
  try { return { item: importItem(lookup, card.dexIds[0], { card_id: card.id, card_name: card.name, card_set: card.set.name, card_image: card.image }) } }
  catch { return { problem: "This card has no supported National Dex slot." } }
}
