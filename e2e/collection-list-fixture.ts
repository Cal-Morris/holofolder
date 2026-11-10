import { E2E_USER } from "./fixtures"
import type { InventorySnapshot } from "../lib/domain/inventory"
import type { InventoryCatalogEvidence } from "../lib/domain/inventory-browse"
import type { Route } from "@playwright/test"

export const LIST_COLLECTION = "22222222-2222-4222-8222-222222222222"
export const LIST_SLOTS = 1025
export const listEntry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${LIST_COLLECTION}&view=list`

// Synthetic only: a full 1,025 slot National Dex binder with a mix of owned cards, owned Pokémon-only copies,
// wanted printings, unfilled targets and free spacers. Never real owner data.
const OWNED_CARD = "synthetic-list-card"
const OWNED_LONG = "synthetic-list-long"
export const listCatalog: InventoryCatalogEvidence[] = [
  { card: { id: OWNED_CARD, name: "Synthetic Charizard", localId: "4", language: "en", set: { id: "synthetic", name: "Synthetic Base" } }, speciesNames: ["Charizard"] },
  { card: { id: OWNED_LONG, name: "Synthetic extraordinarily long card display name that has to wrap or truncate cleanly 火リザードン", localId: "SYN-123", language: "en", set: { id: "synthetic", name: "Synthetic Base" } }, speciesNames: ["Charizard"] },
]

/** Slot index n is Pokémon #n+1. Kinds repeat so every state is represented many times. */
export function listSnapshot(): InventorySnapshot {
  const ownerUserId = E2E_USER.id
  const collections: InventorySnapshot["collections"] = [{ id: LIST_COLLECTION, ownerUserId, name: "Synthetic list", kind: "binder", defaultPresentation: "binder", version: 1 }]
  const kind = (n: number) => n % 13 === 12 ? "spacer" : n % 5 === 0 ? "card" : n % 5 === 1 ? "pokemon" : n % 7 === 2 ? "wanted" : "target"
  const items: InventorySnapshot["items"] = []
  const slots: InventorySnapshot["binders"][number]["slots"] = Array.from({ length: LIST_SLOTS }, (_, n) => {
    const k = kind(n)
    let inventoryItemId: string | null = null
    if (k === "card" || k === "pokemon") {
      inventoryItemId = `synthetic-list-copy-${n}`
      items.push({ id: inventoryItemId, ownerUserId, grading: null, acquiredAt: null, version: 1,
        identity: k === "card" ? { kind: "card", cardId: n % 10 === 0 ? OWNED_LONG : OWNED_CARD, language: "en", finish: "holo" } : { kind: "pokemon", pokemonId: n + 1 } })
    }
    return { id: `synthetic-list-slot-${n}`, ownerUserId, collectionId: LIST_COLLECTION, inventoryItemId,
      target: k === "spacer" ? null : { kind: "pokemon", pokemonId: n + 1 },
      status: inventoryItemId ? "collected" as const : null,
      wantedCards: k === "wanted" ? [{ card_id: OWNED_CARD, card_name: "Synthetic Charizard", added_at: "2026-11-09T00:00:00Z" }] : [], version: 1, presetOrigin: null }
  })
  const placements = slots.filter(s => s.inventoryItemId).map(s => ({ inventoryItemId: s.inventoryItemId!, collectionId: LIST_COLLECTION, slotId: s.id, version: 1 }))
  return { ownerUserId, inventoryRevision: 1, items, placements, collections, binders: [{ ownerUserId, collectionId: LIST_COLLECTION, layoutRevision: 1, presetManifest: null, slots }] }
}

export async function fulfillListInventory(route: Route) {
  const s = listSnapshot(), url = new URL(route.request().url())
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
    version: 2, requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot: s,
    navigation: { catalog: listCatalog, layouts: [{ collectionId: LIST_COLLECTION, layoutRevision: 1, rows: 3, cols: 3 }] },
    evidence: { inventoryRevision: 1, items: s.items.length, placements: s.placements.length, collections: 1, binders: 1, slots: LIST_SLOTS,
      storage: [{ collectionId: LIST_COLLECTION, collectionVersion: 1, layoutRevision: 1, slotCount: LIST_SLOTS }] },
  } })
}
