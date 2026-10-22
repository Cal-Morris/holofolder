import test from "node:test"
import assert from "node:assert/strict"
import {
  buildWantedDashboardSummary,
  filterWantedDashboardEntries,
  matchesWantedSearch,
  sortWantedDashboardEntries,
  type WantedDashboardEntry,
} from "../lib/wanted-dashboard"
import type { CardPriceSnapshot } from "../hooks/use-card-prices"

function wantedEntry(
  pokemonId: number,
  cardId: string,
  overrides: Partial<WantedDashboardEntry["card"]> = {},
): WantedDashboardEntry {
  return {
    pokemonId,
    pokemonName: `Pokemon ${pokemonId}`,
    card: {
      card_id: cardId,
      card_name: `Card ${cardId}`,
      card_set: "Base",
      card_language: "en",
      card_finish: "normal",
      added_at: "2026-06-01T00:00:00.000Z",
      ...overrides,
    },
  }
}

function price(cardId: string, amount: number | null): CardPriceSnapshot {
  return {
    cardId,
    language: "en",
    gbpAmount: amount,
    marketGbpAmount: amount,
    goodGbpAmount: amount == null ? null : Math.max(0, amount - 1),
    lowGbpAmount: amount == null ? null : Math.max(0, amount - 2),
    highGbpAmount: amount == null ? null : amount + 3,
    confidence: "high",
    sourcePrices: [],
    trendPoints: [],
    buySignal: null,
    originalAmount: null,
    originalCurrency: null,
    source: "tcgplayer",
    variantLabel: null,
    updatedAt: null,
    fxDate: null,
    fetchedAt: 1,
  }
}

test("buildWantedDashboardSummary groups wanted cards into buying price bands", () => {
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(1, "cheap"),
      wantedEntry(2, "mid"),
      wantedEntry(3, "high"),
      wantedEntry(4, "unpriced"),
    ],
    {
      "cheap::en": price("cheap", 4),
      "mid::en": price("mid", 14),
      "high::en": price("high", 80),
    },
  )

  assert.equal(summary.totalCards, 4)
  assert.equal(summary.pricedCount, 3)
  assert.equal(summary.unpricedCount, 1)
  assert.equal(summary.marketTotalGbp, 98)
  assert.deepEqual(
    summary.priceBands.map((band) => [band.id, band.label, band.count, band.totalGbp]),
    [
      ["under-5", "Under £5", 1, 4],
      ["five-to-15", "£5-£15", 1, 14],
      ["fifteen-to-50", "£15-£50", 0, 0],
      ["over-50", "£50+", 1, 80],
      ["unpriced", "Unpriced", 1, 0],
    ],
  )
  assert.equal(summary.highestCards[0]?.card.card_id, "high")
})

test("buildWantedDashboardSummary shows set and language concentration", () => {
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(1, "one", { card_set: "Mega Evolution" }),
      wantedEntry(2, "two", { card_set: "Mega Evolution", card_language: "ja" }),
      wantedEntry(3, "three", { card_set: "Team Rocket", card_language: "ja" }),
    ],
    {
      "one::en": price("one", 5),
      "two::ja": price("two", 6),
      "three::ja": price("three", 7),
    },
  )

  assert.deepEqual(
    summary.setBreakdown.map((group) => [group.label, group.count, group.totalGbp]),
    [
      ["Mega Evolution", 2, 11],
      ["Team Rocket", 1, 7],
    ],
  )
  assert.deepEqual(
    summary.languageBreakdown.map((group) => [group.label, group.count]),
    [
      ["ja", 2],
      ["en", 1],
    ],
  )
})

test("sortWantedDashboardEntries supports buying-focused sort orders", () => {
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(25, "pikachu", { card_set: "Zeta", added_at: "2026-06-01T00:00:00.000Z" }),
      wantedEntry(1, "bulbasaur", { card_set: "Alpha", added_at: "2026-06-03T00:00:00.000Z" }),
      wantedEntry(4, "charmander", { card_set: "Alpha", added_at: "2026-06-02T00:00:00.000Z" }),
    ],
    {
      "pikachu::en": price("pikachu", 30),
      "bulbasaur::en": price("bulbasaur", 3),
    },
  )

  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "highest").map((card) => card.card.card_id), [
    "pikachu",
    "bulbasaur",
    "charmander",
  ])
  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "unpriced").map((card) => card.card.card_id), [
    "charmander",
    "pikachu",
    "bulbasaur",
  ])
  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "dex").map((card) => card.card.card_id), [
    "bulbasaur",
    "charmander",
    "pikachu",
  ])
  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "newest").map((card) => card.card.card_id), [
    "bulbasaur",
    "charmander",
    "pikachu",
  ])
})

test("matchesWantedSearch finds cards by name, Pokémon, set, number, rarity and illustrator", () => {
  const charmander = { ...wantedEntry(4, "sv03.5-168", { card_name: "Charmander", card_set: "151", local_id: "168", set_total: 165, rarity: "Illustration Rare", illustrator: "Kouki Saitō", card_finish: "holo" }), pokemonName: "charmander" }
  const squirtle = { ...wantedEntry(7, "sv03.5-007", { card_name: "Squirtle", card_set: "151", local_id: "007", set_total: 165 }), pokemonName: "squirtle" }
  const ex = { ...wantedEntry(6, "sv03.5-006", { card_name: "Charizard ex", card_set: "Obsidian Flames", local_id: "006" }), pokemonName: "charizard" }

  assert.equal(matchesWantedSearch(charmander, ""), true)
  assert.equal(matchesWantedSearch(charmander, "CHARM"), true)
  assert.equal(matchesWantedSearch(charmander, "kouki saito"), true, "accents are ignored")
  assert.equal(matchesWantedSearch(charmander, "illustration"), true)
  assert.equal(matchesWantedSearch(charmander, "151 168"), true)
  assert.equal(matchesWantedSearch(charmander, "168/165"), true)
  assert.equal(matchesWantedSearch(squirtle, "#7"), true)
  assert.equal(matchesWantedSearch(squirtle, "7"), true)
  assert.equal(matchesWantedSearch(squirtle, "007"), true)
  assert.equal(matchesWantedSearch(charmander, "7"), false, "numbers match a whole card number")
  assert.equal(matchesWantedSearch(ex, "obsidian char"), true)
  assert.equal(matchesWantedSearch(ex, "obsidian squirtle"), false, "every word must match")
  assert.deepEqual(filterWantedDashboardEntries([charmander, squirtle, ex], "char").map((card) => card.pokemonId), [4, 6])
})
