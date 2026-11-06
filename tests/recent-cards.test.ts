import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { recentToSearchCard, addRecentCard, parseRecentCards, readRecentCards, toRecentCard, writeRecentCards, RECENT_CARDS_LIMIT, RECENT_CARDS_STORAGE_KEY, type RecentCard } from "../lib/recent-cards"
import type { SearchCardResult } from "../lib/pokemon-card-browse"

// Synthetic cards, not real catalogue data.
const searchCard: SearchCardResult = { id: "fixture-7", localId: "7", name: "Fixture", image: "https://assets.tcgdex.net/en/fixture/7/high.webp", language: "en", set: { id: "fixture", name: "Fixture Set", officialCardCount: 99 }, dexIds: [4] }
const recent = (id: string): RecentCard => ({ id, name: id, number: "#1", setName: "Fixture Set", dexId: 4, pokemonName: "charmander", viewedAt: "2026-01-01T00:00:00.000Z" })

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) }
}

describe("recently viewed cards", () => {
  test("captures what the strip needs from a search hit", () => {
    assert.deepEqual(toRecentCard(searchCard, { id: 4, name: "charmander" }, "2026-01-02T00:00:00.000Z"), {
      localId: "7", setId: "fixture", officialCardCount: 99, id: "fixture-7", name: "Fixture", number: "7/99", setName: "Fixture Set", image: searchCard.image, language: "en", dexId: 4, pokemonName: "charmander", viewedAt: "2026-01-02T00:00:00.000Z",
    })
  })

  test("newest first, re-viewing moves a card to the front, capped at the limit", () => {
    assert.deepEqual(addRecentCard([recent("a"), recent("b")], recent("b")).map((card) => card.id), ["b", "a"])
    const full = Array.from({ length: RECENT_CARDS_LIMIT }, (_, index) => recent(`card-${index}`))
    const next = addRecentCard(full, recent("new"))
    assert.equal(next.length, RECENT_CARDS_LIMIT)
    assert.equal(next[0].id, "new")
    assert.equal(next.at(-1)!.id, `card-${RECENT_CARDS_LIMIT - 2}`)
  })

  test("parsing drops malformed and duplicate entries and survives bad JSON", () => {
    const stored = JSON.stringify([recent("a"), { id: "bad" }, recent("a"), { ...recent("b"), dexId: 0 }, recent("c")])
    assert.deepEqual(parseRecentCards(stored).map((card) => card.id), ["a", "c"])
    assert.deepEqual(parseRecentCards("{not json"), [])
    assert.deepEqual(parseRecentCards(JSON.stringify({ id: "a" })), [])
    assert.deepEqual(parseRecentCards(null), [])
  })

  test("storage round trip, clearing removes the key, and storage errors are ignored", () => {
    const storage = memoryStorage()
    writeRecentCards(storage, [recent("a")])
    assert.deepEqual(readRecentCards(storage).map((card) => card.id), ["a"])
    writeRecentCards(storage, [])
    assert.equal(storage.data.has(RECENT_CARDS_STORAGE_KEY), false)
    const broken = { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("quota") }, removeItem: () => {} }
    assert.deepEqual(readRecentCards(broken), [])
    assert.doesNotThrow(() => writeRecentCards(broken, [recent("a")]))
    assert.deepEqual(readRecentCards(undefined), [])
  })
})

test("reopening keeps exact printing and finish metadata, with old history still readable", () => {
  const card = { ...searchCard, canonicalId: "fixture-7", aliasIds: ["old-fixture-7"], rarity: "Common", variants: { normal: true, reverse: true } }
  const saved = toRecentCard(card, { id: 4, name: "charmander" }, undefined, "reverse_holo")
  const [parsed] = parseRecentCards(JSON.stringify([saved]))
  assert.equal(parsed.finish, "reverse_holo")
  assert.deepEqual(recentToSearchCard(parsed), card)
  const legacy = recentToSearchCard({ ...recent("base1-7"), number: "7/102" })
  assert.equal(legacy.localId, "7")
  assert.equal(legacy.set.id, "base1")
  assert.equal(legacy.set.officialCardCount, 102)
  assert.equal(parseRecentCards(JSON.stringify([{ ...saved, finish: "invented", variants: { normal: "yes", reverse: true } }]))[0].finish, undefined)
  assert.deepEqual(parseRecentCards(JSON.stringify([{ ...saved, variants: { normal: "yes", reverse: true } }]))[0].variants, { reverse: true })
})
