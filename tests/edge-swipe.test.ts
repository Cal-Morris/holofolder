import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { classifyEdgeDrag, edgeSwipeProgress, isEdgeStart, shouldCommitEdgeSwipe, ViewBackStack } from "../lib/edge-swipe"

describe("edge swipe back", () => {
  it("only starts at the left edge", () => {
    assert.equal(isEdgeStart(4), true)
    assert.equal(isEdgeStart(24), true)
    assert.equal(isEdgeStart(40), false)
  })

  it("tells sideways drags from vertical scrolls", () => {
    assert.equal(classifyEdgeDrag(4, 3), "pending")
    assert.equal(classifyEdgeDrag(30, 6), "back")
    assert.equal(classifyEdgeDrag(10, 30), "cancel")
    assert.equal(classifyEdgeDrag(-20, 0), "cancel")
  })

  it("commits on distance or a quick flick, not a hesitant nudge", () => {
    assert.equal(shouldCommitEdgeSwipe(90, 0), true)
    assert.equal(shouldCommitEdgeSwipe(90, -0.5), false, "dragging back left cancels")
    assert.equal(shouldCommitEdgeSwipe(40, 0.6), true)
    assert.equal(shouldCommitEdgeSwipe(40, 0.1), false)
    assert.equal(shouldCommitEdgeSwipe(-10, 2), false)
    assert.equal(edgeSwipeProgress(36), 0.5)
    assert.equal(edgeSwipeProgress(500), 1)
  })

  it("returns through visited views without looping", () => {
    const stack = new ViewBackStack<string>(3)
    stack.visit("binder", "list")
    stack.visit("list", "sets")
    assert.equal(stack.back("sets"), "list")
    stack.visit("sets", "list") // the back navigation itself
    assert.equal(stack.peek(), "binder")
    assert.equal(stack.back("list"), "binder")
    stack.visit("list", "binder")
    assert.equal(stack.peek(), undefined)
    for (const view of ["a", "b", "c", "d", "e"]) stack.visit("x", view)
    let count = 0
    while (stack.back("x")) count += 1
    assert.equal(count, 3)
  })

  it("goes forward after back, and a fresh visit clears forward", () => {
    const stack = new ViewBackStack<string>()
    stack.visit("binder", "list")
    stack.visit("list", "sets")
    assert.equal(stack.back("sets"), "list")
    stack.visit("sets", "list")
    assert.equal(stack.forward("list"), "sets")
    stack.visit("list", "sets") // the forward navigation itself
    assert.equal(stack.peek(), "list")
    assert.equal(stack.forward("sets"), undefined)
    assert.equal(stack.back("sets"), "list")
    stack.visit("sets", "list")
    stack.visit("list", "wanted") // new branch drops forward history
    assert.equal(stack.forward("wanted"), undefined)
    assert.equal(stack.back("wanted"), "list")
  })
})
