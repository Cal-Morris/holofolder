import { test } from "node:test"
import assert from "node:assert/strict"
import { planDeltaReignSupplement, type SupplementGroup } from "../lib/card-set-supplement"
import type { GapProduct } from "../lib/card-gap-fill"

const group: SupplementGroup = { groupId: 24831, name: "ME06: Delta Reign", abbreviation: "DLR", publishedOn: "2026-11-06T00:00:00" }
// Synthetic products, not source records or prices.
const product = (id: number, name: string, number: string, type: string, hp?: string): GapProduct => ({ productId: id, groupId: group.groupId, name,
  extendedData: [{ name: "Number", value: number }, { name: "Card Type", value: type }, ...(hp ? [{ name: "HP", value: hp }] : [])] })
const pokemon = product(1, "Pikachu - 001/103", "001/103", "Lightning", "60")

test("imports numbered cards with stable collector identities, including both Stadium halves and Energy", () => {
  const plan = planDeltaReignSupplement(group, [pokemon, product(2, "Fixture Stadium - 094/103 (Left)", "094/103", "Trainer - Stadium"),
    product(3, "Fixture Stadium - 095/103 (Right)", "095/103", "Trainer - Stadium"), product(4, "Fixture Energy", "103/103", "Special Water Energy"),
    { productId: 5, groupId: group.groupId, name: "Sealed box" }], new Set(["1"]))
  assert.equal(plan.cards.length, 4)
  assert.equal(plan.sets[0].official_card_count, 103)
  assert.deepEqual(plan.cards.map(card => card.id), ["me06-001", "me06-094", "me06-095", "me06-103"])
  assert.deepEqual(plan.cards.map(card => card.category), ["Pokemon", "Trainer", "Trainer", "Energy"])
  assert.equal(plan.cards[0].name_en, "Pikachu")
  assert.equal(plan.cards[1].name_en, "Fixture Stadium (Left)")
  assert.deepEqual(plan.dexLinks, [{ card_id: "me06-001", dex_id: 25 }])
  assert.deepEqual(plan.cards[0].external_ids_json, { catalog: { productId: "1", image: "https://product-images.tcgplayer.com/1.jpg" } })
  assert.deepEqual(plan.cards[1].external_ids_json, { catalog: { productId: "2" } })
  assert.deepEqual(plan.cards[0].image_languages_json, [])
  assert.deepEqual(plan.cards[0].variants_json, {})
})

test("refuses mismatched identities, duplicate printings and inconsistent denominators", () => {
  assert.throws(() => planDeltaReignSupplement({ ...group, abbreviation: "BAD" }, [pokemon], new Set()))
  assert.throws(() => planDeltaReignSupplement(group, [{ ...pokemon, groupId: 1 }], new Set()))
  assert.throws(() => planDeltaReignSupplement(group, [pokemon, pokemon], new Set()))
  assert.throws(() => planDeltaReignSupplement(group, [pokemon, product(2, "Pikachu", "002/104", "Lightning", "60")], new Set()))
  assert.throws(() => planDeltaReignSupplement(group, [], new Set()))
})
