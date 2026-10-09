import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { COLLAPSE_AT_PX, EXPAND_AT_PX, MIN_SCROLL_RANGE_PX, nextCollapsedState } from "../lib/collapse-on-scroll"

describe("nextCollapsedState", () => {
  test("stays expanded near the top", () => {
    assert.equal(nextCollapsedState(false, 0, 2000), false)
    assert.equal(nextCollapsedState(false, COLLAPSE_AT_PX, 2000), false)
  })
  test("collapses once scrolled past the threshold", () => {
    assert.equal(nextCollapsedState(false, COLLAPSE_AT_PX + 1, 2000), true)
  })
  test("never collapses short lists that cannot scroll far", () => {
    assert.equal(nextCollapsedState(false, 80, MIN_SCROLL_RANGE_PX - 1), false)
  })
  test("only expands again back at the very top (hysteresis)", () => {
    assert.equal(nextCollapsedState(true, 20, 2000), true)
    assert.equal(nextCollapsedState(true, EXPAND_AT_PX + 1, 2000), true)
    assert.equal(nextCollapsedState(true, EXPAND_AT_PX, 2000), false)
    assert.equal(nextCollapsedState(true, 0, 0), false)
  })
})
