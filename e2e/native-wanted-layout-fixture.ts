import { E2E_USER } from "./fixtures"
import type { InventorySnapshot } from "../lib/domain/inventory"
import type { InventoryCatalogEvidence } from "../lib/domain/inventory-browse"
import type { Route } from "@playwright/test"

// Synthetic only: 483 explicit wanted entries across two collections, with duplicates of the same card at different
// destinations, occupied pockets (an owned copy plus an upgrade want), unknown finish, an unknown language, a non-English
// printing and very long names. Never real owner data.
export const WANT_COLLECTION = "22222222-2222-4222-8222-222222222222"
export const LONG_COLLECTION = "33333333-3333-4333-8333-333333333333"
export const WANT_TOTAL = 483
export const wantedEntry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${WANT_COLLECTION}`
export const longEntry = `/app/e2e-harness?signedIn=1&browserHost=1&binder=${LONG_COLLECTION}`
export const LONG_COLLECTION_NAME = "Synthetic collection with an extraordinarily long display name that has to wrap cleanly 火"

const img = (id: string) => `https://assets.tcgdex.net/en/synthetic/${id}/high.webp`
const set = { id: "synthetic", name: "Synthetic Base" }
export const wantedCatalog: InventoryCatalogEvidence[] = [
  { card: { id: "synthetic-charizard", name: "Synthetic Charizard", localId: "4", language: "en", set, image: img("synthetic-charizard") }, speciesNames: ["Charizard"], pokemonIds: [6] },
  { card: { id: "synthetic-pikachu", name: "Synthetic Pikachu", localId: "25", language: "en", set, image: img("synthetic-pikachu") }, speciesNames: ["Pikachu"], pokemonIds: [25] },
  { card: { id: "synthetic-long", name: "Synthetic extraordinarily long card display name that has to wrap or truncate cleanly 火リザードン", localId: "SYN-123", language: "en",
    set: { id: "synthetic-long-set", name: "Synthetic extremely long catalog set display evidence" }, image: img("synthetic-long") }, speciesNames: ["Charizard"], pokemonIds: [6] },
  { card: { id: "synthetic-ja", name: "Synthetic リザードン", localId: "006", language: "ja", set: { id: "synthetic-ja-set", name: "Synthetic 拡張パック" }, image: img("synthetic-ja") }, speciesNames: ["Charizard"], pokemonIds: [6] },
  { card: { id: "synthetic-trainer", name: "Synthetic Trainer", localId: "89", language: "en", set, image: img("synthetic-trainer") }, speciesNames: [] },
  { card: { id: "synthetic-energy", name: "Synthetic Energy", localId: "98", language: "en", set, image: img("synthetic-energy") }, speciesNames: [] },
]
const finishes = ["normal", "holo", "reverse_holo"] as const
const ownedId = "synthetic-owned-copy"

type Slot = InventorySnapshot["binders"][number]["slots"][number]
export function wantedSnapshot(total = WANT_TOTAL, revision = 1): InventorySnapshot {
  const ownerUserId = E2E_USER.id
  const collections: InventorySnapshot["collections"] = [
    { id: WANT_COLLECTION, ownerUserId, name: "Synthetic wanted binder", kind: "binder", defaultPresentation: "binder", version: 1 },
    { id: LONG_COLLECTION, ownerUserId, name: LONG_COLLECTION_NAME, kind: "binder", defaultPresentation: "binder", version: 1 },
  ]
  const items: InventorySnapshot["items"] = []
  // A few spare copies of the first card so the copy selector has real "Unassigned copy" choices.
  for (let n = 0; n < 3; n++) items.push({ id: `synthetic-spare-${n}`, ownerUserId, grading: null, acquiredAt: null, version: 1,
    identity: { kind: "card", cardId: "synthetic-charizard", language: "en", finish: "normal" } })
  const slots: Record<string, Slot[]> = { [WANT_COLLECTION]: [], [LONG_COLLECTION]: [] }
  let wants = 0, n = 0
  while (wants < total) {
    const collectionId = WANT_COLLECTION
    const count = Math.min(n % 9 === 0 ? 3 : n % 4 === 0 ? 2 : 1, total - wants)
    // Every third pocket already holds a copy: an upgrade want on an owned pocket is a normal state.
    const occupied = n % 3 === 1
    let inventoryItemId: string | null = null
    if (occupied) { inventoryItemId = `${ownedId}-${n}`
      items.push({ id: inventoryItemId, ownerUserId, grading: null, acquiredAt: null, version: 1, identity: { kind: "card", cardId: "synthetic-pikachu", language: "en", finish: "normal" } }) }
    const wantedCards = Array.from({ length: count }, (_, k) => {
      const pick = (n + k) % wantedCatalog.length
      const card = wantedCatalog[pick].card
      const want: Slot["wantedCards"][number] = { card_id: card.id, card_name: card.name, added_at: "2026-11-09T00:00:00Z", card_language: card.language as "en" | "ja" }
      // Unknown finish on every eleventh want, unknown language on every forty-seventh: never inferred.
      if ((wants + k) % 11 !== 0) want.card_finish = finishes[(n + k) % 3]
      if ((wants + k) % 47 === 46) delete want.card_language
      return want
    })
    slots[collectionId].push({ id: `synthetic-want-slot-${n}`, ownerUserId, collectionId, inventoryItemId, target: null,
      status: inventoryItemId ? "collected" as const : null, wantedCards, version: 1, presetOrigin: null })
    wants += count; n++
  }
  // A small second collection with a very long name, opened with binder=LONG_COLLECTION. Not counted in the 483.
  if (total) slots[LONG_COLLECTION].push({ id: "synthetic-long-slot-0", ownerUserId, collectionId: LONG_COLLECTION, inventoryItemId: null, target: null, status: null, version: 1, presetOrigin: null,
    wantedCards: wantedCatalog.slice(0, 3).map(({ card }) => ({ card_id: card.id, card_name: card.name, added_at: "2026-11-09T00:00:00Z", card_language: card.language as "en", card_finish: "holo" as const })) })
  // A binder with no explicit wants still needs real slots (targets are never wants).
  for (const [collectionId, list] of Object.entries(slots)) if (!list.length) list.push({ id: `synthetic-empty-${collectionId}`, ownerUserId, collectionId, inventoryItemId: null,
    target: { kind: "pokemon", pokemonId: 1 }, status: null, wantedCards: [], version: 1, presetOrigin: null })
  const placements = Object.values(slots).flat().filter(s => s.inventoryItemId).map(s => ({ inventoryItemId: s.inventoryItemId!, collectionId: s.collectionId, slotId: s.id, version: 1 }))
  return { ownerUserId, inventoryRevision: revision, items, placements, collections,
    binders: collections.map(c => ({ ownerUserId, collectionId: c.id, layoutRevision: 1, presetManifest: null, slots: slots[c.id] })) }
}

export async function fulfillWantedInventory(route: Route, total = WANT_TOTAL, revision = 1) {
  const s = wantedSnapshot(total, revision), url = new URL(route.request().url())
  await route.fulfill({ headers: { "Cache-Control": "private, no-store" }, json: {
    version: 2, requestId: url.searchParams.get("requestId"), scope: { actorUserId: E2E_USER.id, ownerUserId: E2E_USER.id,
      authSessionId: "synthetic-e2e-auth-session", sessionId: url.searchParams.get("sessionId") }, snapshot: s,
    navigation: { catalog: wantedCatalog, layouts: [{ collectionId: WANT_COLLECTION, layoutRevision: 1, rows: 3, cols: 3 }, { collectionId: LONG_COLLECTION, layoutRevision: 1, rows: 4, cols: 4 }] },
    evidence: { inventoryRevision: revision, items: s.items.length, placements: s.placements.length, collections: 2, binders: 2,
      slots: s.binders.reduce((total, b) => total + b.slots.length, 0),
      storage: s.binders.map(b => ({ collectionId: b.collectionId, collectionVersion: 1, layoutRevision: 1, slotCount: b.slots.length })) },
  } })
}
