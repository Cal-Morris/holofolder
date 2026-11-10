import { test } from "node:test"
import assert from "node:assert/strict"
import { parseNavigationEvidence } from "@/lib/collection/inventory-read-transport"
import { inventoryBrowseFixture } from "./fixtures/inventory-browse"

// Synthetic catalog rows only. Keys are in the parser's output order so accepted output can be compared byte for byte.
const snapshot = inventoryBrowseFixture(1)
const row = (id: string, language?: string, extra: Record<string, unknown> = {}) => ({
  card: { id, localId: "1", name: `Synthetic ${id}`, set: { id: "synthetic-set", name: "Synthetic set" }, ...(language === undefined ? {} : { language }), ...extra },
  speciesNames: ["synthetic"],
})
const parse = (catalog: unknown[]) => parseNavigationEvidence({ catalog, layouts: [] }, snapshot)

test("navigation catalog keeps every row for distinct (card id, language) pairs, in order and byte for byte", () => {
  const catalog = [
    row("synthetic-a", "en", { canonicalId: "synthetic-a", aliasIds: ["synthetic-a-alias"], image: "https://assets.tcgdex.net/en/synthetic/a/high.webp" }),
    row("synthetic-a", "ja"), row("synthetic-a"), row("synthetic-b"), row("__proto__"), row("constructor", "en"),
    { ...row("synthetic-c", "fr"), pokemonIds: [6, 4] },
  ]
  assert.equal(JSON.stringify(parse(catalog)?.catalog), JSON.stringify(catalog))
})

test("navigation catalog rejects the whole envelope for duplicate or malformed rows", () => {
  const filler = Array.from({ length: 50 }, (_, i) => row(`synthetic-${i}`, "en"))
  const cases: Record<string, unknown[]> = {
    "duplicate first and last": [row("synthetic-dup", "en"), ...filler, row("synthetic-dup", "en")],
    "duplicate without language": [row("synthetic-dup"), ...filler, row("synthetic-dup")],
    "adjacent duplicate": [...filler, row("synthetic-dup", "ja"), row("synthetic-dup", "ja")],
    "unknown language": [...filler, row("synthetic-x", "xx")],
    "undefined language key": [...filler, row("synthetic-x", undefined, { language: undefined })],
    "extra card key": [...filler, row("synthetic-x", "en", { private: true })],
    "bad alias": [...filler, row("synthetic-x", "en", { aliasIds: [1] })],
    "duplicate pokemon ids": [...filler, { ...row("synthetic-x", "en"), pokemonIds: [6, 6] }],
  }
  for (const [name, catalog] of Object.entries(cases)) assert.equal(parse(catalog), undefined, name)
})

test("navigation catalog validation is linear in catalog rows", () => {
  const n = 2_000
  let reads = 0
  const catalog = Array.from({ length: n }, (_, i) => {
    const entry = row(`synthetic-${i}`, "en")
    return { ...entry, card: new Proxy(entry.card, { get: (target, key) => (key === "id" && reads++, Reflect.get(target, key)) }) }
  })
  assert.equal(parse(catalog)?.catalog.length, n)
  // A pairwise duplicate scan reads each row's id once per earlier row (about n²/2 = 2,000,000 reads).
  assert.ok(reads <= 8 * n, `${reads} card id reads for ${n} rows`)
})
