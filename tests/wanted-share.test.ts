import test from "node:test"
import assert from "node:assert/strict"
import { buildWantedListText } from "../lib/wanted-share"
import type { WantedDashboardCard } from "../lib/wanted-dashboard"

const entry = (card: Partial<WantedDashboardCard["card"]> & { card_id: string; card_name: string }, amount: number | null = null) => ({
  key: card.card_id, pokemonId: 1, pokemonName: card.card_name, price: undefined,
  marketGbpAmount: amount, goodGbpAmount: null, effectiveGbpAmount: amount, isPriced: amount !== null, priceBandId: "unpriced",
  card: { added_at: "2026-01-01T00:00:00Z", ...card },
}) as WantedDashboardCard

test("buildWantedListText groups by set, sorts by number and shows only useful details", () => {
  const text = buildWantedListText([
    entry({ card_id: "base1-4", card_name: "Charizard", card_set: "Base Set", local_id: "4", set_total: 102, card_finish: "holo" }, 250),
    entry({ card_id: "sv03.5-025", card_name: "Pikachu", card_set: "151", local_id: "025", set_total: 165, card_language: "ja" }, 3.2),
    entry({ card_id: "base1-2", card_name: "Blastoise", card_set: "Base Set", local_id: "2", set_total: 102 }),
    entry({ card_id: "x", card_name: "Mystery" }),
  ], card => (card.effectiveGbpAmount === null ? null : `£${card.effectiveGbpAmount.toFixed(2)}`))
  assert.equal(text, [
    "Want list · 4 cards",
    "",
    "151",
    "• Pikachu 025/165 · JA · £3.20",
    "",
    "Base Set",
    "• Blastoise 2/102",
    "• Charizard 4/102 · Holo · £250.00",
    "",
    "Other",
    "• Mystery",
  ].join("\n"))
})

test("buildWantedListText uses the singular for one card", () => {
  assert.match(buildWantedListText([entry({ card_id: "a", card_name: "Mew" })], () => null), /^Want list · 1 card\n/)
})
