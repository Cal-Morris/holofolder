import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { SHOW_MODE_PROMPT_SNOOZE_MS, parsePromptSnooze, parseShowMode, serializeShowMode, shouldOfferShowMode } from "@/lib/show-mode"

describe("show mode storage", () => {
  test("round-trips on and off", () => {
    const now = new Date("2026-10-22T10:00:00Z")
    assert.deepEqual(parseShowMode(serializeShowMode(true, now)), { on: true, since: now.toISOString() })
    assert.deepEqual(parseShowMode(serializeShowMode(false, now)), { on: false, since: null })
  })

  test("treats missing or malformed values as off", () => {
    for (const raw of [null, undefined, "", "nope", "null", "[]", '{"on":"yes"}']) assert.equal(parseShowMode(raw).on, false)
  })

  test("parses the prompt snooze", () => {
    assert.equal(parsePromptSnooze("1700000000000"), 1700000000000)
    assert.equal(parsePromptSnooze(null), null)
    assert.equal(parsePromptSnooze("abc"), null)
    assert.equal(parsePromptSnooze("0"), null)
  })
})

describe("shouldOfferShowMode", () => {
  const now = 1_800_000_000_000
  test("never while it's on", () => {
    assert.equal(shouldOfferShowMode({ showModeOn: true, isOnline: false, snoozedAt: null, now }), false)
  })
  test("offers it until snoozed, and again after the snooze", () => {
    assert.equal(shouldOfferShowMode({ showModeOn: false, isOnline: true, snoozedAt: null, now }), true)
    assert.equal(shouldOfferShowMode({ showModeOn: false, isOnline: true, snoozedAt: now - 1000, now }), false)
    assert.equal(shouldOfferShowMode({ showModeOn: false, isOnline: true, snoozedAt: now - SHOW_MODE_PROMPT_SNOOZE_MS, now }), true)
  })
  test("always offers it when the app is offline", () => {
    assert.equal(shouldOfferShowMode({ showModeOn: false, isOnline: false, snoozedAt: now - 1000, now }), true)
  })
})
