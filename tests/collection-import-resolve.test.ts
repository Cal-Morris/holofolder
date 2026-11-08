import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveImportLookup, readImportLookups } from "../lib/collection-import-resolve"
import type { SearchCardResult } from "../lib/pokemon-card-browse"
const lookup = { language: "en", finish: "normal", list: "owned", cardName: "Bulbasaur", set: "Base Set", number: "0044/102" } as const
const candidate: SearchCardResult = { id: "synthetic-base-44", name: "Bulbasaur", localId: "44", language: "en", set: { id: "synthetic-base", name: "Base Set", officialCardCount: 102 }, dexIds: [1], variants: { normal: true } }
test("resolves exact identity, retains leading-number meaning and refuses ambiguity", () => {
  assert.equal(resolveImportLookup(lookup, [candidate]).item?.card_id, candidate.id)
  for (const candidates of [[{ ...candidate, name: "Other" }], [{ ...candidate, dexIds: [1, 4] }], [{ ...candidate, language: "ja" }], [candidate, { ...candidate, id: "different-printing" }]]) {
    assert.equal(resolveImportLookup(lookup, candidates).item, undefined)
  }
  assert.equal(resolveImportLookup({ ...lookup, finish: "reverse_holo" }, [candidate]).item, undefined)
  assert.equal(resolveImportLookup({ ...lookup, number: "44/99" }, [candidate]).item, undefined)
  assert.equal(resolveImportLookup(lookup, [{ ...candidate, variants: { normal: false, holo: false, reverse: true } }]).item, undefined)
  assert.equal(resolveImportLookup(lookup, [{ ...candidate, variants: { reverse: true } }]).item, undefined)
})
test("explicit IDs never fall back to a similarly named card", () => {
  assert.equal(resolveImportLookup({ ...lookup, cardId: "unknown" }, [candidate]).item, undefined)
  assert.equal(resolveImportLookup({ ...lookup, cardId: candidate.id }, [candidate]).item?.card_id, candidate.id)
})
test("lookup request accepts bounded identities only", () => {
  assert.deepEqual(readImportLookups({ lookups: [lookup] }), [lookup])
  for (const body of [{ lookups: Array(26).fill(lookup) }, { lookups: [{ ...lookup, language: "xx" }] }, { lookups: [{ ...lookup, cardId: "a".repeat(241) }] }, { lookups: [{ ...lookup, tcgplayerId: "1),x" }] }, { lookups: [{ ...lookup, cells: ["private note"] }] }]) assert.throws(() => readImportLookups(body))
})
