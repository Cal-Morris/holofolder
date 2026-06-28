import test from "node:test"
import assert from "node:assert/strict"
import { getInitialPokemonSearchFilter } from "../lib/pokemon-search-state"

test("getInitialPokemonSearchFilter defaults search to all Pokemon", () => {
  assert.equal(getInitialPokemonSearchFilter(), "all")
})
