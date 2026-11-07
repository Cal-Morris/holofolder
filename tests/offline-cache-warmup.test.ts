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
    "/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F4%2Fhigh.png",
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

  assert.equal(urls[0], "/app")
  assert.ok(urls.includes("/app/api/tcgdex-cache?pokemonId=25&language=en"))
  assert.ok(urls.includes("/app/api/tcgdex-cache?pokemonId=26&language=en"))
  assert.ok(urls.includes("/app/api/tcgdex-cache?pokemonId=1&language=en"))
  assert.ok(urls.includes("/wanted/local.png"))
  assert.ok(urls.includes("/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F1%2Fhigh.png"))
  assert.equal(
    urls.filter((url) => url === "/app/api/tcgdex-cache?pokemonId=25&language=en").length,
    1,
  )
})

test("shouldPostOfflineCacheWarmup only posts when the warmup URL set changes", () => {
  const urls = ["/", "/app/api/tcgdex-cache?pokemonId=25&language=en"]

  assert.equal(shouldPostOfflineCacheWarmup(null, urls), true)
  assert.equal(shouldPostOfflineCacheWarmup(urls.join("\n"), [...urls]), false)
  assert.equal(shouldPostOfflineCacheWarmup(urls.join("\n"), [...urls, "/app/api/tcgdex-cache?pokemonId=26&language=en"]), true)
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
  assert.ok(urls.includes("/app/api/card-image-proxy?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fbase1%2F30%2Fhigh.png"))
  assert.ok(!urls.includes(getOfficialArtworkUrl(2)))
  assert.ok(urls.includes(getOfficialArtworkUrl(3)))
  assert.ok(urls.indexOf("/app/api/tcgdex-cache?pokemonId=1&language=en") < 10)
})

test("warmup stops scanning discarded collection and wanted URLs at the cap", () => {
  let wantedReads = 0
  let discardedCollectionReads = 0
  const wantedImages = [
    "/owned.png", "not a url", "/wanted/one.png", "/wanted/two.png",
    ...Array.from({ length: 10_000 }, (_, index) => `/wanted/discarded-${index}.png`),
  ]
  const collection = [
    {
      pokemon_id: 1,
      card_image: "/owned.png",
      wanted_cards: wantedImages.map(image => ({ get card_image() { wantedReads += 1; return image } })),
    },
    ...Array.from({ length: 10_000 }, (_, index) => ({
      get pokemon_id() { discardedCollectionReads += 1; return index + 2 },
      card_image: `/discarded-${index}.png`,
    })),
  ]
  const allUrls = buildOfflineCacheWarmupUrls({ collection: [
    { pokemon_id: 1, card_image: "/owned.png", wanted_cards: wantedImages.map(card_image => ({ card_image })) },
    ...Array.from({ length: 10_000 }, (_, index) => ({ pokemon_id: index + 2, card_image: `/discarded-${index}.png` })),
  ], maxUrls: 50_000 })

  assert.deepEqual(buildOfflineCacheWarmupUrls({ collection, maxUrls: 5 }), allUrls.slice(0, 5))
  assert.equal(wantedReads, 4)
  assert.equal(discardedCollectionReads, 0)
})
