import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { getAdjacentPageNumbers } from "../lib/binder-page-turn"

describe("getAdjacentPageNumbers", () => {
  test("single page: next then previous", () => {
    assert.deepEqual(getAdjacentPageNumbers([5], 65, 1), [6, 4])
  })
  test("clamps at the ends", () => {
    assert.deepEqual(getAdjacentPageNumbers([1], 65, 1), [2])
    assert.deepEqual(getAdjacentPageNumbers([65], 65, 1), [64])
    assert.deepEqual(getAdjacentPageNumbers([1], 1, 1), [])
  })
  test("spread: the next and previous spreads", () => {
    assert.deepEqual(getAdjacentPageNumbers([4, 5], 65, 2), [6, 7, 3, 2])
    assert.deepEqual(getAdjacentPageNumbers([1], 65, 2), [2, 3])
  })
  test("ignores invalid input", () => {
    assert.deepEqual(getAdjacentPageNumbers([], 65, 1), [])
    assert.deepEqual(getAdjacentPageNumbers([0, 99], 65, 1), [])
  })
})
