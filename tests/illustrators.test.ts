import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  buildIllustratorDirectory,
  buildIllustratorEntries,
  cleanIllustratorName,
  countIllustratorEntries,
  editDistance,
  normalizeIllustratorText,
  scoreIllustratorMatch,
  searchIllustrators,
  type IllustratorCard,
} from "../lib/illustrators"
import { createMemoryStore } from "../lib/offline-store/kv"
import {
  loadIllustratorCards,
  loadIllustratorDirectory,
  MAX_STORED_ILLUSTRATORS,
  saveIllustratorCards,
  saveIllustratorDirectory,
} from "../lib/offline-store/records"
import { extractCardsFromCachedResponse } from "../lib/offline-card-index"

// Synthetic directory: real-looking illustrator names, made-up counts.
const DIRECTORY = buildIllustratorDirectory([
  { name: "Mitsuhiro Arita", count: 600 },
  { name: "Ken Sugimori", count: 500 },
  { name: "5ban Graphics", count: 900 },
  { name: "Kagemaru Himeno", count: 300 },
  { name: "Kouki Saitō", count: 120 },
  { name: "Atsuko Nishida", count: 200 },
  { name: "Arita Mitsuo", count: 2 },
])

describe("illustrator search", () => {
  test("normalizes accents, case and punctuation", () => {
    assert.equal(normalizeIllustratorText("  Kouki Saitō "), "kouki saito")
    assert.equal(normalizeIllustratorText("Ryota-Murayama"), "ryota murayama")
    assert.equal(cleanIllustratorName("  Ken   Sugimori "), "Ken Sugimori")
    assert.equal(cleanIllustratorName(42), "")
  })

  test("edit distance counts swaps as one edit and stops early", () => {
    assert.equal(editDistance("arita", "artia"), 1)
    assert.equal(editDistance("sugimori", "sugimroi"), 1)
    assert.equal(editDistance("abc", "xyz", 1), 2)
  })

  test("exact, prefix and surname matches", () => {
    assert.equal(searchIllustrators(DIRECTORY, "Mitsuhiro Arita")[0].name, "Mitsuhiro Arita")
    assert.equal(searchIllustrators(DIRECTORY, "mitsu")[0].name, "Mitsuhiro Arita")
    assert.deepEqual(searchIllustrators(DIRECTORY, "arita").map((entry) => entry.name), ["Arita Mitsuo", "Mitsuhiro Arita"])
    assert.equal(searchIllustrators(DIRECTORY, "sugimori")[0].name, "Ken Sugimori")
  })

  test("word order, missing spaces, accents and typos", () => {
    assert.equal(searchIllustrators(DIRECTORY, "arita mitsuhiro")[0].name, "Mitsuhiro Arita")
    assert.equal(searchIllustrators(DIRECTORY, "5ban")[0].name, "5ban Graphics")
    assert.equal(searchIllustrators(DIRECTORY, "saito")[0].name, "Kouki Saitō")
    assert.equal(searchIllustrators(DIRECTORY, "mitsuhro arita")[0].name, "Mitsuhiro Arita")
    assert.equal(searchIllustrators(DIRECTORY, "himeno kagemaru")[0].name, "Kagemaru Himeno")
    assert.equal(searchIllustrators(DIRECTORY, "nishdia")[0].name, "Atsuko Nishida")
  })

  test("no match, too short, and limits", () => {
    assert.deepEqual(searchIllustrators(DIRECTORY, "pikachu"), [])
    assert.deepEqual(searchIllustrators(DIRECTORY, "a"), [])
    assert.equal(scoreIllustratorMatch("Ken Sugimori", "zzz"), 0)
    assert.equal(searchIllustrators(DIRECTORY, "i", 2).length, 0)
    assert.ok(searchIllustrators(DIRECTORY, "ar", 1).length <= 1)
  })

  test("directory merges duplicate names and ignores blanks", () => {
    const directory = buildIllustratorDirectory([{ name: "Ken Sugimori", count: 2 }, { name: " Ken Sugimori ", count: 3 }, { name: "" }, { name: null }, { name: "Solo" }])
    assert.deepEqual(directory, [{ name: "Ken Sugimori", cardCount: 5 }, { name: "Solo", cardCount: 1 }])
  })
})

// Synthetic cards by one illustrator across three sets (ids follow TCGdex formats).
function card(id: string, name: string, setId: string, setName: string, releaseDate: string | undefined, extra: Partial<IllustratorCard> = {}): IllustratorCard {
  return { id, localId: id.split("-").pop()!, name, set: { id: setId, name: setName, officialCardCount: 100, releaseDate }, dexIds: [1], ...extra }
}
const CARDS = [
  card("base1-44", "Bulbasaur", "base1", "Base Set", "1999-01-09"),
  card("30th-c-001", "Charizard", "30th-c", "30th Classic Collection", "2026-09-16", { dexIds: [6], set: { id: "30th-c", name: "30th Classic Collection", officialCardCount: 0, releaseDate: "2026-09-16" } }),
  card("sv03.5-166", "Bulbasaur", "sv03.5", "151", "2023-09-22", { rarity: "Illustration Rare" }),
  card("sv03.5-196", "Professor's Research", "sv03.5", "151", "2023-09-22", { dexIds: [] }),
  card("promo-1", "Ancient Mew", "promo", "Movie Promos", undefined, { dexIds: [151], aliasIds: ["promo-1-alias"] }),
]

describe("illustrator view entries", () => {
  const collection = [
    { card_id: "base1-44", status: "collected", wanted_cards: [{ card_id: "sv03.5-166" }] },
    { card_id: "promo-1-alias", status: "finalized", wanted_cards: [] },
    { card_id: "30th-c-001", status: "wishlisted", wanted_cards: [] },
  ]

  test("marks owned and wanted across the whole collection, including catalog aliases", () => {
    const entries = buildIllustratorEntries(CARDS, collection)
    const byId = Object.fromEntries(entries.map((entry) => [entry.card.id, entry]))
    assert.equal(byId["base1-44"].owned, true)
    assert.equal(byId["sv03.5-166"].wanted, true)
    assert.equal(byId["sv03.5-166"].owned, false)
    assert.equal(byId["promo-1"].owned, true)
    assert.equal(byId["30th-c-001"].wanted, true)
    assert.equal(byId["30th-c-001"].owned, false)
    assert.equal(byId["30th-c-001"].numberLabel, "#001")
    assert.deepEqual(countIllustratorEntries(entries), { all: 5, owned: 2, wanted: 2, missing: 3 })
  })

  test("sorts newest, oldest, by set and by name", () => {
    const ids = (sort: "newest" | "oldest" | "set" | "name") => buildIllustratorEntries(CARDS, [], { sort }).map((entry) => entry.card.id)
    assert.deepEqual(ids("newest"), ["30th-c-001", "sv03.5-166", "sv03.5-196", "base1-44", "promo-1"])
    assert.deepEqual(ids("oldest"), ["base1-44", "sv03.5-166", "sv03.5-196", "30th-c-001", "promo-1"])
    assert.deepEqual(ids("set"), ["sv03.5-166", "sv03.5-196", "30th-c-001", "base1-44", "promo-1"])
    assert.deepEqual(ids("name"), ["promo-1", "sv03.5-166", "base1-44", "30th-c-001", "sv03.5-196"])
  })

  test("filters by state and by text", () => {
    const ids = (options: Parameters<typeof buildIllustratorEntries>[2]) => buildIllustratorEntries(CARDS, collection, options).map((entry) => entry.card.id).sort()
    assert.deepEqual(ids({ filter: "owned" }), ["base1-44", "promo-1"])
    assert.deepEqual(ids({ filter: "wanted" }), ["30th-c-001", "sv03.5-166"])
    assert.deepEqual(ids({ filter: "missing" }), ["30th-c-001", "sv03.5-166", "sv03.5-196"])
    assert.deepEqual(ids({ text: "151" }), ["sv03.5-166", "sv03.5-196"])
    assert.deepEqual(ids({ text: "classic" }), ["30th-c-001"])
    assert.deepEqual(ids({ text: "illustration", filter: "wanted" }), ["sv03.5-166"])
  })
})

describe("illustrator offline storage", () => {
  test("directory and card lists round-trip; junk is ignored", async () => {
    const store = createMemoryStore()
    assert.equal(await loadIllustratorDirectory(store), null)
    await saveIllustratorDirectory(store, DIRECTORY)
    assert.deepEqual(await loadIllustratorDirectory(store), DIRECTORY)

    await saveIllustratorCards(store, "en", { illustrator: "Mitsuhiro Arita", cards: CARDS })
    assert.deepEqual((await loadIllustratorCards(store, "mitsuhiro arita", "en"))?.cards.length, CARDS.length)
    assert.equal(await loadIllustratorCards(store, "Mitsuhiro Arita", "ja"), null)
    await saveIllustratorCards(store, "en", { nope: true } as never)
    assert.equal((await store.keys("illustrators:cards:")).length, 1)
  })

  test("keeps only the most recently opened illustrators", async () => {
    const store = createMemoryStore()
    for (let index = 0; index < MAX_STORED_ILLUSTRATORS + 3; index += 1) {
      await saveIllustratorCards(store, "en", { illustrator: `Artist ${index}`, cards: [] }, new Date(Date.UTC(2026, 0, 1, 0, index)))
    }
    assert.equal((await store.keys("illustrators:cards:")).length, MAX_STORED_ILLUSTRATORS)
    assert.equal(await loadIllustratorCards(store, "Artist 0", "en"), null)
    assert.ok(await loadIllustratorCards(store, `Artist ${MAX_STORED_ILLUSTRATORS + 2}`, "en"))
  })

  test("cached illustrator responses feed offline card search (Pokémon cards only)", () => {
    const cards = extractCardsFromCachedResponse("/api/tcg-illustrators?name=Mitsuhiro%20Arita&language=en", { illustrator: "Mitsuhiro Arita", cards: CARDS })
    assert.deepEqual(cards.map((entry) => entry.id).sort(), ["30th-c-001", "base1-44", "promo-1", "sv03.5-166"])
    assert.deepEqual(extractCardsFromCachedResponse("/api/tcg-illustrators", { illustrators: DIRECTORY }), [])
  })
})
