import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { dismissDuration, dragOffset, MAX_OVERDRAG, releaseVelocity, shouldDismissDrag } from "../lib/sheet-drag"

describe("sheet drag", () => {
  it("measures velocity over the last stretch of the gesture only", () => {
    const samples = [
      { y: 0, time: 0 },
      { y: 2, time: 200 },
      { y: 22, time: 240 },
      { y: 62, time: 280 },
    ]
    assert.equal(releaseVelocity(samples), 0.75)
    assert.equal(releaseVelocity(samples, 280 + 200), 0, "a finger that paused before lifting has no fling")
    assert.equal(releaseVelocity([{ y: 10, time: 5 }]), 0)
  })

  it("rubber-bands upward drags and never exceeds the cap", () => {
    assert.equal(dragOffset(40), 40)
    assert.ok(dragOffset(-10) < 0 && dragOffset(-10) > -10)
    assert.ok(dragOffset(-10_000) > -MAX_OVERDRAG)
  })

  it("dismisses on distance, fling, or projected position", () => {
    assert.equal(shouldDismissDrag(90, 0), true)
    assert.equal(shouldDismissDrag(30, 0.6), true)
    assert.equal(shouldDismissDrag(30, 0.1), false)
    assert.equal(shouldDismissDrag(60, 0.3, 300), true)
    assert.equal(shouldDismissDrag(60, 0.05, 600), false)
    assert.equal(shouldDismissDrag(120, -0.4), false, "flicking back up cancels")
    assert.equal(shouldDismissDrag(-20, 2), false)
  })

  it("keeps exit animations short", () => {
    assert.equal(dismissDuration(600, 5), 120)
    assert.equal(dismissDuration(600, 0), 240)
  })
})
