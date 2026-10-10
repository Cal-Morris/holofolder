import test from "node:test"
import assert from "node:assert/strict"
import {
  buildOfflineCacheWarmupUrls,
  shouldPostOfflineCacheWarmup,
  toCacheableCardImageUrl,
} from "../lib/offline-cache-warmup"
import { getOfficialArtworkUrl } from "../lib/pokemon-catalog"

test("toCacheableCardImageUrl keeps local images and proxies remote card images", () => {
  assert.equal(toCacheableCardImageUrl("/cards/local.png"), "/cards/local.png")
  assert.equal(
    toCacheableCardImageUrl("https://assets.tcgdex.net/en/base1/4/high.png"),
    "/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F4%2Fhigh.png",
  )
  assert.equal(toCacheableCardImageUrl(""), null)
  assert.equal(toCacheableCardImageUrl("not a url"), null)
})

test("buildOfflineCacheWarmupUrls warms shell, current card lists, collection card lists, and saved card art", () => {
  const urls = buildOfflineCacheWarmupUrls({
    visiblePokemonIds: [25, 26],
    selectedPokemonId: 25,
    collection: [
      {
        pokemon_id: 1,
        card_image: "https://assets.tcgdex.net/en/base1/1/high.png",
        wanted_cards: [
          {
            card_image: "/wanted/local.png",
          },
        ],
      },
      {
        pokemon_id: 25,
        card_image: "https://assets.tcgdex.net/en/base1/58/high.png",
        wanted_cards: [],
      },
    ],
  })

  assert.equal(urls[0], "/")
  assert.ok(urls.includes("/api/tcgdex-cache?pokemonId=25&language=en"))
  assert.ok(urls.includes("/api/tcgdex-cache?pokemonId=26&language=en"))
  assert.ok(urls.includes("/api/tcgdex-cache?pokemonId=1&language=en"))
  assert.ok(urls.includes("/wanted/local.png"))
  assert.ok(urls.includes("/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F1%2Fhigh.png"))
  assert.equal(
    urls.filter((url) => url === "/api/tcgdex-cache?pokemonId=25&language=en").length,
    1,
  )
})

test("shouldPostOfflineCacheWarmup only posts when the warmup URL set changes", () => {
  const urls = ["/", "/api/tcgdex-cache?pokemonId=25&language=en"]

  assert.equal(shouldPostOfflineCacheWarmup(null, urls), true)
  assert.equal(shouldPostOfflineCacheWarmup(urls.join("\n"), [...urls]), false)
  assert.equal(shouldPostOfflineCacheWarmup(urls.join("\n"), [...urls, "/api/tcgdex-cache?pokemonId=26&language=en"]), true)
})

test("buildOfflineCacheWarmupUrls warms what visible slots render before the rest of the collection", () => {
  const collection = Array.from({ length: 600 }, (_, index) => ({
    pokemon_id: index + 100,
    card_image: `https://assets.tcgdex.net/en/set/${index}/high.png`,
    wanted_cards: [],
  }))
  collection.push({ pokemon_id: 2, card_image: "https://assets.tcgdex.net/en/base1/30/high.png", wanted_cards: [] })

  const urls = buildOfflineCacheWarmupUrls({ visiblePokemonIds: [1, 2], selectedPokemonId: 3, collection })

  assert.equal(urls.length, 500)
  // Empty slot: Pokémon artwork. Owned slot: the card image, not the artwork.
  assert.ok(urls.includes(getOfficialArtworkUrl(1)))
  assert.ok(urls.includes("/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F30%2Fhigh.png"))
  assert.ok(!urls.includes(getOfficialArtworkUrl(2)))
  assert.ok(urls.includes(getOfficialArtworkUrl(3)))
  assert.ok(urls.indexOf("/api/tcgdex-cache?pokemonId=1&language=en") < 10)
})
