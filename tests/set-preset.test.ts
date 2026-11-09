import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { generateSetChecklist, parseSetChecklist, isSetChecklistCustomised } from "@/lib/set-preset"
import { instantiatePreset } from "@/lib/domain/binder-presets"
import { getBinderCompletion, matchesSlotTarget } from "@/lib/domain/binder-slots"
import { parseBinderCreationDraft } from "@/lib/binder-creation-draft"
import type { TCGSetSlotCard } from "@/lib/tcg-set-slots"

// All cards, IDs, variants and counts in this file are synthetic catalog evidence.
const set = { id: "synthetic-set", name: "Synthetic set", officialCardCount: 3 }
const card = (number: string, overrides: Partial<TCGSetSlotCard> = {}): TCGSetSlotCard => ({
  id: `synthetic-${number}`, localId: number, name: "Synthetic repeated species", set,
  language: "en", languageConfirmed: true, inferredFinish: "secret_rare", ...overrides,
})
const generate = (cards: TCGSetSlotCard[], options = {}) => generateSetChecklist({ set, cards, language: "en", finishes: [], promos: [], excludedCardIds: [], capturedAt: "2026-11-09T12:00:00Z", ...options })

describe("copied set checklist", () => {
  test("natural numeric/alphanumeric order includes secrets, subsets, repeated species and every category", () => {
    const result = generate([card("TG10"), card("10", { name: "Synthetic Energy" }), card("2a"), card("TG2"), card("2"), card("104", { name: "Synthetic supporter / item" }), card("1")])
    assert.deepEqual(result.scope.cards.map(c => c.localId), ["1", "2", "2a", "10", "104", "TG2", "TG10"])
    assert.equal(result.manifest.entries.length, 7)
    assert.ok(result.scope.warnings.some(w => /coverage/i.test(w)))
  })
  test("empty and incomplete lists disclose coverage without placeholder targets", () => {
    assert.equal(generate([]).manifest.entries.length, 0)
    assert.equal(generate([card("1")]).manifest.entries.length, 1)
    assert.ok(generate([card("1")]).scope.warnings.some(w => /3/.test(w)))
  })
  test("canonical aliases collapse once, conflicting duplicate identities fail", () => {
    const original = card("1"), alias = card("1", { id: "synthetic-alias", canonicalId: original.id })
    assert.equal(generate([alias, original]).manifest.entries.length, 1)
    assert.throws(() => generate([original, card("2", { id: original.id })]), /conflict/i)
  })
  test("explicit verified finishes only, absent/false flags and unsupported languages unavailable", () => {
    const result = generate([card("1", { variants: { normal: true, reverse: true, holo: false } }), card("2"), card("3", { languageConfirmed: false })], { finishes: ["normal", "reverse_holo", "holo"] })
    assert.deepEqual(result.manifest.entries.map(e => e.target), [
      { kind: "card", cardId: "synthetic-1", language: "en", finish: "normal" },
      { kind: "card", cardId: "synthetic-1", language: "en", finish: "reverse_holo" },
    ])
    assert.ok(result.scope.warnings.some(w => /language/i.test(w)))
    assert.equal(generate([card("1", { language: "fr" })]).manifest.entries.length, 0)
    assert.equal(generate([card("1", { variants: { jumbo: true } })], { finishes: ["jumbo"] }).manifest.entries.length, 1)
    assert.throws(() => generate([card("1")], { finishes: ["secret_rare"] }), /finish/i)
    assert.throws(() => generate([card("1")], { finishes: ["constructor"] }), /finish/i)
  })
  test("optional explicitly selected promos and exclusions copy exact scope", () => {
    const promo = card("P1", { id: "synthetic-promo", set: { id: "synthetic-promos", name: "Synthetic promos" } })
    const result = generate([card("1"), card("2")], { promos: [promo], excludedCardIds: ["synthetic-1"] })
    assert.deepEqual(result.manifest.entries.map(e => e.target?.kind === "card" && e.target.cardId), ["synthetic-2", "synthetic-promo"])
    assert.deepEqual(result.scope.promoCardIds, ["synthetic-promo"])
    assert.deepEqual(result.scope.excludedCardIds, ["synthetic-1"])
    assert.throws(() => generate([card("1")], { excludedCardIds: ["unknown"] }), /exclusion/i)
  })
  test("snapshot and draft remain detached, immutable and parseable offline", () => {
    const cards = [card("1", { variants: { normal: true } })], result = generate(cards)
    cards[0].name = "changed later"
    assert.notEqual(result.scope.cards[0].name, cards[0].name)
    assert.ok(Object.isFrozen(result.scope.cards[0]))
    const reordered = JSON.parse(JSON.stringify(result))
    reordered.scope = Object.fromEntries(Object.entries(reordered.scope).reverse())
    assert.deepEqual(parseSetChecklist(reordered), result)
    const draft = parseBinderCreationDraft({ version: 1, operationId: "synthetic-op", ownerUserId: "synthetic-owner", name: "Synthetic", manifest: result.manifest, setChecklist: result })
    assert.deepEqual(parseSetChecklist(JSON.parse(JSON.stringify(draft.setChecklist))), result)
    assert.throws(() => parseBinderCreationDraft({ ...draft, manifest: { ...result.manifest, entries: [] } }), /scope/i)
  })
  test("normal cannot fulfil reverse, current targets change with extras and removal", () => {
    const result = generate([card("1", { variants: { reverse: true } })], { finishes: ["reverse_holo"] })
    const binder = instantiatePreset(JSON.parse(JSON.stringify(result.manifest)), { ownerUserId: "owner", collectionId: "collection" }, ["slot"])!
    const target = binder.slots[0].target
    assert.equal(matchesSlotTarget({ kind: "card", id: "synthetic-1", pokemonIds: [], language: "en", finish: "normal" }, target), false)
    binder.slots.push({ ...binder.slots[0], id: "extra", target: null, presetOrigin: null })
    assert.equal(getBinderCompletion(binder, () => undefined).targetCount, 1)
    assert.equal(isSetChecklistCustomised(result, binder), false)
    binder.slots.shift()
    assert.equal(getBinderCompletion(binder, () => undefined).targetCount, 0)
    assert.equal(isSetChecklistCustomised(result, binder), true)
  })
})
