import { test } from "node:test"
import assert from "node:assert/strict"
import { matchingWantIndexes, pickerCandidate, pickerChoices, prepareSlotPickerIntent, speciesSelectorCard } from "@/lib/slot-picker"
import { syntheticSlotPickerSnapshot } from "@/tests/fixtures/slot-picker"
import { projectSlotIntent } from "@/lib/collection/slot-optimistic"

const context = { source: "app" as const, clientId: null, operationId: "picker-operation", batchId: null, clientOccurredAt: null }
const setup = () => {
  const data = syntheticSlotPickerSnapshot()
  const resolve = (id: string) => data.cards.find(c => c.id === id || c.aliasIds?.includes(id)) ? pickerCandidate(data.cards.find(c => c.id === id || c.aliasIds?.includes(id))!) : undefined
  const scope = { ownerUserId: data.inventory.ownerUserId, collectionId: data.binder.collectionId, slotId: "slot-g" }
  return { ...data, resolve, scope }
}
test("free slot accepts catalog cards without dex and preserves unrelated slots", () => {
  for (const name of ["Trainer", "Energy", "Item", "Tandemaus", "Maushold", "Snorlax A"]) {
    const { inventory, cards, resolve, scope } = setup()
    const card = cards.find(c => c.name === name)!
    const identity = { kind: "card" as const, cardId: card.id, language: "en" as const, finish: "normal" as const }
    const selection = pickerChoices(inventory, identity, resolve)[0]?.selection ?? { kind: "catalog" as const, identity, newItemId: "new-copy" }
    const intent = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection, fulfillWant: null }, context, resolve)
    const after = projectSlotIntent(inventory, intent.intent, resolve)
    assert.equal(after.items.find(i => i.id === after.binders[0].slots[6].inventoryItemId)?.identity.kind, "card")
    assert.deepEqual(after.binders[0].slots.slice(0, 6), inventory.binders[0].slots.slice(0, 6))
  }
})
test("copy choices retain explicit IDs, stable raw choice and private metadata", () => {
  const { inventory, cards, resolve, scope } = setup()
  const choices = pickerChoices(inventory, { kind: "card", cardId: cards[0].id, language: "en", finish: "normal" }, resolve)
  assert.deepEqual(choices.map(c => c.label), ["Raw", "PSA 9"])
  assert.equal(choices[0].selection.kind === "existing" && choices[0].selection.inventoryItemId, "unassigned-a")
  assert.ok(!JSON.stringify(choices).includes("PRIVATE"))
  const intent = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection: choices[1].selection, fulfillWant: null }, context, resolve)
  assert.equal(intent.preview.binders[0].slots[6].inventoryItemId, "unassigned-grade")
  assert.deepEqual(intent.preview.items.find(i => i.id === "unassigned-grade"), inventory.items.find(i => i.id === "unassigned-grade"))
  const stale = structuredClone(inventory)
  stale.items = stale.items.filter(i => i.id !== "unassigned-grade")
  assert.throws(() => prepareSlotPickerIntent(stale, scope, { kind: "assign", selection: choices[1].selection, fulfillWant: null }, context, resolve), /item-conflict/)
})
test("target evidence uses aliases, multiple dex and unknown variants honestly", () => {
  const { inventory, cards, scope, resolve } = setup()
  const base = structuredClone(inventory)
  base.binders[0].slots[6].target = { kind: "pokemon", pokemonId: 25 }
  const assign = (id: string, language?: "en" | "ja", finish?: "normal" | "holo") => ({ kind: "assign" as const, selection: { kind: "catalog" as const, identity: { kind: "card" as const, cardId: id, ...(language ? { language } : {}), ...(finish ? { finish } : {}) }, newItemId: "new-copy" }, fulfillWant: null })
  assert.throws(() => prepareSlotPickerIntent(base, scope, assign(cards[0].id), context, resolve), /target-mismatch/)
  assert.doesNotThrow(() => prepareSlotPickerIntent(base, scope, assign("synthetic-multi"), context, resolve))
  base.binders[0].slots[6].target = { kind: "card", cardId: "trainer-alias", language: "ja", finish: "holo" }
  for (const [language, finish] of [[undefined, undefined], ["en", "holo"], ["ja", "normal"]] as const) assert.throws(() => prepareSlotPickerIntent(base, scope, assign("synthetic-trainer", language, finish), context, resolve), /target-mismatch/)
  assert.doesNotThrow(() => prepareSlotPickerIntent(base, scope, assign("synthetic-trainer", "ja", "holo"), context, resolve))
})
test("incompatible occupied target cancels; remove target and clear have distinct effects", () => {
  const { inventory, scope, resolve } = setup()
  scope.slotId = "slot-a"
  const before = structuredClone(inventory)
  assert.throws(() => prepareSlotPickerIntent(inventory, scope, { kind: "target", target: { kind: "pokemon", pokemonId: 25 } }, context, resolve), /occupied-target/)
  assert.deepEqual(inventory, before)
  const removed = prepareSlotPickerIntent(inventory, scope, { kind: "target", target: null }, context, resolve).preview
  assert.equal(removed.binders[0].slots[0].inventoryItemId, "item-a")
  assert.equal(removed.binders[0].slots[0].target, null)
  const cleared = prepareSlotPickerIntent(inventory, scope, { kind: "clear" }, context, resolve).preview
  assert.deepEqual(cleared.binders[0].slots[0].target, inventory.binders[0].slots[0].target)
  assert.equal(cleared.binders[0].layoutRevision, inventory.binders[0].layoutRevision)
  assert.ok(cleared.items.some(i => i.id === "item-a"))
  assert.ok(!cleared.placements.some(p => p.inventoryItemId === "item-a"))
})
test("fulfills only the explicitly chosen want and rejects cross-scope calls", () => {
  const { inventory, scope, resolve } = setup()
  const want = { card_id: "synthetic-energy", card_name: "Energy", added_at: "2026-01-01T00:00:00Z" }
  inventory.binders[0].slots[6].wantedCards = [want, want]
  inventory.binders[0].slots[5].wantedCards = [want]
  const action = { kind: "assign" as const, selection: { kind: "catalog" as const, identity: { kind: "card" as const, cardId: want.card_id }, newItemId: "new-copy" }, fulfillWant: { index: 1, expected: want } }
  const result = prepareSlotPickerIntent(inventory, scope, action, context, resolve)
  assert.equal(result.preview.binders[0].slots[6].wantedCards.length, 1)
  assert.equal(result.preview.binders[0].slots[5].wantedCards.length, 1)
  for (const other of [{ ...scope, ownerUserId: "other" }, { ...scope, collectionId: "other" }, { ...scope, slotId: "missing" }]) assert.throws(() => prepareSlotPickerIntent(inventory, other, action, context, resolve), /scope/)
})
test("offline cached search retains non-dex cards and canonical aliases", async () => {
  const { extractCardsFromCachedResponse } = await import("@/lib/offline-card-index")
  const { cards } = setup()
  const trainer = cards.find(c => c.name === "Trainer")!
  const cached = extractCardsFromCachedResponse("/app/api/tcg-card-search?q=trainer", { cards: [trainer] })
  assert.equal(cached.length, 1)
  assert.deepEqual(cached[0].dexIds, [])
  assert.deepEqual(cached[0].aliasIds, ["trainer-alias"])
})
test("duplicate printings retain distinct physical copies and stable slots", () => {
  const { inventory, scope, resolve } = setup()
  inventory.items = inventory.items.filter(i => !i.id.startsWith("unassigned"))
  const action = (newItemId: string) => ({ kind: "assign" as const, selection: { kind: "catalog" as const, identity: { kind: "card" as const, cardId: "synthetic-snorlax-a", language: "en" as const, finish: "normal" as const }, newItemId }, fulfillWant: null })
  const first = prepareSlotPickerIntent(inventory, scope, action("duplicate-1"), context, resolve).preview
  const second = prepareSlotPickerIntent(first, { ...scope, slotId: "slot-e" }, action("duplicate-2"), { ...context, operationId: "second-operation" }, resolve).preview
  assert.equal(second.items.filter(i => i.identity.kind === "card" && i.identity.cardId === "synthetic-snorlax-a").length, 3)
  assert.equal(second.binders[0].slots[0].inventoryItemId, "item-a")
  assert.equal(second.binders[0].slots[4].inventoryItemId, "duplicate-2")
  assert.equal(second.binders[0].slots[6].inventoryItemId, "duplicate-1")
  assert.equal(second.binders[0].layoutRevision, inventory.binders[0].layoutRevision)
})
test("provider finish evidence and unknown metadata remain honest", async () => {
  const { pickerFinishes } = await import("@/lib/slot-picker")
  const { cards, inventory, scope, resolve } = setup()
  const card = { ...cards[2], variants: undefined, language: undefined }
  assert.deepEqual(pickerFinishes(card), [])
  assert.deepEqual(pickerFinishes(card, [{ finish: "reverse_holo", variantKey: "reverse-holofoil", gbpAmount: 2 }]).map(f => f.finish), ["reverse_holo"])
  assert.deepEqual(pickerFinishes(card, [{ finish: "normal", variantKey: "normal", gbpAmount: 0 }]), [])
  const result = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection: { kind: "catalog", identity: { kind: "card", cardId: card.id, language: "ja", finish: "reverse_holo" }, newItemId: "japanese-copy" }, fulfillWant: null }, context, resolve)
  assert.deepEqual(result.preview.items.find(i => i.id === "japanese-copy")?.identity, { kind: "card", cardId: card.id, language: "ja", finish: "reverse_holo" })
})
test("each stale revision and chosen copy placement rejects instead of substituting", () => {
  const { inventory, scope, resolve } = setup()
  const selection = pickerChoices(inventory, { kind: "card", cardId: "synthetic-snorlax-a", language: "en", finish: "normal" }, resolve)[0].selection
  const draft = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection, fulfillWant: null }, context, resolve)
  const mutations = [
    (s: typeof inventory) => { s.inventoryRevision++ },
    (s: typeof inventory) => { s.collections[0].version++ },
    (s: typeof inventory) => { s.binders[0].layoutRevision++ },
    (s: typeof inventory) => { s.binders[0].slots[6].version++ },
    (s: typeof inventory) => { s.items.find(i => i.id === "unassigned-a")!.version++ },
  ]
  for (const mutate of mutations) { const changed = structuredClone(inventory); mutate(changed); assert.throws(() => projectSlotIntent(changed, draft.intent, resolve), /conflict/) }
  const placed = structuredClone(inventory)
  placed.binders[0].slots[4].inventoryItemId = "unassigned-a"
  placed.binders[0].slots[4].status = "collected"
  placed.placements.push({ inventoryItemId: "unassigned-a", collectionId: scope.collectionId, slotId: "slot-e", version: 0 })
  assert.throws(() => prepareSlotPickerIntent(placed, scope, { kind: "assign", selection, fulfillWant: null }, context, resolve), /placement-conflict/)
})
test("offline merging preserves unknown versus known language and later alias evidence", async () => {
  const { mergeSearchCards, searchOfflineCards } = await import("@/lib/offline-card-index")
  const { cards } = setup()
  const unknown = { ...cards[2], language: undefined, aliasIds: undefined }
  const known = { ...cards[2], language: "en", canonicalId: cards[2].id }
  const merged = mergeSearchCards([[unknown], [known]])
  assert.equal(merged.length, 2)
  const supplemented = mergeSearchCards([[{ ...known, canonicalId: undefined, aliasIds: undefined }], [known]])
  assert.deepEqual(supplemented[0].aliasIds, ["trainer-alias"])
  assert.equal(searchOfflineCards(supplemented, "trainer-alias")[0]?.id, known.id)
})

test("recorded graded-only groups never offer a fabricated raw copy", () => {
  const { inventory, resolve } = setup()
  inventory.items = inventory.items.filter(i => !["unassigned-a", "unassigned-b"].includes(i.id))
  const choices = pickerChoices(inventory, { kind: "card", cardId: "synthetic-snorlax-a", language: "en", finish: "normal" }, resolve)
  assert.deepEqual(choices.map(c => c.label), ["PSA 9"])
  assert.deepEqual(choices[0].selection, { kind: "existing", inventoryItemId: "unassigned-grade", itemVersion: 1 })
})

// Synthetic card and wants for the species selector hand-off.
const synthWant = (over: object = {}) => ({ card_id: "synthetic-snorlax-a", card_name: "Snorlax A", added_at: "2026-11-10T00:00:00.000Z", ...over })
test("a species selector pick carries only the dex link the list was joined on", () => {
  const { cards } = setup()
  const { dexIds: _ignored, ...tcg } = cards[0]
  const card = speciesSelectorCard({ ...tcg, language: "ja" }, 143)
  assert.deepEqual(card.dexIds, [143])
  assert.equal(card.language, "ja")
  assert.equal(pickerCandidate(card).language, "ja")
  assert.deepEqual(pickerCandidate(card).pokemonIds, [143])
})
test("a want matches only the exact card, language and finish, never by species", () => {
  const { cards } = setup()
  const snorlaxA = cards[0], snorlaxB = cards[1]
  const wants = [synthWant(), synthWant({ card_language: "ja" }), synthWant({ card_finish: "holo" }), synthWant({ card_id: "synthetic-snorlax-b" })]
  assert.deepEqual(matchingWantIndexes(wants, snorlaxA, "normal"), [0])
  assert.deepEqual(matchingWantIndexes(wants, { ...snorlaxA, language: "ja" }, "normal"), [0, 1])
  assert.deepEqual(matchingWantIndexes(wants, snorlaxA, "holo"), [0, 2])
  // An unknown finish never satisfies a want that names one.
  assert.deepEqual(matchingWantIndexes(wants, snorlaxA, undefined), [0])
  assert.deepEqual(matchingWantIndexes(wants, snorlaxB, "normal"), [3])
  assert.deepEqual(matchingWantIndexes([], snorlaxA, "normal"), [])
})
test("fulfilling a matched want keeps the exact want identity and slot versions of a plain assign", () => {
  const { inventory, cards, scope, resolve } = setup()
  const slot = inventory.binders[0].slots.find(s => s.id === scope.slotId)!
  slot.wantedCards = [synthWant()]
  const identity = { kind: "card" as const, cardId: cards[0].id, language: "en" as const, finish: "normal" as const }
  const selection = pickerChoices(inventory, identity, resolve)[0].selection
  const plain = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection, fulfillWant: null }, context, resolve)
  const fulfil = prepareSlotPickerIntent(inventory, scope, { kind: "assign", selection, fulfillWant: { index: 0, expected: slot.wantedCards[0] } }, context, resolve)
  assert.deepEqual(plain.scope, fulfil.scope)
  const command = (p: typeof plain) => p.intent.kind === "inventory" ? p.intent.request.commands[0] : null
  assert.equal(command(plain)?.kind, "assign")
  assert.deepEqual({ ...command(fulfil)!, fulfillWant: null }, command(plain))
  assert.equal(fulfil.preview.binders[0].slots[6].wantedCards.length, 0)
  assert.equal(plain.preview.binders[0].slots[6].wantedCards.length, 1)
})

test("a native pick saves at once only when no graded copy or slot want needs an explicit choice", async () => {
  const { planNativePick } = await import("@/lib/slot-picker")
  const { inventory, cards, resolve, scope } = setup()
  const trainer = cards.find(c => c.name === "Trainer")!
  const plain = planNativePick(inventory, scope, trainer, "normal", resolve, "new-id")
  assert.equal(plain.choices.length, 0)
  assert.deepEqual(plain.immediate, { kind: "catalog", identity: { kind: "card", cardId: trainer.id, language: "en", finish: "normal" }, newItemId: "new-id" })
  // Snorlax A: an unplaced raw copy and an unplaced PSA 9, so the copy is an explicit choice.
  const graded = planNativePick(inventory, scope, cards[0], "normal", resolve, "new-id")
  assert.equal(graded.immediate, null)
  assert.deepEqual(graded.choices.map(c => c.label), ["Raw", "PSA 9"])
  // An unknown printing (not in the read catalog) still plans from the picked card's own evidence.
  const unknown = { ...trainer, id: "synthetic-unowned", aliasIds: [] }
  const plan = planNativePick(inventory, scope, unknown, "normal", () => undefined, "new-id")
  assert.equal(plan.resolver("synthetic-unowned")?.id, "synthetic-unowned")
  assert.ok(plan.immediate)
  // A slot want this card matches always asks first.
  const wanted = structuredClone(inventory)
  wanted.binders[0].slots[6].wantedCards = [{ card_id: trainer.id, card_name: "Trainer", added_at: "2026-01-01" } as never]
  const asks = planNativePick(wanted, scope, trainer, "normal", resolve, "new-id")
  assert.equal(asks.immediate, null)
  assert.deepEqual(asks.wants, [{ index: 0, name: "Trainer" }])
  assert.deepEqual(asks.wanted(0), { index: 0, expected: wanted.binders[0].slots[6].wantedCards[0] })
  assert.throws(() => planNativePick(inventory, { ...scope, slotId: "missing" }, trainer, "normal", resolve, "x"), /picker-scope-changed/)
})
