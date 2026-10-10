import test from "node:test"
import assert from "node:assert/strict"
import { clearCardsForPokemonCache, loadCardsForPokemon } from "../hooks/use-tcgdex"

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const cardsResponse = () => new Response(JSON.stringify({ cards: [{ id: "base1-44", name: "Bulbasaur" }] }), { status: 200 })

test("concurrent requests for the same Pokémon share one fetch", async () => {
  clearCardsForPokemonCache()
  const fetchMock = mockFetch(() => cardsResponse())
  try {
    const [first, second] = await Promise.all([loadCardsForPokemon(1, "en"), loadCardsForPokemon(1, "en")])
    assert.equal(fetchMock.calls.length, 1)
    assert.equal(fetchMock.calls[0], "/api/tcgdex-cache?pokemonId=1&language=en")
    assert.equal(first[0].language, "en")
    assert.deepEqual(first, second)
  } finally {
    fetchMock.restore()
  }
})

test("settled results are reused within the TTL and refetched after it", async () => {
  clearCardsForPokemonCache()
  const fetchMock = mockFetch(() => cardsResponse())
  try {
    await loadCardsForPokemon(4, "en")
    await loadCardsForPokemon(4, "en", Date.now() + 60_000)
    assert.equal(fetchMock.calls.length, 1)
    await loadCardsForPokemon(4, "en", Date.now() + 6 * 60_000)
    assert.equal(fetchMock.calls.length, 2)
  } finally {
    fetchMock.restore()
  }
})

test("language is part of the key", async () => {
  clearCardsForPokemonCache()
  const fetchMock = mockFetch(() => cardsResponse())
  try {
    await loadCardsForPokemon(25, "en")
    await loadCardsForPokemon(25, "ja")
    assert.equal(fetchMock.calls.length, 2)
  } finally {
    fetchMock.restore()
  }
})

test("failures are not cached", async () => {
  clearCardsForPokemonCache()
  let fail = true
  const fetchMock = mockFetch(() => fail ? new Response(JSON.stringify({ error: "down" }), { status: 500 }) : cardsResponse())
  try {
    await assert.rejects(loadCardsForPokemon(7, "en"), /down/)
    fail = false
    const cards = await loadCardsForPokemon(7, "en")
    assert.equal(cards.length, 1)
    assert.equal(fetchMock.calls.length, 2)
  } finally {
    fetchMock.restore()
  }
})
