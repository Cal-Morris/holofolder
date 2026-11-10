import type { BinderSnapshot, BinderSlot } from "@/lib/domain/binder-slots"
import type { InventoryItem, InventorySnapshot } from "@/lib/domain/inventory"
import type { CardLanguage } from "@/lib/domain/cards"
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
