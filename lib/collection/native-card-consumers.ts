import { navigationIndex, type CollectionNavigationRead, type CollectionNavigationScope } from "@/lib/collection-navigation"
import { selectInventoryCollection } from "@/lib/collection/inventory-projection"
import { browserHostCatalog, browserHostDisplayCatalog } from "@/lib/collection/browser-host-catalog"
import { matchesCatalogCardId } from "@/lib/card-catalog"
import { isCardLanguage, type CardFinish, type WantedCard } from "@/lib/domain/cards"
import type { PublicWantedCard } from "@/lib/domain/inventory-commands"
import type { BrowseCard, SearchCardResult } from "@/lib/pokemon-card-browse"
import { prepareSlotPickerIntent } from "@/lib/slot-picker"
import type { InventorySelection } from "@/lib/inventory-plans"
import type { OperationIntentContext } from "@/lib/domain/audit-context"
import type { SlotCommandSink } from "@/lib/binder-slot-editing"

export interface NativeWantedDestination {
  scope: CollectionNavigationScope
  collectionId: string
  slotId: string
  wantedIndex: number
  inventoryRevision: number
  collectionVersion: number
  layoutRevision: number
  slotVersion: number
  expectedPublic: PublicWantedCard
}
export interface NativeConsumerBinding {
  scope: CollectionNavigationScope
  read: CollectionNavigationRead
  /** Undefined means All storage, including Unassigned. */
  collectionId?: string
  /** Open this exact printing for lookup, never derive a species destination. */
  openCard: (card: SearchCardResult) => void
  editingAvailable: boolean
  /** Host rechecks live lifecycle, online state, pending intents and recovery. Null denies editing. */
  admit: () => { scope: CollectionNavigationScope; read: CollectionNavigationRead; context: OperationIntentContext; receive: SlotCommandSink } | null
}

function publicWant(card: WantedCard): PublicWantedCard {
  const { wanted_by: _actor, card_image: _image, ...expected } = card
  return structuredClone(expected)
}

/** Presentation shares Inventory's distinct-copy/Unassigned accounting. Targets never produce wants. */
export function nativeCardConsumers(binding: Pick<NativeConsumerBinding, "scope" | "read" | "collectionId">) {
  const { scope, read, collectionId } = binding
  const index = navigationIndex(scope, read)
  if (!index.projection || read.evidence.kind === "unavailable" || collectionId && !index.collections.some(c => c.id === collectionId)) return null
  const snapshot = read.evidence.snapshot
  const projection = selectInventoryCollection(index.projection, collectionId)
  const display = browserHostDisplayCatalog(read.catalog)
  const wants = projection.wants.map(want => {
    const binder = snapshot.binders.find(b => b.collectionId === want.collectionId)!
    const slot = binder.slots.find(s => s.id === want.slotId)!
    const collection = snapshot.collections.find(c => c.id === want.collectionId)!
    // Missing language is unknown, never inferred as English for an exact destination.
    const card = want.card.card_language ? display(want.card.card_id, want.card.card_language) : undefined
    const species = card ? read.catalog.find(c => c.card === card)?.pokemonIds : undefined
    const destination: NativeWantedDestination = { scope: { ...scope }, collectionId: want.collectionId, slotId: want.slotId,
      wantedIndex: want.index, inventoryRevision: snapshot.inventoryRevision, collectionVersion: collection.version,
      layoutRevision: binder.layoutRevision, slotVersion: slot.version, expectedPublic: publicWant(want.card) }
    return { key: JSON.stringify([want.collectionId, want.slotId, want.index]), destination,
      collectionName: collection.name, card: card ? { ...card, dexIds: species ? [...species] : [] } : null,
      finish: want.card.card_finish ?? null, occupied: slot.inventoryItemId !== null }
  })
  const allCopies = index.projection.owned.map(copy => {
    const item = snapshot.items.find(i => i.id === copy.itemId)!
    const identity = item.identity
    const card = identity.kind === "card" && identity.language ? display(identity.cardId, identity.language) : undefined
    return { itemId: copy.itemId, itemVersion: item.version, unassigned: copy.placement === null, card: card ?? null, finish: identity.kind === "card" ? identity.finish ?? null : null }
  })
  const scopedIds = new Set(projection.owned.map(c => c.itemId))
  return { kind: index.kind, projection, copies: allCopies.filter(c => scopedIds.has(c.itemId)), availableCopies: allCopies.filter(c => c.unassigned), wants }
}

/** A printing badge counts copies and explicit entries, even when both Owned and Wanted are true. */
export function nativeCardState(model: ReturnType<typeof nativeCardConsumers>, card: BrowseCard, finish?: CardFinish) {
  const owned = model?.copies.filter(copy => copy.card && matchesCatalogCardId(card, copy.card.canonicalId ?? copy.card.id)
    && copy.card.language === card.language && (!finish || copy.finish === finish)) ?? []
  const wants = model?.wants.filter(w => w.card && matchesCatalogCardId(card, w.card.canonicalId ?? w.card.id)
    && w.card.language === card.language && (!finish || w.finish === finish)) ?? []
  return { known: model !== null, owned: owned.length > 0, wanted: wants.length > 0, ownedCount: owned.length, wantedCount: wants.length }
}
export function nativeCardLabel(state: ReturnType<typeof nativeCardState>) {
  if (!state.known) return "Ownership unavailable"
  return [state.ownedCount ? `Owned ×${state.ownedCount}` : "", state.wantedCount ? `Wanted ×${state.wantedCount}` : ""].filter(Boolean).join(" · ") || "No exact saved match"
}

/** Every recorded copy remains a separate choice. No private grade/certificate or automatic Raw reuse. */
export function nativeWantSelections(model: ReturnType<typeof nativeCardConsumers>, destination: NativeWantedDestination) {
  const want = model?.wants.find(w => JSON.stringify(w.destination) === JSON.stringify(destination))
  if (!want?.card || !want.finish || !isCardLanguage(want.card.language)) return []
  const copies = model!.availableCopies.filter(copy => copy.card && matchesCatalogCardId(want.card!, copy.card.canonicalId ?? copy.card.id)
    && copy.card.language === want.card!.language && copy.finish === want.finish)
  return copies.map(copy => ({ selection: { kind: "existing" as const, inventoryItemId: copy.itemId, itemVersion: copy.itemVersion } }))
}

/** Re-resolve exact evidence at click time. This is draft preparation, never authority or server success. */
export function prepareNativeWant(binding: NativeConsumerBinding, destination: NativeWantedDestination, selection: InventorySelection) {
  const admission = binding.editingAvailable ? binding.admit() : null
  if (!admission || JSON.stringify(admission.scope) !== JSON.stringify(destination.scope)) throw new Error("Native editing unavailable or session changed")
  const current = { ...binding, scope: admission.scope, read: admission.read }
  const model = nativeCardConsumers(current)
  if (model?.kind !== "complete" || admission.read.evidence.kind !== "complete") throw new Error("A complete current read is required")
  const want = model.wants.find(w => JSON.stringify(w.destination) === JSON.stringify(destination))
  if (!want?.card || !want.finish || want.occupied) throw new Error("Destination changed, occupied or exact printing unknown")
  const choices = nativeWantSelections(model, destination)
  if (selection.kind === "existing" ? !choices.some(c => JSON.stringify(c.selection) === JSON.stringify(selection))
    : choices.length > 0 || selection.identity.cardId !== (want.card.canonicalId ?? want.card.id)
      || selection.identity.language !== want.card.language || selection.identity.finish !== want.finish) throw new Error("Choose an exact copy")
  // First-party complete reads retain the exact want. The optimistic command sink rejects
  // expectedPublic, so never reconstruct hidden fields from a public/lookup projection.
  const expected = admission.read.evidence.snapshot.binders.find(b => b.collectionId === destination.collectionId)!
    .slots.find(s => s.id === destination.slotId)!.wantedCards[destination.wantedIndex]
  const prepared = prepareSlotPickerIntent(admission.read.evidence.snapshot,
    { ownerUserId: admission.scope.ownerUserId, collectionId: destination.collectionId, slotId: destination.slotId },
    { kind: "assign", selection, fulfillWant: { index: destination.wantedIndex, expected: structuredClone(expected) } },
    admission.context, browserHostCatalog(admission.read.catalog))
  return { ...prepared, receive: admission.receive }
}
