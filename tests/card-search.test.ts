import test from "node:test"
import assert from "node:assert/strict"
import { filterAndRankCards } from "../lib/card-search"

const cards = [
  {
    id: "steam-10",
    name: "Pikachu",
    localId: "10",
    set: { id: "xy11", name: "Steam Siege", officialCardCount: 114 },
    rarity: "Common",
    types: ["Lightning"],
    illustrator: "Mitsuhiro Arita",
  },
  {
    id: "base-010",
    name: "Pikachu",
    localId: "010",
    set: { id: "base1", name: "Base Set", officialCardCount: 102 },
    rarity: "Rare Holo",
    types: ["Lightning"],
    illustrator: "Ken Sugimori",
  },
  {
    id: "steam-104",
    name: "Raichu",
    localId: "104",
    set: { id: "xy11", name: "Steam Siege", officialCardCount: 114 },
    rarity: "Ultra Rare",
    types: ["Lightning"],
    illustrator: "5ban Graphics",
  },
  {
    id: "jungle-10",
    name: "Pidgeotto",
    localId: "10/64",
    set: { id: "jungle", name: "Jungle", officialCardCount: 64 },
    rarity: "Rare",
    types: ["Colorless"],
    illustrator: "Kagemaru Himeno",
  },
  {
    id: "swshp-SWSH039",
    name: "Pikachu",
    localId: "SWSH039",
    set: { id: "swshp", name: "SWSH Black Star Promos", officialCardCount: 307 },
    rarity: "Promo",
    types: ["Lightning"],
    illustrator: "Hitoshi Ariga",
    variants: { holo: true, jumbo: true },
  },
]

test("filterAndRankCards searches card metadata beyond name and set", () => {
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "lightning" }).map((card) => card.id), [
    "steam-10",
    "base-010",
    "steam-104",
    "swshp-SWSH039",
  ])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "sugimori" }).map((card) => card.id), ["base-010"])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "ultra rare" }).map((card) => card.id), ["steam-104"])
})

test("filterAndRankCards matches fuzzy set words and ranks exact number matches first", () => {
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "steam 10" }).map((card) => card.id), [
    "steam-10",
    "steam-104",
  ])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "stem" }).map((card) => card.id), [
    "steam-10",
    "steam-104",
  ])
})

test("filterAndRankCards treats full collector numbers as card number plus set total", () => {
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "10/114" }).map((card) => card.id), ["steam-10"])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "10/64" }).map((card) => card.id), ["jungle-10"])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "10" }).map((card) => card.id), [
    "steam-10",
    "base-010",
    "jungle-10",
  ])
})

test("filterAndRankCards can find jumbo starter partner variants", () => {
  assert.deepEqual(filterAndRankCards(cards, { variant: "jumbo" }).map((card) => card.id), ["swshp-SWSH039"])
  assert.deepEqual(filterAndRankCards(cards, { searchQuery: "starter partner" }).map((card) => card.id), ["swshp-SWSH039"])
})
