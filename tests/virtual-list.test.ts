import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeVirtualRange, estimateRowHeight } from "../lib/virtual-list"

// Synthetic list geometry (not real catalog data): fixed-height rows unless stated.
const uniform = (height: number) => () => height

describe("computeVirtualRange", () => {
  it("returns an empty range for an empty list", () => {
    assert.deepEqual(
      computeVirtualRange({ count: 0, getHeight: uniform(100), gap: 6, scrollTop: 0, viewportHeight: 800, overscanPx: 0 }),
      { start: 0, end: 0, offsetTop: 0, totalHeight: 0 },
    )
  })

  it("reserves the full height including gaps between (not after) rows", () => {
    const range = computeVirtualRange({ count: 10, getHeight: uniform(100), gap: 6, scrollTop: 0, viewportHeight: 50_000, overscanPx: 0 })
    assert.equal(range.totalHeight, 10 * 100 + 9 * 6)
    assert.equal(range.start, 0)
    assert.equal(range.end, 10)
  })

  it("renders only the rows around the viewport at the top", () => {
    // Rows are 106px apart; the window is 0..(800+200).
    const range = computeVirtualRange({ count: 1025, getHeight: uniform(100), gap: 6, scrollTop: 0, viewportHeight: 800, overscanPx: 200 })
    assert.equal(range.start, 0)
    assert.equal(range.offsetTop, 0)
    assert.equal(range.end, 10) // row 9 starts at 954 (<= 1000); row 10 starts at 1060
  })

  it("windows the middle of the list with the matching offset", () => {
    const scrollTop = 106 * 500
    const range = computeVirtualRange({ count: 1025, getHeight: uniform(100), gap: 6, scrollTop, viewportHeight: 800, overscanPx: 212 })
    // Row 498 ends at 498*106+100 = 52888 >= 53000-212 = 52788.
    assert.equal(range.start, 498)
    assert.equal(range.offsetTop, 498 * 106)
    assert.ok(range.end - range.start < 20)
    assert.ok(range.end > 500 + 7)
  })

  it("includes the last row when scrolled to the bottom", () => {
    const count = 1025
    const totalHeight = count * 100 + (count - 1) * 6
    const range = computeVirtualRange({ count, getHeight: uniform(100), gap: 6, scrollTop: totalHeight - 800, viewportHeight: 800, overscanPx: 200 })
    assert.equal(range.end, count)
    assert.equal(range.totalHeight, totalHeight)
  })

  it("shows the last row when scrolled past the end of a list that just got shorter", () => {
    const range = computeVirtualRange({ count: 3, getHeight: uniform(100), gap: 6, scrollTop: 90_000, viewportHeight: 800, overscanPx: 0 })
    assert.equal(range.start, 2)
    assert.equal(range.end, 3)
    assert.equal(range.offsetTop, 212)
  })

  it("uses per-row heights for the offset", () => {
    const heights = [80, 120, 100, 90, 110]
    const range = computeVirtualRange({ count: 5, getHeight: (index) => heights[index], gap: 10, scrollTop: 215, viewportHeight: 50, overscanPx: 0 })
    // Rows: 0-80, 90-210, 220-320, 330-420 ...
    assert.equal(range.start, 2)
    assert.equal(range.offsetTop, 220)
    assert.equal(range.end, 3) // row 3 starts at 330, below the window (215..265)
  })
})

describe("estimateRowHeight", () => {
  it("falls back when nothing has been measured", () => {
    assert.equal(estimateRowHeight([], 96), 96)
  })

  it("averages the measured heights", () => {
    assert.equal(estimateRowHeight(new Map([["1", 90], ["2", 110]]).values(), 96), 100)
  })
})
