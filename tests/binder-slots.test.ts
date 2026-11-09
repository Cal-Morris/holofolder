import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  normalizeBinderSlot, normalizeBinderSnapshot, getBinderCompletion, canChangeSlotTarget,
  type BinderSlot, type BinderSnapshot, type SlotTargetCandidate,
} from "@/lib/domain/binder-slots"
import { planInsertSlots, planMoveSlots, planClearSlots, planRemoveSlots, planChangeSlotTarget } from "@/lib/binder-slot-plans"

// Synthetic IDs and catalog records only.
const candidate: SlotTargetCandidate = { kind: "card", id: "synthetic-card", pokemonIds: [143], aliasIds: ["synthetic-alias"] }
function slot(id: string, changes: Partial<BinderSlot> = {}): BinderSlot {
  return { id, ownerUserId: "owner", collectionId: "binder", target: null, inventoryItemId: null, wantedCards: [], status: null, version: 0, presetOrigin: null, ...changes }
}
function snapshot(slots: BinderSlot[]): BinderSnapshot {
  return { ownerUserId: "owner", collectionId: "binder", layoutRevision: 4, slots, presetManifest: null }
}
const occupied = (id: string) => slot(id, { target: { kind: "pokemon", pokemonId: 143 }, inventoryItemId: `item-${id}`, status: "collected" })

function success(result: ReturnType<typeof planMoveSlots>) {
  assert.equal(result.ok, true)
  return result
}

describe("stable slot and snapshot normalization", () => {
  test("retains distinct slots/copies with repeated printing and Pokémon IDs", () => {
    const input = snapshot([occupied("a"), occupied("b"), slot("trainer", { target: { kind: "card", cardId: candidate.id } })])
    const normalized = normalizeBinderSnapshot(input)
    assert.deepEqual(normalized, input)
    assert.notEqual(normalized, input)
    input.slots[0].target = null
    assert.deepEqual(normalized?.slots[0].target, { kind: "pokemon", pokemonId: 143 })
  })

  test("rejects unknown fields, missing fields, invalid versions, states and malformed wants", () => {
    const valid = slot("a")
    for (const patch of [
      { target: undefined }, { inventoryItemId: undefined }, { id: " a " }, { version: -1 }, { version: 1.5 },
      { version: Number.MAX_SAFE_INTEGER + 1 }, { status: "owned" }, { status: "collected" },
      { inventoryItemId: "copy" }, { wantedCards: [null] }, { wantedCards: Array(1) }, { wantedCards: [{ card_id: "x" }] },
      { wantedCards: [{ card_id: "x", card_name: "Synthetic", added_at: "bad date" }] },
      { wantedCards: [{ card_id: "x", card_name: "Synthetic", added_at: "2026-01-01T00:00:00Z", card_language: "unknown" }] },
      { pokemon_id: 143 }, { grading: {} }, { presetOrigin: {} },
    ]) assert.equal(normalizeBinderSlot({ ...valid, ...patch }), undefined, JSON.stringify(patch))
    for (const value of [null, [], {}, undefined]) assert.equal(normalizeBinderSlot(value), undefined)
    assert.ok(normalizeBinderSlot(occupied("legacy")))
  })

  test("copies shared WantedCard values without defaults or loss of assignments", () => {
    const input = slot("want", { wantedCards: [{ card_id: candidate.id, card_name: "Synthetic", added_at: "2026-01-01T00:00:00Z", wanted_by: [] }], status: "wishlisted" })
    const normalized = normalizeBinderSlot(input)!
    assert.deepEqual(normalized, input)
    input.wantedCards[0].wanted_by!.push("changed")
    assert.deepEqual(normalized.wantedCards[0].wanted_by, [])
    assert.equal(normalized.wantedCards[0].card_language, undefined)
  })

  test("rejects duplicate stable IDs, duplicate placements, mixed scopes and malformed snapshots", () => {
    for (const value of [
      snapshot([slot("a"), slot("a")]), snapshot([occupied("a"), { ...occupied("b"), inventoryItemId: "item-a" }]),
      snapshot([slot("a", { ownerUserId: "other" })]), snapshot([slot("a", { collectionId: "other" })]),
      { ...snapshot([]), layoutRevision: -1 }, { ...snapshot([]), extra: true }, { ...snapshot([]), presetManifest: {} },
    ]) assert.equal(normalizeBinderSnapshot(value), undefined)
  })
})

describe("pure layout plans", () => {
  test("insert shifts every following slot, retaining explicit trailing blanks", () => {
    const before = snapshot([occupied("a"), slot("blank"), occupied("b"), slot("trailing")])
    const original = structuredClone(before)
    const plan = success(planInsertSlots(before, 4, [slot("new1"), slot("new2")], "blank"))
    assert.deepEqual(plan.snapshot.slots.map(s => s.id), ["a", "new1", "new2", "blank", "b", "trailing"])
    assert.equal(plan.snapshot.layoutRevision, 5)
    assert.equal(plan.baseLayoutRevision, 4)
    assert.deepEqual(before, original)
    assert.deepEqual(plan.unassignedInventoryItemIds, [])
  })

  test("bulk move carries whole slots in saved relative order, independent of selection order", () => {
    const a = occupied("a")
    a.wantedCards = [{ card_id: "synthetic-want", card_name: "Synthetic", added_at: "2026-01-01" }]
    a.presetOrigin = { source: { id: "synthetic-preset", version: "v1" }, entryId: "entry" }
    const before = snapshot([a, slot("blank"), occupied("b"), slot("c")])
    before.presetManifest = { source: { ...a.presetOrigin.source }, name: "Synthetic", entries: [{ id: "entry", target: { kind: "pokemon", pokemonId: 143 } }] }
    const plan = success(planMoveSlots(before, 4, ["b", "a"], null))
    assert.deepEqual(plan.snapshot.slots.map(s => s.id), ["blank", "c", "a", "b"])
    assert.deepEqual(plan.snapshot.slots[2], a)
    assert.equal(plan.snapshot.slots[2].version, 0)
    assert.deepEqual(plan.unassignedInventoryItemIds, [])
    plan.snapshot.slots[2].wantedCards.length = 0
    assert.equal(a.wantedCards.length, 1)
  })

  test("clear retains target, wants, origin and stable ID while unassigning, remove deletes only selected slots", () => {
    const a = occupied("a")
    a.wantedCards = [{ card_id: "synthetic-want", card_name: "Synthetic", added_at: "2026-01-01" }]
    const before = snapshot([a, occupied("b"), slot("trailing")])
    const clear = success(planClearSlots(before, 4, ["a"]))
    assert.deepEqual(clear.snapshot.slots[0], { ...a, inventoryItemId: null, status: null, version: 1 })
    assert.deepEqual(clear.unassignedInventoryItemIds, ["item-a"])
    assert.equal(clear.snapshot.layoutRevision, 4)
    assert.deepEqual(clear.expectedSlotVersions, { a: 0 })
    const special = success(planClearSlots(snapshot([occupied("__proto__")]), 4, ["__proto__"]))
    assert.equal(Object.hasOwn(special.expectedSlotVersions, "__proto__"), true)
    assert.equal(special.expectedSlotVersions.__proto__, 0)
    const remove = success(planRemoveSlots(before, 4, ["a"]))
    assert.deepEqual(remove.snapshot.slots.map(s => s.id), ["b", "trailing"])
    assert.equal(remove.snapshot.layoutRevision, 5)
    assert.deepEqual(remove.unassignedInventoryItemIds, ["item-a"])
    assert.equal(before.slots[0].inventoryItemId, "item-a")
  })

  test("rejects stale, missing, duplicate and ambiguous commands without partial changes", () => {
    const before = snapshot([occupied("a"), slot("b")])
    const original = structuredClone(before)
    const failures = [
      planMoveSlots(before, 3, ["a"], null), planMoveSlots(before, 4, ["missing"], null),
      planMoveSlots(before, 4, ["a", "a"], null), planMoveSlots(before, 4, ["a"], "a"),
      planMoveSlots(before, 4, ["a"], "missing"), planRemoveSlots(before, 4, []),
      planInsertSlots(before, 4, [slot("a")], null), planInsertSlots(before, 4, [occupied("c")], null),
      planInsertSlots(before, 4, [slot("c", { collectionId: "other" })], null),
    ]
    for (const failure of failures) assert.equal(failure.ok, false)
    assert.deepEqual(before, original)
    const noMove = success(planMoveSlots(before, 4, ["b"], null))
    assert.equal(noMove.snapshot.layoutRevision, 4)
    assert.equal(success(planClearSlots(before, 4, ["b"])).snapshot.slots[1].version, 0)
  })

  test("every bulk selection/anchor preserves identities, full payloads and relative order", () => {
    const before = snapshot([occupied("a"), slot("b"), occupied("c"), slot("d")])
    const original = structuredClone(before)
    for (let mask = 1; mask < 16; mask++) {
      const selected = before.slots.filter((_, index) => mask & (1 << index))
      const others = before.slots.filter(slot => !selected.includes(slot))
      for (const anchor of [...others.map(slot => slot.id), null]) {
        const plan = success(planMoveSlots(before, 4, selected.map(slot => slot.id).reverse(), anchor))
        assert.ok(normalizeBinderSnapshot(plan.snapshot))
        assert.equal(new Set(plan.snapshot.slots.map(slot => slot.id)).size, 4)
        for (const slot of plan.snapshot.slots) assert.deepEqual(slot, before.slots.find(old => old.id === slot.id))
        assert.deepEqual(plan.snapshot.slots.filter(slot => selected.some(s => s.id === slot.id)).map(slot => slot.id), selected.map(slot => slot.id))
        const end = plan.snapshot.slots.findIndex(slot => slot.id === selected.at(-1)!.id)
        assert.equal(plan.snapshot.slots[end + 1]?.id ?? null, anchor)
        assert.deepEqual(plan.unassignedInventoryItemIds, [])
      }
    }
    assert.deepEqual(before, original)
  })

  test("rejects revision overflow rather than generating unrepresentable revisions", () => {
    const before = { ...snapshot([slot("a")]), layoutRevision: Number.MAX_SAFE_INTEGER }
    assert.equal(planRemoveSlots(before, before.layoutRevision, ["a"]).ok, false)
    const full = snapshot([occupied("a")])
    full.slots[0].version = Number.MAX_SAFE_INTEGER
    assert.equal(planClearSlots(full, 4, ["a"]).ok, false)
  })
})

describe("occupied targets and completion", () => {
  test("fails closed without candidate evidence and permits only compatible occupied edits", () => {
    const a = occupied("a")
    assert.equal(canChangeSlotTarget(a, { kind: "pokemon", pokemonId: 25 }), false)
    assert.equal(canChangeSlotTarget(a, { kind: "card", cardId: "synthetic-alias" }, candidate), true)
    assert.equal(canChangeSlotTarget(a, { kind: "pokemon", pokemonId: 25 }, candidate), false)
    assert.equal(canChangeSlotTarget(a, null), true)
    assert.equal(canChangeSlotTarget(slot("empty"), { kind: "pokemon", pokemonId: 25 }), true)
    const before = snapshot([a])
    assert.equal(success(planChangeSlotTarget(before, 4, "a", a.target)).snapshot.slots[0].version, 0)
    assert.equal(planChangeSlotTarget(before, 4, "a", { kind: "pokemon", pokemonId: 25 }, candidate).ok, false)
    const plan = success(planChangeSlotTarget(before, 4, "a", { kind: "card", cardId: "synthetic-alias" }, candidate))
    assert.equal(plan.snapshot.slots[0].inventoryItemId, "item-a")
    assert.equal(plan.snapshot.slots[0].version, 1)
    assert.equal(plan.snapshot.layoutRevision, 4)
    assert.deepEqual(plan.unassignedInventoryItemIds, [])
  })

  test("counts only current targets fulfilled by assigned compatible inventory, never wants or provenance", () => {
    const before = snapshot([occupied("a"), slot("empty", { target: { kind: "pokemon", pokemonId: 25 }, status: "wishlisted", wantedCards: [{ card_id: "synthetic-pikachu", card_name: "Synthetic", added_at: "2026-01-01" }] }), occupied("free")])
    before.slots[2].target = null
    const resolve = (id: string) => id === "item-a" ? candidate : undefined
    assert.deepEqual(getBinderCompletion(before, resolve), { targetCount: 2, completedTargetCount: 1 })
    assert.deepEqual(getBinderCompletion(before, () => undefined), { targetCount: 2, completedTargetCount: 0 })
    const removed = success(planRemoveSlots(before, 4, ["empty"]))
    assert.deepEqual(getBinderCompletion(removed.snapshot, resolve), { targetCount: 1, completedTargetCount: 1 })
    assert.deepEqual(getBinderCompletion(snapshot([]), resolve), { targetCount: 0, completedTargetCount: 0 })
    assert.deepEqual(getBinderCompletion(snapshot([occupied("legacy")]), () => ({ kind: "pokemon", pokemonId: 143 })), { targetCount: 1, completedTargetCount: 1 })
  })
})
