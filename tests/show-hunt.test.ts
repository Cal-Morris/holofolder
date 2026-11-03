import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildGoodPickups,
  buildHuntGroups,
  getCardStanding,
  collectHuntCards,
  getHuntFilterOptions,
  getSetEra,
  getSetIdFromCardId,
  orderPokemonCards,
  wantedToSearchCard,
  type HuntSourceItem,
} from "../lib/show-hunt"
import type { MomentumPriceInput } from "../lib/price-momentum"

const wanted = (card_id: string, card_name: string, card_set: string, extra: Record<string, unknown> = {}) => ({ card_id, card_name, card_set, added_at: "2026-01-01T00:00:00Z", ...extra })

const items: HuntSourceItem[] = [
  { pokemon_id: 1, pokemon_name: "bulbasaur", status: "collected", card_id: "base1-44", wanted_cards: [wanted("sv03.5-166", "Bulbasaur", "151"), wanted("me02-001", "Bulbasaur", "Phantasmal Flames")] },
  { pokemon_id: 6, pokemon_name: "charizard", status: "wishlisted", wanted_cards: [wanted("sv03.5-006", "Charizard ex", "151")] },
  { pokemon_id: 25, pokemon_name: "pikachu", status: "wishlisted", wanted_cards: [] },
]
const prices: Record<string, number> = { "sv03.5-166": 40, "me02-001": 1, "sv03.5-006": 60 }
const cards = collectHuntCards(items, (card) => prices[card.card_id] ?? null)

describe("show hunt", () => {
  it("reads set and era from a card id", () => {
    assert.equal(getSetIdFromCardId("sv03.5-006"), "sv03.5")
    assert.equal(getSetIdFromCardId("swsh12pt5-001", "001"), "swsh12pt5")
    assert.equal(getSetEra("sv03.5").label, "Scarlet & Violet")
    assert.equal(getSetEra("swsh12pt5").label, "Sword & Shield")
    assert.equal(getSetEra("sm115").label, "Sun & Moon")
    assert.equal(getSetEra("me02").label, "Mega Evolution")
    assert.equal(getSetEra("base1").label, "WotC")
    assert.equal(getSetEra("30th").id, "other")
  })

  it("groups the want list by Pokémon: most wanted, or highest value, first", () => {
    const byWanted = buildHuntGroups(items, cards, "wanted")
    assert.deepEqual(byWanted.map((group) => group.pokemonName), ["bulbasaur", "charizard", "pikachu"])
    assert.deepEqual(byWanted[0].cards.map((card) => card.wanted.card_id), ["sv03.5-166", "me02-001"])
    assert.equal(byWanted[2].anyCard, true)
    const byValue = buildHuntGroups(items, cards, "value")
    assert.deepEqual(byValue.map((group) => group.pokemonName), ["charizard", "bulbasaur", "pikachu"])
  })

  it("filters by era, set and a card list (an illustrator's), dropping any-card wishes", () => {
    assert.deepEqual(buildHuntGroups(items, cards, "wanted", { era: "me" }).map((group) => group.cards.length), [1])
    assert.deepEqual(buildHuntGroups(items, cards, "wanted", { setId: "sv03.5" }).map((group) => group.pokemonName), ["charizard", "bulbasaur"])
    assert.deepEqual(buildHuntGroups(items, cards, "wanted", { cardIds: new Set(["sv03.5-006"]) }).map((group) => group.pokemonName), ["charizard"])
    const options = getHuntFilterOptions(cards)
    assert.deepEqual(options.eras.map((entry) => [entry.era.id, entry.count]), [["me", 1], ["sv", 2]])
    assert.deepEqual(options.sets.map((entry) => entry.id), ["me02", "sv03.5"])
  })

  it("rebuilds a checkable card from a wanted entry", () => {
    const card = wantedToSearchCard(wanted("sv03.5-007", "Squirtle", "151", { card_finish: "reverse_holo", local_id: "007", set_total: 165 }), 7)
    assert.equal(card.set.id, "sv03.5")
    assert.equal(card.localId, "007")
    assert.deepEqual(card.dexIds, [7])
    assert.deepEqual(card.variants, { normal: true, reverse: true })
  })

  it("orders a Pokémon's cards wanted, missing, then owned", () => {
    const ordered = orderPokemonCards([
      { id: "a", standing: "owned" as const, price: 99 },
      { id: "b", standing: "missing" as const, price: 1 },
      { id: "c", standing: "wanted" as const, price: 2 },
      { id: "d", standing: "missing" as const, price: 5 },
    ])
    assert.deepEqual(ordered.map((card) => card.id), ["c", "d", "b", "a"])
  })
})

describe("getCardStanding", () => {
  it("owned beats wanted, and neither is missing", () => {
    assert.equal(getCardStanding({ owned: true, wanted: true }), "owned")
    assert.equal(getCardStanding({ owned: false, wanted: true }), "wanted")
    assert.equal(getCardStanding({ owned: false, wanted: false }), "missing")
  })
})

describe("buildGoodPickups", () => {
  const now = Date.parse("2026-11-03T12:00:00Z")
  const snapshot = (trend: Record<string, number>): MomentumPriceInput => ({
    confidence: "high",
    updatedAt: "2026-11-03T11:00:00Z",
    trendPoints: Object.entries(trend).map(([label, gbpAmount]) => ({ label, source: "cardmarket", gbpAmount })),
  })
  const snapshots: Record<string, MomentumPriceInput> = {
    "sv03.5-166": snapshot({ Trend: 40, "7d": 50 }), // -20% 7d
    "sv03.5-006": snapshot({ Trend: 60, "30d": 100 }), // -40% 30d
    "me02-001": snapshot({ Trend: 1, "7d": 1.05 }), // -5%: under the drop rule
  }
  const priceOf = (card: (typeof cards)[number]) => snapshots[card.wanted.card_id]

  it("lists wanted cards whose price dropped, biggest fall first", () => {
    const pickups = buildGoodPickups(cards, priceOf, {}, { now })
    assert.deepEqual(pickups.map((pickup) => pickup.card.wanted.card_id), ["sv03.5-006", "sv03.5-166"])
    assert.deepEqual(pickups.map((pickup) => [pickup.momentum.change, pickup.momentum.timeframe]), [[-0.4, "30d"], [-0.2, "7d"]])
  })

  it("skips unpriced cards and honours the Hunting filters", () => {
    const unpriced = collectHuntCards(items, (card) => (card.card_id === "sv03.5-006" ? null : prices[card.card_id] ?? null))
    assert.deepEqual(buildGoodPickups(unpriced, priceOf, {}, { now }).map((pickup) => pickup.card.wanted.card_id), ["sv03.5-166"])
    assert.deepEqual(buildGoodPickups(cards, priceOf, { cardIds: new Set(["sv03.5-166"]) }, { now }).map((pickup) => pickup.card.wanted.card_id), ["sv03.5-166"])
    assert.deepEqual(buildGoodPickups(cards, priceOf, { era: "me" }, { now }), [])
    assert.equal(buildGoodPickups(cards, priceOf, {}, { now, limit: 1 }).length, 1)
  })
})
