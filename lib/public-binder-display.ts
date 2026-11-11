import type { BinderSnapshot, BinderSlot } from "@/lib/domain/binder-slots"
import type { InventoryItem, InventorySnapshot } from "@/lib/domain/inventory"
import type { CardFinish, CardLanguage, CollectedPokemon, WantedCard } from "@/lib/domain/cards"
import type { PokemonSearchResultMeta } from "@/components/pokemon-search"
import type { QuickCardState } from "@/lib/quick-card-state"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { getQuickCardState } from "@/lib/quick-card-state"
import { getOfficialArtworkUrl, getPokemonSummary, type PokemonSummary } from "@/lib/pokemon-catalog"
import { WANTED_PREVIEW_TONE } from "@/lib/binder-display-model"
import type { DisplayCatalogCard, SlotDisplayInput } from "@/lib/binder-display-model"
import type { PublicBinder } from "@/lib/public-binder"

/** Opaque display-only scope. Never an account, binder, copy or slot ID from storage. */
export const PUBLIC_DISPLAY_OWNER = "public-share"
const COLLECTION = "public-binder"
// Wants have no public date; a fixed epoch keeps the WantedCard contract without inventing one per card.
const NO_DATE = "1970-01-01T00:00:00.000Z"

/**
 * Builds the read-only BinderApp input from the public projection alone, so a share link opens the
 * normal binder in its read-only state without any owner snapshot. Unknown printings get local keys.
 */
export function publicBinderDisplayInput(binder: PublicBinder): SlotDisplayInput {
  const catalog: Record<string, DisplayCatalogCard> = {}
  // Owned copies are the authoritative display; a target never replaces a copy's artwork.
  const remember = (key: string, language: CardLanguage | undefined, card: DisplayCatalogCard, owned: boolean) => {
    const exact = `${key}|${language ?? ""}`
    if (owned || !catalog[exact]) catalog[exact] = card
    if (owned || !catalog[key]) catalog[key] = card
    return key
  }
  const items: InventoryItem[] = []
  const slots: BinderSlot[] = binder.slots.map((slot, index) => {
    const target = slot.target?.kind === "card"
      ? { kind: "card" as const, cardId: remember(slot.target.cardId ?? `public-target-${index}`, slot.target.language, slot.card ?? { name: "Unknown card" }, false),
        ...(slot.target.language ? { language: slot.target.language } : {}), ...(slot.target.finish ? { finish: slot.target.finish } : {}) }
      : slot.target
    let inventoryItemId: string | null = null
    if (slot.item) {
      inventoryItemId = `public-item-${index}`
      const identity = slot.card
        ? { kind: "card" as const, cardId: remember(slot.card.id ?? `public-card-${index}`, slot.card.language, { name: slot.card.name, ...(slot.card.image ? { image: slot.card.image } : {}) }, true), ...(slot.card.language ? { language: slot.card.language } : {}) }
        : { kind: "pokemon" as const, pokemonId: slot.pokemon?.id ?? (slot.target?.kind === "pokemon" ? slot.target.pokemonId : 0) }
      const grade = slot.item.grading?.grade
      items.push({ id: inventoryItemId, ownerUserId: PUBLIC_DISPLAY_OWNER, identity, version: 1, acquiredAt: null,
        // Only a recorded provider/grade pair has a grading record; nothing else is invented.
        grading: slot.recordedProvider && grade !== undefined ? { provider: { kind: "custom", name: slot.recordedProvider }, grade, scale: null, designation: null, subgrades: [], certificate: null, holder: null, label: { variant: null, assetIds: [] } } : null })
    }
    return { id: slot.id, ownerUserId: PUBLIC_DISPLAY_OWNER, collectionId: COLLECTION, target, inventoryItemId, status: inventoryItemId ? "collected" : null, version: 1, presetOrigin: null,
      wantedCards: (slot.wantedCards ?? []).map((want, wantIndex) => ({ card_id: want.card_id ?? `public-want-${index}-${wantIndex}`, card_name: want.card_name, added_at: NO_DATE,
        ...(want.card_image ? { card_image: want.card_image } : {}), ...(want.card_language ? { card_language: want.card_language } : {}) })) }
  })
  const snapshot: BinderSnapshot = { ownerUserId: PUBLIC_DISPLAY_OWNER, collectionId: COLLECTION, layoutRevision: 1, presetManifest: null, slots }
  const inventory: InventorySnapshot = { ownerUserId: PUBLIC_DISPLAY_OWNER, inventoryRevision: 1, items, binders: [snapshot],
    collections: [{ id: COLLECTION, ownerUserId: PUBLIC_DISPLAY_OWNER, name: binder.name, kind: "binder", defaultPresentation: "binder", version: 1 }],
    placements: slots.flatMap(s => s.inventoryItemId ? [{ inventoryItemId: s.inventoryItemId, collectionId: COLLECTION, slotId: s.id, version: 1 }] : []) }
  return { binder: snapshot, inventory, catalog, resolveCard: (cardId, language) => catalog[`${cardId}|${language ?? ""}`] ?? catalog[cardId] }
}

export type PublicJumpFilter = "needed" | "wanted" | "upgradeable" | "favorite"
export interface PublicSlotLocation { slotId: string; slotIndex: number; page: number; label: string }
/**
 * Read-only navigation for a share, from the public projection and the display input's opaque slot IDs only.
 * Pockets, repeated printings and each stored want stay distinct; species are only a lookup for
 * species-level views (Search, Browse, List, Sets), shaped like the native nativeSpeciesCollection.
 */
export interface PublicReadIndex {
  species: { bySpecies: Map<number, CollectedPokemon>; rows: CollectedPokemon[] }
  wantEntries: { pokemonId: number; pokemonName: string; card: WantedCard }[]
  searchMeta: (pokemonId: number) => PokemonSearchResultMeta
  pageSpecies: (page: number) => PokemonSummary[]
  /** The pocket a species result opens: its first needed/wanted pocket, else its first pocket. */
  speciesLocation: (pokemonId: number) => PublicSlotLocation | null
  wantLocation: (card: WantedCard) => PublicSlotLocation | null
  /** Next/previous pocket after `fromIndex` matching the binder's jump filter, wrapping; null when none. */
  jump: (filter: PublicJumpFilter, fromIndex: number, direction: "next" | "prev") => PublicSlotLocation | null
  quickState: (card: SearchCardResult, pokemonId: number, finish?: CardFinish) => QuickCardState
}

export function publicReadIndex(binder: PublicBinder, input: SlotDisplayInput): PublicReadIndex {
  const perPage = binder.rows * binder.cols
  const name = (id: number) => getPokemonSummary(id)?.name ?? `#${id}`
  const locate = (slotIndex: number): PublicSlotLocation => {
    const offset = slotIndex % perPage
    return { slotId: input.binder.slots[slotIndex].id, slotIndex, page: Math.floor(slotIndex / perPage) + 1, label: `${String.fromCharCode(65 + Math.floor(offset / binder.cols))}${offset % binder.cols + 1}` }
  }
  const slotSpecies = binder.slots.map(slot => [...new Set([
    ...(slot.target?.kind === "pokemon" ? [slot.target.pokemonId] : []), ...(slot.pokemon ? [slot.pokemon.id] : []), ...(slot.card?.pokemonIds ?? []),
  ])])
  const state = (i: number) => binder.slots[i].wantedCards?.length ? "wanted" : binder.slots[i].item ? "owned" : binder.slots[i].target ? "open" : null
  const bySpeciesSlots = new Map<number, number[]>()
  slotSpecies.forEach((ids, i) => { for (const id of ids) bySpeciesSlots.set(id, [...(bySpeciesSlots.get(id) ?? []), i]) })

  const rows: CollectedPokemon[] = []
  const bySpecies = new Map<number, CollectedPokemon>()
  const wantEntries: PublicReadIndex["wantEntries"] = []
  const wantSlot = new Map<WantedCard, number>()
  binder.slots.forEach((slot, i) => {
    const species = slotSpecies[i]
    if (slot.item) {
      const ownedSpecies = slot.pokemon ? [slot.pokemon.id] : slot.card?.pokemonIds ?? []
      const row: CollectedPokemon = { id: `public-item-${i}`, pokemon_id: ownedSpecies[0] ?? 0, pokemon_name: ownedSpecies.length ? name(ownedSpecies[0]) : "", wanted_cards: [], status: "collected", collected_at: "",
        ...(slot.card?.id ? { card_id: slot.card.id, ...(slot.card.language ? { card_language: slot.card.language } : {}) } : {}),
        ...(slot.card ? { card_name: slot.card.name, ...(slot.card.image ? { card_image: slot.card.image } : {}) } : {}) }
      rows.push(row)
      for (const id of ownedSpecies) {
        const previous = bySpecies.get(id)
        if (previous?.status !== "collected") bySpecies.set(id, { ...row, pokemon_id: id, pokemon_name: name(id), wanted_cards: previous?.wanted_cards ?? [] })
      }
    }
    input.binder.slots[i].wantedCards.forEach((card, w) => {
      const wantSpecies = slot.wantedCards?.[w]?.pokemonIds ?? species
      wantSlot.set(card, i)
      wantEntries.push({ pokemonId: wantSpecies[0] ?? 0, pokemonName: wantSpecies.length ? name(wantSpecies[0]) : "", card })
      rows.push({ id: `public-want-${i}-${w}`, pokemon_id: 0, pokemon_name: "", wanted_cards: [card], status: "wishlisted", collected_at: "" })
      for (const id of wantSpecies) {
        const item = bySpecies.get(id) ?? { id: `public-want:${id}`, pokemon_id: id, pokemon_name: name(id), wanted_cards: [], status: "wishlisted" as const, collected_at: "" }
        bySpecies.set(id, { ...item, wanted_cards: [...item.wanted_cards, card] })
      }
    })
  })

  const speciesLocation = (id: number) => {
    const pockets = bySpeciesSlots.get(id) ?? []
    const first = pockets.find(i => state(i) === "wanted" || state(i) === "open") ?? pockets[0]
    return first === undefined ? null : locate(first)
  }
  const matchesJump = (filter: PublicJumpFilter, i: number) => {
    const slot = binder.slots[i]
    return filter === "wanted" ? Boolean(slot.wantedCards?.length) : filter === "upgradeable" ? Boolean(slot.item) : filter === "favorite" ? false : Boolean(slot.target && !slot.item)
  }
  return {
    species: { bySpecies, rows }, wantEntries, speciesLocation,
    wantLocation: card => wantSlot.has(card) ? locate(wantSlot.get(card)!) : null,
    pageSpecies: page => [...new Set(slotSpecies.slice((page - 1) * perPage, page * perPage).flat())].flatMap(id => getPokemonSummary(id) ?? []),
    jump: (filter, fromIndex, direction) => {
      const count = binder.slots.length
      for (let step = 1; step <= count; step++) {
        const i = ((fromIndex + (direction === "next" ? step : -step)) % count + count) % count
        if (matchesJump(filter, i)) return locate(i)
      }
      return null
    },
    searchMeta: id => {
      const location = speciesLocation(id)
      if (!location) return { previewImage: getOfficialArtworkUrl(id), previewFitClass: "object-contain", previewToneClass: "grayscale opacity-45", locationLabel: null, pageNumber: null, stateLabel: "Not in binder", stateToneClass: "bg-muted text-muted-foreground" }
      const slot = binder.slots[location.slotIndex]
      const pocketState = state(location.slotIndex)
      const want = slot.wantedCards?.[0]
      const slotState = pocketState === "wanted" ? "wanted" : pocketState === "open" ? "open" : "owned"
      return {
        previewImage: getOfficialArtworkUrl(id), previewFitClass: "object-contain", previewToneClass: slotState === "owned" ? "" : "grayscale opacity-60",
        cardPreviewImage: want?.card_image ?? (slot.item ? slot.card?.image : null) ?? null, cardPreviewToneClass: want ? WANTED_PREVIEW_TONE : "",
        stateLabel: slotState === "wanted" ? "Wanted" : slotState === "open" ? "Needed" : "Owned",
        stateToneClass: slotState === "owned" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : slotState === "wanted" ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground",
        cardLabel: want ? `Wanted: ${want.card_name}` : slot.item ? slot.card?.name ?? null : null,
        locationLabel: `Page ${location.page} • ${location.label}`, pageNumber: location.page, slotState,
      }
    },
    // Printing ownership is about the exact card, not the species it was found under.
    quickState: (card, _pokemonId, finish) => {
      const states = rows.map(row => getQuickCardState(card, row, finish))
      return { owned: states.some(s => s.owned), wanted: states.some(s => s.wanted), ownedElsewhere: [], replacing: null, otherBindersIncomplete: false }
    },
  }
}
