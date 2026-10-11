import { test } from "node:test"
import assert from "node:assert/strict"
import { createBinderSwipeTracker, createBinderTapTracker } from "../lib/binder-pointer"

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

test("page swipes tolerate a natural diagonal without accepting vertical drags", () => {
  const swipe = createBinderSwipeTracker()
  const start = { pointerId: 1, clientX: 200, clientY: 100 }
  swipe.down(start, true)
  assert.equal(swipe.up({ ...start, clientX: 150, clientY: 138 }), 1)
  swipe.down(start, true)
  assert.equal(swipe.up({ ...start, clientX: 150, clientY: 145 }), null)
})


test("losing capture clears all touch contacts before a fresh tap or swipe", () => {
  const tap = createBinderTapTracker(), swipe = createBinderSwipeTracker()
  const first = { pointerId: 1, clientX: 100, clientY: 100 }, second = { ...first, pointerId: 2 }
  for (const event of [first, second]) { tap.down(event);swipe.down(event, true) }
  for (const event of [second, first]) { tap.cancel(event);swipe.cancel(event) }
  const next = { ...first, pointerId: 3 }
  tap.down(next)
  assert.equal(tap.up(next), true)
  swipe.down(next, true)
  assert.equal(swipe.up({ ...next, clientX: 50 }), 1)
})
