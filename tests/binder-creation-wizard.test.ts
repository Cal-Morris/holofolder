import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { creationSummary, FREE_PAGE_SIZES, pageSizeLabel, suggestedBinderName } from "@/lib/binder-creation-wizard"

describe("binder creation wizard", () => {
  test("offers only page sizes every plan may save", () => {
    // The saved-layout rule (scripts/057) lets any owner use these without Premium.
    const free = new Set(["1x1", "2x2", "3x3", "3x4", "4x3", "4x4"])
    for (const size of FREE_PAGE_SIZES) assert.ok(free.has(`${size.rows}x${size.cols}`), `${size.rows}x${size.cols}`)
    assert.equal(pageSizeLabel({ rows: 3, cols: 4 }), "12 pockets, 3 by 4")
  })

  test("suggests a name only where the preset has an obvious one", () => {
    assert.equal(suggestedBinderName("national"), "National Dex")
    assert.equal(suggestedBinderName("generation", { region: "Johto" }), "Johto")
    assert.equal(suggestedBinderName("set", { setName: "Synthetic Set" }), "Synthetic Set")
    assert.equal(suggestedBinderName("set"), "")
    assert.equal(suggestedBinderName("blank"), "")
    assert.equal(suggestedBinderName("species"), "")
  })

  test("summarises what the binder holds and how many pages it makes", () => {
    assert.equal(creationSummary("national", 1025, { rows: 4, cols: 4 }), "National Dex · 1,025 Pokémon · 65 pages of 16")
    assert.equal(creationSummary("generation", 151, { rows: 3, cols: 3 }, { region: "Kanto" }), "Kanto · 151 Pokémon · 17 pages of 9")
    assert.equal(creationSummary("printings", 1, { rows: 2, cols: 2 }), "1 card · 1 page of 4")
    assert.equal(creationSummary("blank", 0, { rows: 3, cols: 4 }), "Blank · 12 pockets a page")
    assert.equal(creationSummary("species", 3, null), "3 Pokémon · list")
  })
})
