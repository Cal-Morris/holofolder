import { test } from "node:test"
import assert from "node:assert/strict"
import { createBinderSwipeTracker } from "../lib/binder-pointer"

test("horizontal single pointer swipes turn pages without treating pans or pinches as turns", () => {
  const swipe = createBinderSwipeTracker()
  const start = { pointerId: 1, clientX: 200, clientY: 100 }
  swipe.down(start, true)
  assert.equal(swipe.up({ ...start, clientX: 100 }), 1)
  swipe.down(start, true)
  assert.equal(swipe.up({ ...start, clientX: 270 }), -1)
  swipe.down(start, false)
  assert.equal(swipe.up({ ...start, clientX: 100 }), null)
  swipe.down(start, true)
  assert.equal(swipe.up({ ...start, clientX: 195, clientY: 200 }), null)
  swipe.down(start, true)
  swipe.down({ ...start, pointerId: 2 }, true)
  swipe.up({ ...start, pointerId: 2 })
  assert.equal(swipe.up({ ...start, clientX: 100 }), null)
  swipe.down(start, true)
  swipe.cancel(start)
  assert.equal(swipe.up({ ...start, clientX: 100 }), null)
})

test("swipes read native pointer fields from inherited getters", () => {
  const swipe = createBinderSwipeTracker()
  const event = Object.create({ get pointerId() { return 7 }, get clientX() { return 200 }, get clientY() { return 100 } })
  swipe.down(event, true)
  assert.equal(swipe.up({ pointerId: 7, clientX: 100, clientY: 100 }), 1)
})
