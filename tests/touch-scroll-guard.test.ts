import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { canScrollAlong, type ScrollBox } from "../lib/touch-scroll-guard"

const box = (over: Partial<ScrollBox>): ScrollBox => ({ overflowX: "visible", overflowY: "visible", scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100, ...over })

describe("touch scroll guard", () => {
  it("lets vertical scrollers with overflow take vertical drags", () => {
    assert.equal(canScrollAlong(box({ overflowY: "auto", scrollHeight: 400 }), 2, -30), true)
    assert.equal(canScrollAlong(box({ overflowY: "auto", scrollHeight: 100 }), 2, -30), false, "nothing to scroll")
    assert.equal(canScrollAlong(box({ overflowY: "hidden", scrollHeight: 400 }), 0, 30), false)
  })

  it("matches the axis the finger is moving along", () => {
    const rail = box({ overflowX: "auto", scrollWidth: 600 })
    assert.equal(canScrollAlong(rail, 40, 5), true)
    assert.equal(canScrollAlong(rail, 5, 40), false)
  })
})
