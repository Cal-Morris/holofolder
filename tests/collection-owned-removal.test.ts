import test from "node:test"
import assert from "node:assert/strict"
import type { CollectedPokemon, WantedCard } from "../lib/domain/cards"
import {
  isOwnedCollectionItem,
  moveOwnedItemToWanted,
  ownedCardAsWantedCard,
  planOwnedRemoval,
} from "../lib/collection/owned-removal"
import { applyPendingEdits, collectionFingerprint, resolveConflict } from "../lib/collection/sync"
import { normalizeCollectionItem } from "../lib/collection/normalize"
import { queuePendingCollectionOperation, readPendingCollectionOperations } from "../lib/collection/offline-queue"

const NOW = "2026-10-10T12:00:00.000Z"

const want = (card_id: string, overrides: Partial<WantedCard> = {}): WantedCard => ({
  card_id,
  card_name: card_id,
  card_language: "en",
  card_finish: "normal",
  added_at: "2026-10-01T00:00:00.000Z",
  ...overrides,
})

const owned = (overrides: Partial<CollectedPokemon> = {}): CollectedPokemon => normalizeCollectionItem({
  id: "row-25",
  pokemon_id: 25,
  pokemon_name: "pikachu",
  card_id: "sv03.5-025",
  card_name: "Pikachu",
  card_image: "https://assets.tcgdex.net/ja/sv/sv03.5/025",
  card_set: "151",
  card_language: "ja",
  card_finish: "reverse_holo",
  wanted_cards: [want("base1-58")],
  status: "finalized",
  collected_at: "2026-10-01T00:00:00.000Z",
  ...overrides,
})

test("only non-wanted rows count as owned", () => {
  assert.equal(isOwnedCollectionItem(owned()), true)
  assert.equal(isOwnedCollectionItem(owned({ status: "considering" })), true)
  assert.equal(isOwnedCollectionItem(owned({ status: "wishlisted" })), false)
  assert.equal(isOwnedCollectionItem(undefined), false)
  assert.equal(isOwnedCollectionItem(null), false)
})

test("move back to Wanted clears the owned printing and puts it first on the wanted list", () => {
  const before = owned()
  const after = moveOwnedItemToWanted(before, NOW)

  assert.equal(after.status, "wishlisted")
  assert.equal(after.card_id, undefined)
  assert.equal(after.card_name, undefined)
  assert.equal(after.card_image, undefined)
  assert.equal(after.card_set, undefined)
  assert.equal(after.id, before.id)
  assert.equal(after.pokemon_id, 25)
  assert.equal(after.collected_at, before.collected_at)
  assert.deepEqual(after.wanted_cards.map((card) => [card.card_id, card.card_language, card.card_finish]), [
    ["sv03.5-025", "ja", "reverse_holo"],
    ["base1-58", "en", "normal"],
  ])
  assert.equal(after.wanted_cards[0].card_image, before.card_image)
  assert.equal(after.wanted_cards[0].card_set, "151")
  assert.equal(after.wanted_cards[0].added_at, NOW)
  // The input row is left untouched (it is what undo writes back).
  assert.equal(before.status, "finalized")
  assert.equal(before.card_id, "sv03.5-025")
})

test("the owned printing is not duplicated when it was already wanted", () => {
  const before = owned({ wanted_cards: [want("x"), want("sv03.5-025", { card_language: "ja", card_finish: "reverse_holo" })] })
  const after = moveOwnedItemToWanted(before, NOW)
  assert.deepEqual(after.wanted_cards.map((card) => card.card_id), ["sv03.5-025", "x"])
  // A different finish of the same card is a different wanted entry.
  const otherFinish = moveOwnedItemToWanted(owned({ wanted_cards: [want("sv03.5-025", { card_language: "ja" })] }), NOW)
  assert.equal(otherFinish.wanted_cards.length, 2)
})

test("a slot owned without a specific card becomes a plain wanted slot", () => {
  const before = owned({ card_id: undefined, card_name: undefined, card_image: undefined, card_set: undefined, wanted_cards: [] })
  assert.equal(ownedCardAsWantedCard(before, NOW), null)
  const after = moveOwnedItemToWanted(before, NOW)
  assert.equal(after.status, "wishlisted")
  assert.deepEqual(after.wanted_cards, [])
  // Survives a round trip through the normalizer (what the server and local storage do) without inventing a card.
  assert.deepEqual(normalizeCollectionItem(after), after)
})

test("the wanted row round-trips through the normalizer unchanged", () => {
  const after = moveOwnedItemToWanted(owned(), NOW)
  assert.deepEqual(normalizeCollectionItem(after), after)
  assert.equal(collectionFingerprint(normalizeCollectionItem(after)), collectionFingerprint(after))
})

test("remove completely deletes the row; both modes keep the exact previous row for undo", () => {
  const before = owned()
  const toWanted = planOwnedRemoval(before, "to-wanted", NOW)
  const removed = planOwnedRemoval(before, "remove", NOW)
  assert.equal(removed.next, null)
  assert.ok(toWanted.next)
  assert.equal(toWanted.previous, before)
  assert.equal(removed.previous, before)
})

test("owned -> wanted -> undo -> owned restores card, variant, finish and language exactly", () => {
  const before = owned()
  const { next, previous } = planOwnedRemoval(before, "to-wanted", NOW)
  let collection = applyPendingEdits([before], [{ type: "upsert", pokemonId: 25, item: next!, base: before }])
  assert.equal(collection[0].status, "wishlisted")

  collection = applyPendingEdits(collection, [{ type: "upsert", pokemonId: 25, item: previous, base: next }])
  assert.deepEqual(collection[0], before)
  assert.equal(collectionFingerprint(collection[0]), collectionFingerprint(before))

  // Same for remove completely: the row comes back exactly.
  const removed = applyPendingEdits([before], [{ type: "delete", pokemonId: 25, base: before }])
  assert.deepEqual(removed, [])
  assert.deepEqual(applyPendingEdits(removed, [{ type: "upsert", pokemonId: 25, item: before, base: null }]), [before])
})

test("offline: move then undo collapses into one queued edit that is a no-op for the server", () => {
  const globals = globalThis as { window?: unknown }
  const values = new Map<string, string>()
  globals.window = { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) } }
  try {
    const before = owned()
    const { next, previous } = planOwnedRemoval(before, "to-wanted", NOW)
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: next!, base: before })
    queuePendingCollectionOperation({ type: "upsert", pokemonId: 25, item: previous, base: next })

    const operations = readPendingCollectionOperations()
    assert.equal(operations.length, 1)
    const [operation] = operations
    assert.equal(operation.type, "upsert")
    if (operation.type !== "upsert") return
    assert.equal(collectionFingerprint(operation.item), collectionFingerprint(before))
    assert.equal(collectionFingerprint(operation.base), collectionFingerprint(before))
    // If the server still has the original row, syncing the queue writes nothing new.
    assert.equal(resolveConflict(operation, before).action, "drop")
  } finally {
    delete globals.window
  }
})

test("offline: a move to Wanted merges with a partner's concurrent wanted-card change", () => {
  const before = owned()
  const { next } = planOwnedRemoval(before, "to-wanted", NOW)
  const server = owned({ wanted_cards: [want("base1-58"), want("partner")] })
  const resolution = resolveConflict({ type: "upsert", pokemonId: 25, item: next!, base: before }, server)
  assert.equal(resolution.action, "write")
  if (resolution.action !== "write") return
  assert.equal(resolution.item.status, "wishlisted")
  assert.equal(resolution.item.card_id, undefined)
  assert.deepEqual(resolution.item.wanted_cards.map((card) => card.card_id).sort(), ["base1-58", "partner", "sv03.5-025"])
})
