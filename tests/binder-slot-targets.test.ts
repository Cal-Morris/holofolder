import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { matchesSlotTarget, normalizeSlotTarget, type SlotTargetCandidate } from "@/lib/domain/binder-slots"
import { CARD_FINISHES, CARD_LANGUAGES } from "@/lib/domain/cards"

// Synthetic catalog identities, not real card records.
const snorlax: SlotTargetCandidate = {
  kind: "card", id: "synthetic-snorlax", canonicalId: "synthetic-canonical",
  aliasIds: ["synthetic-alias"], pokemonIds: [143], language: "en", finish: "holo",
}

describe("slot target normalization", () => {
  test("distinguishes an intentional free slot from invalid or absent constraints", () => {
    assert.equal(normalizeSlotTarget(null), null)
    for (const value of [undefined, false, 143, [], {}, { kind: "other" }]) {
      assert.equal(normalizeSlotTarget(value), undefined)
    }
  })

  test("validates Pokémon IDs without imposing today's National Dex size", () => {
    assert.deepEqual(normalizeSlotTarget({ kind: "pokemon", pokemonId: 143 }), { kind: "pokemon", pokemonId: 143 })
    assert.deepEqual(normalizeSlotTarget({ kind: "pokemon", pokemonId: 1026 }), { kind: "pokemon", pokemonId: 1026 })
    for (const pokemonId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "143"]) {
      assert.equal(normalizeSlotTarget({ kind: "pokemon", pokemonId }), undefined)
    }
  })

  test("copies a valid target without defaulting unspecified language or finish", () => {
    const input = { kind: "card", cardId: "synthetic-card" }
    const target = normalizeSlotTarget(input)
    assert.deepEqual(target, input)
    assert.notEqual(target, input)
    input.cardId = "changed"
    assert.deepEqual(target, { kind: "card", cardId: "synthetic-card" })
  })

  test("accepts all supported explicit languages and finishes", () => {
    for (const language of CARD_LANGUAGES) for (const finish of CARD_FINISHES) {
      const value = { kind: "card", cardId: "synthetic-card", language, finish }
      assert.deepEqual(normalizeSlotTarget(value), value)
    }
  })

  test("rejects malformed and unknown constraints rather than broadening a target", () => {
    for (const value of [
      { kind: "card", cardId: "" }, { kind: "card", cardId: "   " },
      { kind: "card", cardId: " synthetic-card " }, { kind: "card", cardId: "x".repeat(201) },
      { kind: "card", cardId: "synthetic-card", language: "unknown" },
      { kind: "card", cardId: "synthetic-card", finish: null },
      { kind: "card", cardId: "synthetic-card", provider: "unknown-constraint" },
      { kind: "pokemon", pokemonId: 143, language: "en" },
    ]) assert.equal(normalizeSlotTarget(value), undefined)
  })
})

describe("slot target matching", () => {
  test("free slots accept Pokémon, non-Pokémon cards and legacy unknown printings", () => {
    assert.equal(matchesSlotTarget(snorlax, null), true)
    assert.equal(matchesSlotTarget({ kind: "card", id: "synthetic-supporter", pokemonIds: [] }, null), true)
    assert.equal(matchesSlotTarget({ kind: "pokemon", pokemonId: 143 }, null), true)
  })

  test("uses known Pokémon links, including multi-Pokémon cards", () => {
    assert.equal(matchesSlotTarget(snorlax, { kind: "pokemon", pokemonId: 143 }), true)
    assert.equal(matchesSlotTarget(snorlax, { kind: "pokemon", pokemonId: 25 }), false)
    assert.equal(matchesSlotTarget({ ...snorlax, pokemonIds: [25, 143] }, { kind: "pokemon", pokemonId: 25 }), true)
    assert.equal(matchesSlotTarget({ ...snorlax, pokemonIds: [] }, { kind: "pokemon", pokemonId: 143 }), false)
  })

  test("recognizes catalog ID, canonical ID and reviewed aliases, without fuzzy matching", () => {
    for (const cardId of [snorlax.id, snorlax.canonicalId!, snorlax.aliasIds![0]]) {
      assert.equal(matchesSlotTarget(snorlax, { kind: "card", cardId }), true)
    }
    assert.equal(matchesSlotTarget(snorlax, { kind: "card", cardId: "SYNTHETIC-SNORLAX" }), false)
    assert.equal(matchesSlotTarget(snorlax, { kind: "card", cardId: "synthetic-other-printing" }), false)
  })

  test("does not guess a legacy species-only item's printing, language or finish", () => {
    const legacy: SlotTargetCandidate = { kind: "pokemon", pokemonId: 143 }
    assert.equal(matchesSlotTarget(legacy, { kind: "pokemon", pokemonId: 143 }), true)
    assert.equal(matchesSlotTarget(legacy, { kind: "pokemon", pokemonId: 25 }), false)
    assert.equal(matchesSlotTarget(legacy, { kind: "card", cardId: snorlax.id }), false)
  })

  test("explicit language/finish require known equal values; omission imposes no constraint", () => {
    const target = { kind: "card", cardId: snorlax.id } as const
    assert.equal(matchesSlotTarget(snorlax, { ...target, language: "en", finish: "holo" }), true)
    assert.equal(matchesSlotTarget(snorlax, { ...target, language: "ja" }), false)
    assert.equal(matchesSlotTarget(snorlax, { ...target, finish: "normal" }), false)
    const unknown: SlotTargetCandidate = { kind: "card", id: snorlax.id, pokemonIds: [] }
    assert.equal(matchesSlotTarget(unknown, target), true)
    assert.equal(matchesSlotTarget(unknown, { ...target, language: "en" }), false)
    assert.equal(matchesSlotTarget(unknown, { ...target, finish: "normal" }), false)
  })
})
