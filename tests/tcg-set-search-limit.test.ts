import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { SET_SEARCH_RESULT_LIMIT } from "../lib/tcg-set-slots"

// Production mirror set names (October 2026) that generic Sets view searches match.
const PROMO_SET_NAMES = [
  "MEP Black Star Promos", "SVP Black Star Promos", "SWSH Black Star Promos", "SM Black Star Promos",
  "XY Black Star Promos", "BW Black Star Promos", "HGSS Black Star Promos", "DP Black Star Promos",
  "Nintendo Black Star Promos", "Wizards Black Star Promos", "W Promotional", "Miscellaneous Promos",
]
const MCDONALDS_SET_NAMES = [
  "McDonald's Collection 2011", "McDonald's Collection 2012", "Collection McDonald's 2013",
  "McDonald's Collection 2014", "McDonald's Collection 2015", "McDonald's Collection 2016",
  "McDonald's Collection 2017", "McDonald's Collection 2018", "Collection McDonald's 2018",
  "McDonald's Collection 2019", "Collection McDonald's 2019", "McDonald's Collection 2021",
  "McDonald's Collection 2022", "McDonald's Collection 2023", "McDonald's Collection 2024",
]

function matching(names: string[], query: string) {
  return names.filter(name => name.toLowerCase().includes(query.toLowerCase()))
}

describe("SET_SEARCH_RESULT_LIMIT", () => {
  test("returns every Black Star Promos set for a 'promo' search", () => {
    const matches = matching(PROMO_SET_NAMES, "promo")
    assert.equal(matches.length, PROMO_SET_NAMES.length)
    assert.ok(SET_SEARCH_RESULT_LIMIT >= matches.length, `limit ${SET_SEARCH_RESULT_LIMIT} hides ${matches.length - SET_SEARCH_RESULT_LIMIT} promo sets`)
  })

  test("returns every McDonald's collection for a 'mcdonald' search, with headroom for new years", () => {
    const matches = matching(MCDONALDS_SET_NAMES, "mcdonald")
    assert.equal(matches.length, MCDONALDS_SET_NAMES.length)
    assert.ok(SET_SEARCH_RESULT_LIMIT >= matches.length + 5)
  })
})
