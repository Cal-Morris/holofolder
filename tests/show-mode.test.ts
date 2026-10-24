import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { SHOW_MODE_IDLE_MS, isStoredOn, parsePromptSnooze, parseShowMode, serializeShowMode, shouldOfferShowMode } from "@/lib/show-mode"

describe("show mode storage", () => {
  test("round-trips on and off", () => {
    const now = new Date("2026-10-22T10:00:00Z")
    assert.deepEqual(parseShowMode(serializeShowMode(true, now), now.getTime()), { on: true, since: now.toISOString(), seenAt: now.toISOString() })
    assert.deepEqual(parseShowMode(serializeShowMode(false, now), now.getTime()), { on: false, since: null })
  })

  test("treats missing or malformed values as off", () => {
    for (const raw of [null, undefined, "", "nope", "null", "[]", '{"on":"yes"}']) assert.equal(parseShowMode(raw).on, false)
  })

  test("stays on while the app is in use and lapses after a few hours away", () => {
    const start = new Date("2026-10-22T10:00:00Z")
    const later = new Date(start.getTime() + 6 * 60 * 60 * 1000)
    // Seen recently: still on, and the start time is kept.
    const touched = serializeShowMode(true, later, start.toISOString())
    assert.deepEqual(parseShowMode(touched, later.getTime() + 60_000), { on: true, since: start.toISOString(), seenAt: later.toISOString() })
    // Not opened for SHOW_MODE_IDLE_MS: the next launch reads it as off.
    assert.equal(parseShowMode(touched, later.getTime() + SHOW_MODE_IDLE_MS).on, false)
    assert.equal(isStoredOn(touched), true)
    // Values saved before seenAt existed fall back to when it was turned on.
    const legacy = JSON.stringify({ on: true, since: start.toISOString() })
    assert.equal(parseShowMode(legacy, start.getTime() + 1000).on, true)
    assert.equal(parseShowMode(legacy, start.getTime() + SHOW_MODE_IDLE_MS).on, false)
    assert.equal(parseShowMode(JSON.stringify({ on: true, since: null })).on, false)
  })

  test("parses the prompt dismissal", () => {
    assert.equal(parsePromptSnooze("1700000000000"), 1700000000000)
    assert.equal(parsePromptSnooze(null), null)
    assert.equal(parsePromptSnooze("abc"), null)
    assert.equal(parsePromptSnooze("0"), null)
  })
})

describe("shouldOfferShowMode", () => {
  test("never while it's on", () => {
    assert.equal(shouldOfferShowMode({ showModeOn: true, dismissedAt: null }), false)
  })
  test("offers it until dismissed or used, then never again", () => {
    assert.equal(shouldOfferShowMode({ showModeOn: false, dismissedAt: null }), true)
    assert.equal(shouldOfferShowMode({ showModeOn: false, dismissedAt: 1 }), false)
    assert.equal(shouldOfferShowMode({ showModeOn: false, dismissedAt: Date.now() - 365 * 24 * 60 * 60 * 1000 }), false)
  })
})
