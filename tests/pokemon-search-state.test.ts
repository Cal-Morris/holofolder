import test from "node:test"
import assert from "node:assert/strict"
import {
  getInitialPokemonSearchFilter,
  getPokemonSearchPageJump,
} from "../lib/pokemon-search-state"

test("getInitialPokemonSearchFilter defaults search to all Pokemon", () => {
  assert.equal(getInitialPokemonSearchFilter(), "all")
})

test("getPokemonSearchPageJump detects numeric page queries", () => {
  assert.deepEqual(getPokemonSearchPageJump("6", 10), { page: 6, label: "Jump to page 6" })
  assert.deepEqual(getPokemonSearchPageJump("page 6", 10), { page: 6, label: "Jump to page 6" })
})

test("getPokemonSearchPageJump rejects out-of-range and mixed search queries", () => {
  assert.equal(getPokemonSearchPageJump("0", 10), null)
  assert.equal(getPokemonSearchPageJump("11", 10), null)
  assert.equal(getPokemonSearchPageJump("muk 6", 10), null)
})
