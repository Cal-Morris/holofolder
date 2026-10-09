import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { getPriceSourceLabel, normalizePriceSource } from "../hooks/use-card-prices"

// Every provider the server pipeline can emit (lib/price-intelligence.ts PriceProvider).
const SERVER_PROVIDERS = ["tcgplayer", "cardmarket", "ebay", "pricecharting", "pokescope", "pokepulse", "eyevo", "public-page"] as const

test("client keeps every server price provider instead of silently dropping it", () => {
  for (const provider of SERVER_PROVIDERS) {
    assert.equal(normalizePriceSource(provider), provider)
  }
  assert.equal(normalizePriceSource("not-a-provider"), null)
  assert.equal(normalizePriceSource(null), null)
})

test("PokePulse evidence is labelled as PokePulse, not Cardmarket", () => {
  assert.equal(getPriceSourceLabel("pokepulse"), "PokePulse")
  assert.equal(getPriceSourceLabel("tcgplayer"), "TCGplayer")
  assert.equal(getPriceSourceLabel("cardmarket"), "Cardmarket")
})

test("server provider union matches the client provider list", () => {
  const source = readFileSync(new URL("../lib/price-intelligence.ts", import.meta.url), "utf8")
  const union = source.match(/export type PriceProvider = ([^\n]+)/)?.[1] ?? ""
  const serverProviders = [...union.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()
  assert.deepEqual(serverProviders, [...SERVER_PROVIDERS].sort())
})

test("observation provider constraints allow pokepulse after migration 023", () => {
  const migration = readFileSync(new URL("../scripts/023_price_provider_pokepulse.sql", import.meta.url), "utf8")
  const checks = [...migration.matchAll(/CHECK \(provider IN \(([^)]+)\)\)/g)].map((match) => match[1])
  assert.equal(checks.length, 2)
  for (const check of checks) {
    for (const provider of SERVER_PROVIDERS) {
      assert.ok(check.includes(`'${provider}'`), `${provider} missing from ${check}`)
    }
  }
})
