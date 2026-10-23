// Show mode's finder: the "Hunting" list (the want list grouped by Pokémon) and the order of a Pokémon's
// cards when scanning a dealer's binder. Pure and client-safe; prices come in already converted for display.
import type { WantedCard } from "@/lib/domain/cards"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

/** Card eras, by set id prefix (dealers usually sort binders by set, and sets by era). Longest prefix wins. */
const ERA_PREFIXES: ReadonlyArray<{ prefix: string; id: string; label: string }> = [
  { prefix: "me", id: "me", label: "Mega Evolution" },
  { prefix: "sv", id: "sv", label: "Scarlet & Violet" },
  { prefix: "swsh", id: "swsh", label: "Sword & Shield" },
  { prefix: "sm", id: "sm", label: "Sun & Moon" },
  { prefix: "xy", id: "xy", label: "XY" },
  { prefix: "g1", id: "xy", label: "XY" },
  { prefix: "bw", id: "bw", label: "Black & White" },
  { prefix: "hgss", id: "hgss", label: "HeartGold SoulSilver" },
  { prefix: "col", id: "hgss", label: "HeartGold SoulSilver" },
  { prefix: "pl", id: "dp", label: "Diamond & Pearl" },
  { prefix: "dp", id: "dp", label: "Diamond & Pearl" },
  { prefix: "ex", id: "ex", label: "EX" },
  { prefix: "ecard", id: "wotc", label: "WotC" },
  { prefix: "neo", id: "wotc", label: "WotC" },
  { prefix: "gym", id: "wotc", label: "WotC" },
  { prefix: "base", id: "wotc", label: "WotC" },
  { prefix: "si", id: "wotc", label: "WotC" },
  { prefix: "lc", id: "wotc", label: "WotC" },
]

export const OTHER_ERA = { id: "other", label: "Other" } as const
const ERA_ORDER = ["me", "sv", "swsh", "sm", "xy", "bw", "hgss", "dp", "ex", "wotc", "other"]

export interface CardEra {
  id: string
  label: string
}

export function getSetEra(setId: string | null | undefined): CardEra {
  const id = (setId ?? "").toLowerCase()
  let best: (typeof ERA_PREFIXES)[number] | null = null
  for (const entry of ERA_PREFIXES) {
    // "sv03.5" and "swsh12pt5" are eras; "svp" (promos) too. "sma" is Sun & Moon; "smp" also.
    if (id.startsWith(entry.prefix) && (!best || entry.prefix.length > best.prefix.length)) best = entry
  }
  return best ? { id: best.id, label: best.label } : OTHER_ERA
}

/** "sv03.5-006" → "sv03.5" (the local number is the part after the last dash). */
export function getSetIdFromCardId(cardId: string, localId?: string | null) {
  if (localId && cardId.endsWith(`-${localId}`)) return cardId.slice(0, -(localId.length + 1))
  const dash = cardId.lastIndexOf("-")
  return dash > 0 ? cardId.slice(0, dash) : cardId
}

export interface HuntSourceItem {
  pokemon_id: number
  pokemon_name: string
  status?: string | null
  card_id?: string | null
  wanted_cards?: WantedCard[] | null
}

export interface HuntCard {
  key: string
  pokemonId: number
  pokemonName: string
  wanted: WantedCard
  setId: string
  setName: string
  era: CardEra
  /** Market price in the display currency, or null when unpriced. */
  price: number | null
}

export interface HuntGroup {
  pokemonId: number
  pokemonName: string
  /** Wishlisted with no particular card picked: any printing will do. */
  anyCard: boolean
  cards: HuntCard[]
  topPrice: number | null
}

export type HuntSort = "wanted" | "value"

export interface HuntFilters {
  era?: string | null
  setId?: string | null
  /** Only these card ids (an illustrator's cards); null for no filter. */
  cardIds?: ReadonlySet<string> | null
}

export const huntCardKey = (card: Pick<WantedCard, "card_id" | "card_language" | "card_finish">) =>
  `${card.card_id}:${card.card_language ?? "en"}:${card.card_finish ?? "normal"}`

export function collectHuntCards(items: readonly HuntSourceItem[], priceOf: (card: WantedCard) => number | null): HuntCard[] {
  const cards: HuntCard[] = []
  for (const item of items) {
    for (const wanted of item.wanted_cards ?? []) {
      const setId = getSetIdFromCardId(wanted.card_id, wanted.local_id)
      cards.push({
        key: huntCardKey(wanted),
        pokemonId: item.pokemon_id,
        pokemonName: item.pokemon_name,
        wanted,
        setId,
        setName: wanted.card_set || setId,
        era: getSetEra(setId),
        price: priceOf(wanted),
      })
    }
  }
  return cards
}

/** Eras and sets on the want list, for the filter chips (most cards first within an era's sets). */
export function getHuntFilterOptions(cards: readonly HuntCard[]) {
  const eras = new Map<string, { era: CardEra; count: number }>()
  const sets = new Map<string, { id: string; name: string; era: CardEra; count: number }>()
  for (const card of cards) {
    const era = eras.get(card.era.id) ?? { era: card.era, count: 0 }
    era.count += 1
    eras.set(card.era.id, era)
    const set = sets.get(card.setId) ?? { id: card.setId, name: card.setName, era: card.era, count: 0 }
    set.count += 1
    sets.set(card.setId, set)
  }
  return {
    eras: [...eras.values()].sort((a, b) => ERA_ORDER.indexOf(a.era.id) - ERA_ORDER.indexOf(b.era.id)),
    sets: [...sets.values()].sort((a, b) => ERA_ORDER.indexOf(a.era.id) - ERA_ORDER.indexOf(b.era.id) || a.name.localeCompare(b.name)),
  }
}

const byPriceDesc = (a: { price: number | null }, b: { price: number | null }) => (b.price ?? -1) - (a.price ?? -1)

/**
 * The want list as groups by Pokémon. "wanted" puts the Pokémon with the most wanted cards first (ties: the
 * dearest card); "value" puts the dearest card first. Wishlisted Pokémon with no card picked join only when no
 * filter is on (a filter is about printings, and they have none).
 */
export function buildHuntGroups(items: readonly HuntSourceItem[], cards: readonly HuntCard[], sort: HuntSort, filters: HuntFilters = {}): HuntGroup[] {
  const filtering = Boolean(filters.era || filters.setId || filters.cardIds)
  const groups = new Map<number, HuntGroup>()
  for (const card of cards) {
    if (filters.era && card.era.id !== filters.era) continue
    if (filters.setId && card.setId !== filters.setId) continue
    if (filters.cardIds && !filters.cardIds.has(card.wanted.card_id)) continue
    const group = groups.get(card.pokemonId) ?? { pokemonId: card.pokemonId, pokemonName: card.pokemonName, anyCard: false, cards: [], topPrice: null }
    group.cards.push(card)
    if (card.price !== null && (group.topPrice === null || card.price > group.topPrice)) group.topPrice = card.price
    groups.set(card.pokemonId, group)
  }
  if (!filtering) {
    for (const item of items) {
      if (item.status === "wishlisted" && (item.wanted_cards ?? []).length === 0 && !groups.has(item.pokemon_id)) {
        groups.set(item.pokemon_id, { pokemonId: item.pokemon_id, pokemonName: item.pokemon_name, anyCard: true, cards: [], topPrice: null })
      }
    }
  }
  const list = [...groups.values()]
  for (const group of list) group.cards.sort(byPriceDesc)
  return list.sort((a, b) => {
    if (sort === "wanted" && b.cards.length !== a.cards.length) return b.cards.length - a.cards.length
    return (b.topPrice ?? -1) - (a.topPrice ?? -1) || a.pokemonId - b.pokemonId
  })
}

/** The card the deal checker needs, rebuilt from what the want list stored. */
export function wantedToSearchCard(wanted: WantedCard, pokemonId: number): SearchCardResult {
  const setId = getSetIdFromCardId(wanted.card_id, wanted.local_id)
  const localId = wanted.local_id ?? wanted.card_id.slice(setId.length + 1)
  const finish = wanted.card_finish
  return {
    id: wanted.card_id,
    localId,
    name: wanted.card_name,
    image: wanted.card_image,
    language: wanted.card_language ?? "en",
    set: { id: setId, name: wanted.card_set || setId, officialCardCount: wanted.set_total },
    rarity: wanted.rarity,
    variants: finish === "reverse_holo" ? { normal: true, reverse: true } : finish === "holo" ? { holo: true } : undefined,
    dexIds: [pokemonId],
  }
}

export type PokemonCardStanding = "wanted" | "missing" | "owned"

/** Wanted first, then the ones still missing, owned (dimmed) last; dearest first within each. */
export function orderPokemonCards<T extends { standing: PokemonCardStanding; price: number | null }>(cards: readonly T[]): T[] {
  const rank: Record<PokemonCardStanding, number> = { wanted: 0, missing: 1, owned: 2 }
  return [...cards].sort((a, b) => rank[a.standing] - rank[b.standing] || byPriceDesc(a, b))
}

