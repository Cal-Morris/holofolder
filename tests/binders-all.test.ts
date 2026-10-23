import test from "node:test"
import assert from "node:assert/strict"
import {
  ALL_BINDERS_CACHE_KEY,
  allBindersCollection,
  allBindersWantedEntries,
  buildAllBindersLookup,
  cardsOwnedElsewhere,
  formatOwnedIn,
  groupRowsByBinder,
  readAllBindersCache,
  speciesOwnedElsewhere,
  writeAllBindersCache,
} from "../lib/binders/all-binders"
import { buildCollectionAnalytics } from "../lib/collection-analytics"
import { buildWantedDashboardSummary } from "../lib/wanted-dashboard"
import { normalizeCollectionItem } from "../lib/collection/normalize"
import { createMemoryStore } from "../lib/offline-store/kv"

const MAIN = "11111111-1111-4111-8111-111111111111"
const TRADES = "22222222-2222-4222-8222-222222222222"
const SPARE = "33333333-3333-4333-8333-333333333333"
const BINDERS = [{ id: MAIN, name: "My binder" }, { id: TRADES, name: "Trades" }, { id: SPARE, name: "Spare" }]

const wanted = (cardId: string) => ({ card_id: cardId, card_name: cardId, added_at: "2026-01-01T00:00:00.000Z" })
const row = (binderId: string | null, pokemonId: number, cardId: string | null, status = "collected", wantedCards: unknown[] = []) => ({
  id: `${binderId}-${pokemonId}`, binder_id: binderId, user_id: "owner", pokemon_id: pokemonId, pokemon_name: `p${pokemonId}`,
  card_id: cardId, card_name: cardId, status, wanted_cards: wantedCards, collected_at: "2026-01-01T00:00:00.000Z",
})
const item = (raw: ReturnType<typeof row>) => normalizeCollectionItem(raw as never)

// The open binder (My binder): Bulbasaur owned, Charmander wanted. Trades: Charmander owned. Spare: Bulbasaur owned, Squirtle wanted.
const CURRENT = [item(row(MAIN, 1, "base1-44")), item(row(MAIN, 4, null, "wishlisted", [wanted("base1-46")]))]
const OTHER_ROWS = [row(TRADES, 4, "base1-46"), row(SPARE, 1, "base1-44"), row(SPARE, 7, null, "wishlisted", [wanted("base1-63")]), row(null, 9, "stray")]

function lookup() {
  return buildAllBindersLookup({ binders: BINDERS, currentBinderId: MAIN, currentCollection: CURRENT, others: groupRowsByBinder(OTHER_ROWS) })
}

test("rows group by binder and rows without a binder are dropped", () => {
  const grouped = groupRowsByBinder(OTHER_ROWS)
  assert.deepEqual(Object.keys(grouped).sort(), [SPARE, TRADES].sort())
  assert.equal(grouped[SPARE].length, 2)
})

test("the open binder comes from its live collection; per-binder status is unchanged", () => {
  const all = lookup()
  assert.deepEqual(all.collections.get(MAIN)?.map(entry => entry.pokemon_id), [1, 4])
  // A stale cached copy of the open binder never wins over the live one.
  const stale = buildAllBindersLookup({ binders: BINDERS, currentBinderId: MAIN, currentCollection: CURRENT, others: { [MAIN]: [], ...groupRowsByBinder(OTHER_ROWS) } })
  assert.equal(stale.collections.get(MAIN)?.length, 2)
  assert.equal(CURRENT.find(entry => entry.pokemon_id === 4)?.status, "wishlisted")
})

test("owned elsewhere: species and printings in other binders, with readable hints", () => {
  const all = lookup()
  assert.deepEqual(speciesOwnedElsewhere(all, 4, MAIN).map(binder => binder.name), ["Trades"])
  assert.deepEqual(speciesOwnedElsewhere(all, 1, MAIN).map(binder => binder.name), ["Spare"])
  assert.deepEqual(speciesOwnedElsewhere(all, 7, MAIN), [], "a wanted slot isn't owned")
  assert.deepEqual(speciesOwnedElsewhere(null, 4, MAIN), [])
  // From Trades, Bulbasaur is in My binder and Spare.
  assert.equal(formatOwnedIn(speciesOwnedElsewhere(all, 1, TRADES)), "Owned in My binder and Spare")
  const byCard = cardsOwnedElsewhere(all, MAIN)
  assert.deepEqual(byCard.get("base1-46")?.map(binder => binder.name), ["Trades"])
  assert.equal(byCard.has("base1-63"), false)
  assert.equal(formatOwnedIn([]), null)
  assert.equal(formatOwnedIn([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], "In"), "In A +2")
})

test("All binders want list tags each card with its binder; This binder stays as it was", () => {
  const entries = allBindersWantedEntries(lookup())
  assert.deepEqual(entries.map(entry => [entry.card.card_id, entry.binderName]), [["base1-46", "My binder"], ["base1-63", "Spare"]])
  const summary = buildWantedDashboardSummary(entries, {})
  assert.equal(summary.totalCards, 2)
  // Keys of the open binder's list don't change (no binder suffix without a binder id).
  const single = buildWantedDashboardSummary([{ pokemonId: 4, pokemonName: "p4", card: wanted("base1-46") }], {})
  assert.equal(single.cards[0].key, "4::base1-46::en::normal::2026-01-01T00:00:00.000Z")
  // The same printing wanted in two binders is two rows with distinct keys.
  const twice = buildWantedDashboardSummary([{ ...entries[0] }, { ...entries[0], binderId: SPARE, binderName: "Spare" }], {})
  assert.notEqual(twice.cards[0].key, twice.cards[1].key)
})

test("All binders analytics counts species once and each binder's copy of a card", () => {
  const all = allBindersCollection(lookup())
  const summary = buildCollectionAnalytics(all, {}, Date.now(), { countCopies: true })
  assert.equal(summary.ownedSpecies, 2, "Bulbasaur (two binders) and Charmander")
  assert.equal(summary.assignedCards, 3)
  const binderOnly = buildCollectionAnalytics(CURRENT, {})
  assert.equal(binderOnly.ownedSpecies, 1)
  assert.equal(binderOnly.assignedCards, 1)
})

test("the lookup is cached per owner for offline use; a partner reads the owner's cache, a stranger gets nothing", async () => {
  const store = createMemoryStore()
  await writeAllBindersCache(store, { ownerUserId: "owner", savedAt: "2026-01-01T00:00:00.000Z", collections: groupRowsByBinder(OTHER_ROWS) })
  assert.ok(await store.get(ALL_BINDERS_CACHE_KEY))
  // The partner's collection owner resolves to the owner, so the same cache applies.
  const cached = await readAllBindersCache(store, "owner")
  assert.equal(cached?.collections[TRADES]?.[0].card_id, "base1-46")
  const offline = buildAllBindersLookup({ binders: BINDERS, currentBinderId: MAIN, currentCollection: CURRENT, others: cached?.collections })
  assert.equal(formatOwnedIn(speciesOwnedElsewhere(offline, 4, MAIN)), "Owned in Trades")
  assert.equal(await readAllBindersCache(store, "someone-else"), null)
  assert.equal(await readAllBindersCache(null, "owner"), null)
})
