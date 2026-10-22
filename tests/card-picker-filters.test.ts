import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getActiveFilterChips, getRecordedFinish, getVariantFilter } from "../lib/card-picker-filters"

describe("card picker filters", () => {
  test("variant choices narrow printings and/or set the recorded finish", () => {
    assert.equal(getVariantFilter("reverse_holo"), "reverse")
    assert.equal(getRecordedFinish("reverse_holo"), "reverse_holo")
    assert.equal(getVariantFilter("first_edition"), "firstEdition")
    assert.equal(getRecordedFinish("first_edition"), null)
    assert.equal(getVariantFilter("illustration_rare"), undefined)
    assert.equal(getRecordedFinish("illustration_rare"), "illustration_rare")
    assert.equal(getVariantFilter("any"), undefined)
    assert.equal(getRecordedFinish("any"), null)
  })

  test("only non-default filters become chips", () => {
    const base = { filters: {}, language: "en" as const, defaultLanguage: "en" as const, variant: "any" as const, sort: "default" as const }
    assert.deepEqual(getActiveFilterChips(base, () => undefined), [])
    assert.deepEqual(getActiveFilterChips({ ...base, filters: { searchQuery: "pika" } }, () => undefined), [])
    const chips = getActiveFilterChips(
      { ...base, filters: { set: "sv03.5", rarity: "Common" }, language: "ja", variant: "holo", sort: "price-desc" },
      (id) => (id === "sv03.5" ? "151" : undefined),
    )
    assert.deepEqual(chips.map((chip) => chip.label), ["Price: high to low", "Japanese", "Holo", "151", "Common"])
  })
})
