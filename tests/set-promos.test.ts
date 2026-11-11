import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { knownSetPromos } from "@/lib/set-promos"

describe("knownSetPromos", () => {
  test("lists a set's usual promos as zero-padded numbers in its era's promo set", () => {
    assert.deepEqual(knownSetPromos("sv08"), { setId: "svp", localIds: ["151", "152", "153", "154", "155", "156", "157", "158", "159"] })
    assert.deepEqual(knownSetPromos("me01")?.localIds.slice(0, 2), ["001", "002"])
    assert.deepEqual(knownSetPromos("sv06.5")?.localIds, ["129", "130", "131", "132", "149"])
  })
  test("knows nothing about sets without researched promos", () => {
    assert.equal(knownSetPromos("swsh1"), null)
    assert.equal(knownSetPromos("svp"), null)
  })
})
