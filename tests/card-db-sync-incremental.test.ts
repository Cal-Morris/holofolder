import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import { mapWithConcurrency, runIncrementalCardDbSync } from "../lib/card-db-sync"
import {
  DEFAULT_MAX_SETS_PER_CALL,
  getSyncSecret,
  InvalidSyncRequestError,
  isAuthorizedSyncRequest,
  isSetUpToDateWithListedCards,
  MAX_SETS_PER_CALL,
  parseIncrementalSyncRequest,
  selectIncrementalSyncTargets,
} from "../lib/card-db-sync-targets"
import { ANNIVERSARY_SET_IDS, selectRecentSetSummaries } from "../lib/tcg-set-slots"

// TCGdex /sets?sort:field=releaseDate&sort:order=DESC as of October 2026 (trimmed).
const REST_SETS_NEWEST_FIRST = [
  { id: "30th", name: "30th Celebration", cardCount: { total: 158, official: 128 } },
  { id: "30th-c", name: "30th Classic Collection", cardCount: { total: 30, official: 0 } },
  { id: "me05", name: "Pitch Black", cardCount: { total: 120, official: 84 } },
  { id: "me04", name: "Chaos Rising", cardCount: { total: 122, official: 86 } },
  { id: "me03", name: "Perfect Order", cardCount: { total: 124, official: 88 } },
  { id: "B2a", name: "Paldean Wonders", cardCount: { total: 131, official: 93 } },
  { id: "me02.5", name: "Ascended Heroes", cardCount: { total: 295, official: 217 } },
]
const TCGP_SET_IDS = new Set(["A1", "B1", "B1a", "B2", "B2a"])

describe("parseIncrementalSyncRequest", () => {
  test("defaults to missing mode", () => {
    assert.deepEqual(parseIncrementalSyncRequest(new URLSearchParams()), {
      mode: "missing",
      setIds: [],
      recent: 0,
      maxSets: DEFAULT_MAX_SETS_PER_CALL,
      dryRun: false,
    })
  })

  test("parses comma separated and repeated set ids, including the anniversary sets", () => {
    const request = parseIncrementalSyncRequest(new URLSearchParams("set=me05,30th&set=30th-c&set=me05"))
    assert.equal(request.mode, "sets")
    assert.deepEqual(request.setIds, ["me05", "30th", "30th-c"])
  })

  test("parses recent, maxSets and dryRun with bounds", () => {
    const request = parseIncrementalSyncRequest(new URLSearchParams("recent=2&maxSets=99&dryRun=1"))
    assert.equal(request.mode, "recent")
    assert.equal(request.recent, 2)
    assert.equal(request.maxSets, MAX_SETS_PER_CALL)
    assert.equal(request.dryRun, true)
    assert.equal(parseIncrementalSyncRequest(new URLSearchParams("recent=")).recent, 3)
    assert.equal(parseIncrementalSyncRequest(new URLSearchParams("recent=-4")).recent, 3)
    assert.equal(parseIncrementalSyncRequest(new URLSearchParams("dryRun=0")).dryRun, false)
  })

  test("rejects malformed set ids", () => {
    assert.throws(() => parseIncrementalSyncRequest(new URLSearchParams("set=../etc")), InvalidSyncRequestError)
    assert.throws(() => parseIncrementalSyncRequest(new URLSearchParams("set=me05;drop")), InvalidSyncRequestError)
  })
})

describe("sync auth", () => {
  test("accepts CARD_DB_SYNC_SECRET (preferred), SYNC_SECRET or CRON_SECRET, via bearer or legacy header", () => {
    const env = { CARD_DB_SYNC_SECRET: "card", CRON_SECRET: "cron" }
    assert.equal(getSyncSecret(env), "card")
    assert.equal(isAuthorizedSyncRequest("Bearer card", env), true)
    assert.equal(isAuthorizedSyncRequest("Bearer cron", env), true)
    assert.equal(isAuthorizedSyncRequest(null, env, "card"), true)
    assert.equal(isAuthorizedSyncRequest(null, env, "nope"), false)
    assert.equal(isAuthorizedSyncRequest("Bearer nope", env, null), false)
  })

  test("prefers SYNC_SECRET and falls back to CRON_SECRET", () => {
    assert.equal(getSyncSecret({ SYNC_SECRET: "a", CRON_SECRET: "b" }), "a")
    assert.equal(getSyncSecret({ CRON_SECRET: "b" }), "b")
    assert.equal(getSyncSecret({ SYNC_SECRET: "  " }), null)
    assert.equal(getSyncSecret({}), null)
  })

  test("requires an exact bearer token", () => {
    const env = { CRON_SECRET: "s3cret" }
    assert.equal(isAuthorizedSyncRequest("Bearer s3cret", env), true)
    assert.equal(isAuthorizedSyncRequest("Bearer s3cre", env), false)
    assert.equal(isAuthorizedSyncRequest("Bearer s3cretx", env), false)
    assert.equal(isAuthorizedSyncRequest("s3cret", env), false)
    assert.equal(isAuthorizedSyncRequest(null, env), false)
    assert.equal(isAuthorizedSyncRequest("Bearer ", {}), false)
    assert.equal(isAuthorizedSyncRequest("Bearer undefined", {}), false)
  })
})

describe("selectIncrementalSyncTargets", () => {
  test("recent mode includes both 30th anniversary sets and skips TCG Pocket", () => {
    assert.deepEqual(
      selectIncrementalSyncTargets({ mode: "recent", setIds: [], recent: 6 }, REST_SETS_NEWEST_FIRST, TCGP_SET_IDS),
      ["30th", "30th-c", "me05", "me04", "me03", "me02.5"],
    )
  })

  test("missing mode returns sets absent from or short in the mirror, newest first", () => {
    const counts = new Map([["me05", 120], ["me04", 100], ["me03", 124], ["me02.5", 295], ["30th", 158]])
    assert.deepEqual(
      selectIncrementalSyncTargets({ mode: "missing", setIds: [], recent: 0 }, REST_SETS_NEWEST_FIRST, TCGP_SET_IDS, counts),
      ["30th-c", "me04"],
    )
  })

  test("missing mode picks up a brand-new 30th Classic Collection with zero official cards", () => {
    const counts = new Map(REST_SETS_NEWEST_FIRST.map((set) => [set.id, set.cardCount.total]))
    counts.delete("30th-c")
    assert.deepEqual(
      selectIncrementalSyncTargets({ mode: "missing", setIds: [], recent: 0 }, REST_SETS_NEWEST_FIRST, TCGP_SET_IDS, counts),
      ["30th-c"],
    )
  })

  test("sets mode keeps the requested order and drops excluded sets", () => {
    assert.deepEqual(
      selectIncrementalSyncTargets({ mode: "sets", setIds: ["30th-c", "B1", "30th"], recent: 0 }, [], TCGP_SET_IDS),
      ["30th-c", "30th"],
    )
  })
})

test("selectRecentSetSummaries lists both 30th anniversary sets despite 30th-c having 0 official cards", () => {
  assert.deepEqual([...ANNIVERSARY_SET_IDS], ["30th", "30th-c"])
  const recent = selectRecentSetSummaries(
    [
      { id: "me05", name: "Pitch Black", officialCardCount: 84, releaseDate: "2026-07-17" },
      { id: "30th-c", name: "30th Classic Collection", officialCardCount: 0, releaseDate: "2026-09-16" },
      { id: "30th", name: "30th Celebration", officialCardCount: 128, releaseDate: "2026-09-16" },
      { id: "mep", name: "MEP Black Star Promos", officialCardCount: 0, releaseDate: "2026-09-20" },
    ],
    { asOfDate: "2026-10-09" },
  )
  assert.deepEqual(recent.map((set) => set.id).sort(), ["30th", "30th-c", "me05"])
})

test("mapWithConcurrency preserves order and caps parallelism", async () => {
  let active = 0
  let peak = 0
  const results = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, value))
    active -= 1
    return value * 10
  })
  assert.deepEqual(results, [50, 10, 30, 20, 40])
  assert.equal(peak, 2)
})

describe("runIncrementalCardDbSync (dry run, mocked TCGdex)", () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  }

  test("builds rows for 30th Classic Collection and honours maxSets", async () => {
    const requested: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith("/series/tcgp")) return json({ id: "tcgp", sets: [{ id: "B1" }] })
      if (url === "https://assets.tcgdex.net/datas.json") return json({ en: { me: { "30th-c": { "1": "x" } } } })
      if (url.includes("pokemon-tcg-data") && url.endsWith("/sets/en.json")) return json([])
      if (url.endsWith("/sets/30th-c")) {
        return json({
          id: "30th-c",
          name: "30th Classic Collection",
          releaseDate: "2026-09-16",
          serie: { id: "me", name: "Mega Evolution" },
          cardCount: { official: 0, total: 2 },
          cards: [
            { id: "30th-c-1", localId: "1", name: "Charizard" },
            { id: "30th-c-2", localId: "2", name: "Pikachu" },
          ],
        })
      }
      const cardMatch = url.match(/\/cards\/(30th-c-\d)$/)
      if (cardMatch) {
        const isCharizard = cardMatch[1] === "30th-c-1"
        return json({
          id: cardMatch[1],
          localId: isCharizard ? "1" : "2",
          name: isCharizard ? "Charizard" : "Pikachu",
          category: "Pokemon",
          dexId: [isCharizard ? 6 : 25],
          rarity: "Classic Collection",
        })
      }
      return json({ error: "not found" }, 404)
    }) as typeof fetch

    const result = await runIncrementalCardDbSync({
      request: { mode: "sets", setIds: ["30th-c", "30th"], recent: 0, maxSets: 1, dryRun: true },
    })

    assert.deepEqual(result.targetSetIds, ["30th-c", "30th"])
    assert.deepEqual(result.syncedSets.map((set) => [set.id, set.cardCount, set.dexLinkCount]), [["30th-c", 2, 2]])
    assert.deepEqual(result.remainingSetIds, ["30th"])
    assert.equal(result.dryRun, true)
    assert.ok(!requested.some((url) => url.endsWith("/sets/30th")), "should not fetch beyond maxSets")
  })

  test("skips sets from excluded series", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/series/tcgp")) return json({ id: "tcgp", sets: [] })
      if (url === "https://assets.tcgdex.net/datas.json") return json({})
      if (url.endsWith("/sets/en.json")) return json([])
      if (url.endsWith("/sets/A9")) return json({ id: "A9", serie: { id: "tcgp", name: "Pocket" }, cards: [] })
      return json({}, 404)
    }) as typeof fetch

    const result = await runIncrementalCardDbSync({
      request: { mode: "sets", setIds: ["A9"], recent: 0, maxSets: 4, dryRun: true },
    })
    assert.deepEqual(result.syncedSets, [])
    assert.deepEqual(result.skippedSetIds, ["A9"])
  })
})

describe("isSetUpToDateWithListedCards", () => {
  test("treats a set as current once every listed card is mirrored, even if TCGdex's total is higher", () => {
    // mfb: total 48 but only 34 listed
    assert.equal(isSetUpToDateWithListedCards(34, 34, true), true)
    // rc/sp: no cards listed, set row already mirrored
    assert.equal(isSetUpToDateWithListedCards(0, 0, true), true)
  })

  test("still syncs sets that are absent or missing listed cards", () => {
    assert.equal(isSetUpToDateWithListedCards(0, 0, false), false)
    assert.equal(isSetUpToDateWithListedCards(35, 34, true), false)
  })
})
