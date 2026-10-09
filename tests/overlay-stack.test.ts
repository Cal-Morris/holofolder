import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { OverlayStack, shouldDismissSwipe, SWIPE_DISMISS_DISTANCE } from "../lib/overlay-stack"

describe("OverlayStack", () => {
  test("tracks the topmost overlay", () => {
    const stack = new OverlayStack()
    const first = stack.push(() => {})
    const second = stack.push(() => {})
    assert.equal(stack.isTop(second.id), true)
    assert.equal(stack.isTop(first.id), false)
    stack.remove(second.id)
    assert.equal(stack.isTop(first.id), true)
    assert.equal(stack.size, 1)
  })

  test("closeAll closes topmost first", () => {
    const stack = new OverlayStack()
    const order: string[] = []
    stack.push(() => order.push("bottom"))
    stack.push(() => order.push("top"))
    stack.closeAll()
    assert.deepEqual(order, ["top", "bottom"])
  })

  test("update swaps the close handler", () => {
    const stack = new OverlayStack()
    const calls: string[] = []
    const entry = stack.push(() => calls.push("old"))
    stack.update(entry.id, () => calls.push("new"))
    stack.top()?.close()
    assert.deepEqual(calls, ["new"])
  })
})

describe("shouldDismissSwipe", () => {
  test("dismisses on a long drag", () => {
    assert.equal(shouldDismissSwipe(SWIPE_DISMISS_DISTANCE, 2000), true)
  })
  test("dismisses on a short fast flick", () => {
    assert.equal(shouldDismissSwipe(40, 50), true)
  })
  test("ignores small, slow or upward drags", () => {
    assert.equal(shouldDismissSwipe(10, 5), false)
    assert.equal(shouldDismissSwipe(40, 1000), false)
    assert.equal(shouldDismissSwipe(-120, 50), false)
  })
})
