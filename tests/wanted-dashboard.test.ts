import test from "node:test"
import assert from "node:assert/strict"
import {
  buildWantedDashboardSummary,
  filterWantedDashboardEntries,
  groupWantedByPokemon,
  matchesWantedSearch,
  sortWantedDashboardEntries,
  applyWantedFilters,
  countWantedFilters,
  countWantedPriceDrops,
  hasWantedPriceDrop,
  normalizeWantedFilters,
  normalizeWantedSort,
  toggleWantedFilter,
  EMPTY_WANTED_FILTERS,
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

function risingPrice(cardId: string, amount: number): CardPriceSnapshot {
  return {
    ...price(cardId, amount),
    updatedAt: "2026-10-20T00:00:00.000Z",
    trendPoints: [
      { label: "30d", source: "cardmarket", gbpAmount: amount / 1.5, originalAmount: 0, originalCurrency: "GBP" },
      { label: "7d", source: "cardmarket", gbpAmount: amount / 1.2, originalAmount: 0, originalCurrency: "GBP" },
      { label: "Trend", source: "cardmarket", gbpAmount: amount, originalAmount: 0, originalCurrency: "GBP" },
    ],
  }
}

function droppedPrice(cardId: string, amount: number): CardPriceSnapshot {
  return {
    ...price(cardId, amount),
    updatedAt: "2026-10-20T00:00:00.000Z",
    trendPoints: [
      { label: "30d", source: "cardmarket", gbpAmount: amount * 1.3, originalAmount: 0, originalCurrency: "GBP" },
      { label: "7d", source: "cardmarket", gbpAmount: amount * 1.25, originalAmount: 0, originalCurrency: "GBP" },
      { label: "Trend", source: "cardmarket", gbpAmount: amount, originalAmount: 0, originalCurrency: "GBP" },
    ],
  }
}

test("price drops are flagged, counted and filtered on the want list", () => {
  const now = Date.parse("2026-10-21T00:00:00.000Z")
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(1, "d1", { card_set: "Alpha" }),
      wantedEntry(2, "r1", { card_set: "Alpha" }),
      wantedEntry(3, "f1", { card_set: "Beta" }),
      wantedEntry(4, "u1", { card_set: "Beta" }),
    ],
    { "d1::en": droppedPrice("d1", 20), "r1::en": risingPrice("r1", 30), "f1::en": price("f1", 8), "u1::en": price("u1", null) },
  )
  assert.deepEqual(summary.cards.map((card) => hasWantedPriceDrop(card, now)), [true, false, false, false])
  assert.equal(countWantedPriceDrops(summary.cards, now), 1)
  const dropsOnly = { ...EMPTY_WANTED_FILTERS, dropsOnly: true }
  assert.deepEqual(applyWantedFilters(summary.cards, dropsOnly, now).map((card) => card.card.card_id), ["d1"])
  assert.equal(countWantedFilters(dropsOnly), 1)
  assert.deepEqual(applyWantedFilters(summary.cards, { ...dropsOnly, risingOnly: true }, now), [])
  assert.deepEqual(normalizeWantedFilters({ dropsOnly: true }), dropsOnly)
  assert.deepEqual(normalizeWantedFilters({ dropsOnly: "yes" }), EMPTY_WANTED_FILTERS)
  // Stale data never raises an alert.
  assert.equal(countWantedPriceDrops(summary.cards, Date.parse("2026-11-20T00:00:00.000Z")), 0)
})

test("sortWantedDashboardEntries orders sets by cost to complete, by name and by rising", () => {
  const now = Date.parse("2026-10-21T00:00:00.000Z")
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(1, "a1", { card_set: "Alpha", card_name: "Zubat" }),
      wantedEntry(2, "a2", { card_set: "Alpha", card_name: "Abra" }),
      wantedEntry(3, "b1", { card_set: "Beta", card_name: "Mew" }),
      wantedEntry(4, "c1", { card_set: "Cheap", card_name: "Pidgey" }),
      wantedEntry(5, "u1", { card_set: "Unknown", card_name: "Eevee" }),
    ],
    {
      "a1::en": price("a1", 6),
      "a2::en": price("a2", 4),
      "b1::en": risingPrice("b1", 30),
      "c1::en": risingPrice("c1", 2),
      "u1::en": price("u1", null),
    },
  )

  // Cheap (2) < Alpha (10) < Beta (30); a set with an unpriced card goes last.
  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "cheapest-set").map((card) => card.card.card_id), ["c1", "a2", "a1", "b1", "u1"])
  assert.deepEqual(sortWantedDashboardEntries(summary.cards, "name").map((card) => card.card.card_name), ["Abra", "Eevee", "Mew", "Pidgey", "Zubat"])
  const rising = sortWantedDashboardEntries(summary.cards, "rising", now).map((card) => card.card.card_id)
  assert.deepEqual(rising.slice(0, 2).sort(), ["b1", "c1"])
  assert.deepEqual(rising.slice(2), ["a1", "a2", "u1"])
})

test("wanted filters combine across groups, toggle, and survive bad stored data", () => {
  const now = Date.parse("2026-10-21T00:00:00.000Z")
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(1, "a1", { card_set: "Alpha", card_finish: "holo" }),
      wantedEntry(2, "a2", { card_set: "Alpha", card_language: "ja" }),
      wantedEntry(3, "b1", { card_set: "Beta" }),
    ],
    { "a1::en": risingPrice("a1", 30), "a2::ja": price("a2", 3), "b1::en": price("b1", 60) },
  )

  let filters = toggleWantedFilter(EMPTY_WANTED_FILTERS, "sets", "Alpha")
  assert.deepEqual(applyWantedFilters(summary.cards, filters, now).map((card) => card.card.card_id), ["a1", "a2"])
  filters = toggleWantedFilter(filters, "finishes", "holo")
  assert.deepEqual(applyWantedFilters(summary.cards, filters, now).map((card) => card.card.card_id), ["a1"])
  assert.equal(countWantedFilters(filters), 2)
  filters = toggleWantedFilter(filters, "sets", "Alpha")
  assert.deepEqual(filters.sets, [])
  assert.deepEqual(applyWantedFilters(summary.cards, { ...EMPTY_WANTED_FILTERS, risingOnly: true }, now).map((card) => card.card.card_id), ["a1"])
  assert.deepEqual(applyWantedFilters(summary.cards, { ...EMPTY_WANTED_FILTERS, bands: ["over-50"] }, now).map((card) => card.card.card_id), ["b1"])

  assert.deepEqual(normalizeWantedFilters({ bands: ["nope", "under-5"], sets: [1, "Alpha", "Alpha"], risingOnly: "yes" }), {
    ...EMPTY_WANTED_FILTERS,
    bands: ["under-5"],
    sets: ["Alpha"],
  })
  assert.deepEqual(normalizeWantedFilters(null), EMPTY_WANTED_FILTERS)
  assert.equal(normalizeWantedSort("rising"), "rising")
  assert.equal(normalizeWantedSort("bogus"), "highest")
})

test("Group by Pokémon puts the Pokémon with most wanted cards first, dearest card first within a group", () => {
  const summary = buildWantedDashboardSummary(
    [
      wantedEntry(4, "char-a"),
      wantedEntry(7, "squirt-a"),
      wantedEntry(7, "squirt-b"),
      wantedEntry(1, "bulba-a"),
      wantedEntry(7, "squirt-c"),
    ],
    {
      "char-a::en": price("char-a", 90),
      "squirt-a::en": price("squirt-a", 2),
      "squirt-b::en": price("squirt-b", 12),
      "bulba-a::en": price("bulba-a", 30),
    },
  )

  const groups = groupWantedByPokemon(summary.cards)
  assert.deepEqual(
    groups.map((group) => [group.pokemonId, group.cards.map((card) => card.card.card_id), group.topGbpAmount]),
    [
      [7, ["squirt-b", "squirt-a", "squirt-c"], 12],
      [4, ["char-a"], 90],
      [1, ["bulba-a"], 30],
    ],
  )
  assert.deepEqual(
    sortWantedDashboardEntries(summary.cards, "pokemon").map((card) => card.card.card_id),
    ["squirt-b", "squirt-a", "squirt-c", "char-a", "bulba-a"],
  )
  assert.equal(normalizeWantedSort("pokemon"), "pokemon")
})

test("Group by Pokémon keeps the same printing wanted in two binders as two rows", () => {
  const entry = wantedEntry(25, "pika")
  const summary = buildWantedDashboardSummary(
    [{ ...entry, binderId: "a", binderName: "A" }, { ...entry, binderId: "b", binderName: "B" }],
    { "pika::en": price("pika", 5) },
  )
  const [group] = groupWantedByPokemon(summary.cards)
  assert.deepEqual(group?.cards.map((card) => card.binderId), ["a", "b"])
})
