import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { isCardPriceCheck } from "../lib/card-price-checks"
import { execFileSync } from "node:child_process"

// Synthetic persisted sample, not market data.
const saved = { summary: { kind: "sold", currency: "GBP", count: 1, median: 9, low: 9, high: 9 }, checkedAt: new Date().toISOString() }
test("saved price checks validate amounts, summary ordering and trusted links", () => {
  assert.equal(isCardPriceCheck(saved), true)
  for (const s of [{ ...saved.summary, median: 0 }, { ...saved.summary, low: 10 }, { ...saved.summary, currency: "USD" }, { ...saved.summary, count: 0 }]) assert.equal(isCardPriceCheck({ ...saved, summary: s }), false)
  assert.equal(isCardPriceCheck({ ...saved, searchUrl: "https://evil.test/" }), false)
})

test("combined checks save both sources, reuse them, and preserve saved sold evidence on failure", () => {
  // Isolate module-level OAuth state from the deletion callback's independent token-cache tests.
  execFileSync(process.execPath, [new URL("./fixtures/card-price-check-service.ts", import.meta.url).pathname], { stdio: "pipe" })
})

const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL
test("price-check migration is repeatable, concurrent refreshes claim once and client roles cannot write", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return
  if (!["localhost", "127.0.0.1"].includes(new URL(databaseUrl!).hostname)) throw new Error("Requires isolated local database")
  const a = new Client({ connectionString: databaseUrl }), b = new Client({ connectionString: databaseUrl })
  await Promise.all([a.connect(), b.connect()])
  try {
    const sql = await readFile(new URL("../scripts/042_card_price_checks.sql", import.meta.url), "utf8")
    await a.query(sql)
    await a.query(sql)
    await a.query("delete from public.card_price_checks where card_id = 'synthetic-concurrent'")
    const claims = await Promise.all([a, b].map(c => c.query("select public.claim_card_price_check('synthetic-concurrent', 'normal', 'soldcomps') as claimed")))
    assert.equal(claims.filter(r => r.rows[0].claimed).length, 1)
    assert.equal((await a.query("select has_table_privilege('authenticated','public.card_price_checks','INSERT') as writes, has_function_privilege('anon','public.claim_card_price_check(text,text,text)','EXECUTE') as calls")).rows[0].writes, false)
    assert.equal((await a.query("select has_function_privilege('anon','public.claim_card_price_check(text,text,text)','EXECUTE') as calls")).rows[0].calls, false)
    const plan = await a.query("explain (analyze, buffers) select result_json from public.card_price_checks where card_id='synthetic-concurrent' and finish='normal' and source='soldcomps'")
    assert.ok(plan.rows.length > 0)
  } finally {
    await a.query("delete from public.card_price_checks where card_id = 'synthetic-concurrent'")
    await Promise.all([a.end(), b.end()])
  }
})
