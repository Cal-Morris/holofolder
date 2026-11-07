import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { buildNamedBinderSharePath, normalizeUsername, normalizeBinderSlug, suggestBinderSlug } from "../lib/public-binder-identity"

describe("public binder identities", () => {
  test("normalizes account usernames and validates their boundaries", () => {
    assert.equal(normalizeUsername(" Cal "), "cal")
    assert.equal(normalizeUsername("a".repeat(30)), "a".repeat(30))
    for (const value of [null, 1, "", "ab", "a".repeat(31), "@cal", "cal/name", "cal_name", "-cal", "cal-", "cál", "cal.name", "cal name"]) assert.equal(normalizeUsername(value), null, String(value))
  })
  test("binder slugs allow short names, with no path or URL syntax", () => {
    assert.equal(normalizeBinderSlug(" NATIONAL "), "national")
    assert.equal(normalizeBinderSlug("1"), "1")
    assert.equal(normalizeBinderSlug("a".repeat(60)), "a".repeat(60))
    for (const value of [undefined, {}, "", "a".repeat(61), "..", "a/b", "a?b", "a#b", "a%2fb", "-a", "a-"]) assert.equal(normalizeBinderSlug(value), null, String(value))
  })
  test("suggests editable slugs without inventing names for empty input", () => {
    assert.equal(suggestBinderSlug(" National Dex "), "national-dex")
    assert.equal(suggestBinderSlug("Cal’s Pokémon"), "cals-pokemon")
    assert.equal(suggestBinderSlug("***"), "")
    assert.equal(suggestBinderSlug("a".repeat(59) + " long name").length, 59)
  })
  test("builds clean public URLs and rejects invalid path segments", () => {
    assert.equal(buildNamedBinderSharePath("cal", "national"), "/@cal/national")
    assert.throws(() => buildNamedBinderSharePath("cal/other", "national"))
    assert.throws(() => buildNamedBinderSharePath("cal", "../private"))
  })
})
