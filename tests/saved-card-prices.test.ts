import { test } from "node:test"
import assert from "node:assert/strict"
import { loadSavedCardPrices, SAVED_PRICE_SUMMARY_COLUMNS } from "../lib/card-pricing"

/** Synthetic card_prices table and PostgREST-shaped query recorder. No hosted reads. */
function syntheticPrices(rows: Record<string, unknown>[]) {
  const calls: { projection: string; language: unknown; ids: string[] }[] = []
  const db = { from: (table: string) => {
    assert.equal(table, "card_prices")
    let projection = "", language: unknown, ids: string[] = []
    const q = {
      select(p: string) { projection = p; return q },
      eq(k: string, v: unknown) { assert.equal(k, "language"); language = v; return q },
      in(k: string, v: string[]) { assert.equal(k, "card_id"); ids = v; return q },
      then(resolve: (v: unknown) => unknown) {
        calls.push({ projection, language, ids })
        const data = rows.filter(row => row.language === language && ids.includes(String(row.card_id)))
          .map(row => projection === "*" ? row : Object.fromEntries(projection.split(",").map(k => [k, row[k]])))
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return q
  } }
  return { db: db as never, calls }
}
const row = (cardId: string, language = "en") => ({ card_id: cardId, language, gbp_amount: 5, confidence: "high", fetched_at: "2026-11-01T00:00:00Z", history_points: [{ date: "2026-10-01", source: "tcgplayer", currency: "USD", amount: 4, lowAmount: null, finish: "normal", productId: "1" }] })

test("saved prices query once per language and 200 card IDs, in parallel", async () => {
  const lookups = [...Array.from({ length: 450 }, (_, i) => ({ cardId: `synthetic-${i}`, language: "en" as const })), { cardId: "synthetic-1", language: "fr" as const }]
  const { db, calls } = syntheticPrices([...lookups.map(l => row(l.cardId, l.language)), row("synthetic-2", "fr")])
  const prices = await loadSavedCardPrices(lookups, { db, summary: true })
  assert.deepEqual(calls.map(c => [c.language, c.ids.length]), [["en", 200], ["en", 200], ["en", 50], ["fr", 1]])
  assert.equal(prices.length, 451)
  assert.ok(!prices.some(p => p.cardId === "synthetic-2" && p.language === "fr"), "unrequested pair dropped")
})

test("summary reads select only consumer columns and omit history; full reads keep everything", async () => {
  const lookups = [{ cardId: "synthetic-1", language: "en" as const }]
  const without = syntheticPrices([row("synthetic-1")])
  const [lean] = await loadSavedCardPrices(lookups, { db: without.db, summary: true })
  assert.equal(without.calls[0].projection, SAVED_PRICE_SUMMARY_COLUMNS)
  for (const column of ["history_points", "trend_points", "buy_signal", "fx_date", "fetched_at"]) assert.ok(!SAVED_PRICE_SUMMARY_COLUMNS.split(",").includes(column), column)
  assert.equal(lean.historyPoints, undefined)
  assert.equal(lean.marketGbpAmount, 5)
  const full = syntheticPrices([row("synthetic-1")])
  const [complete] = await loadSavedCardPrices(lookups, { db: full.db })
  assert.equal(full.calls[0].projection, "*")
  assert.equal(complete.historyPoints?.length, 1)
})
