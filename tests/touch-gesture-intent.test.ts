import test from "node:test"
import assert from "node:assert/strict"
import { getTouchGestureIntent } from "../hooks/use-touch-gestures"

test("vertical movement does not count as binder swipe intent", () => {
  assert.deepEqual(getTouchGestureIntent(4, 36), {
    movedEnough: true,
    horizontalIntent: false,
  })
})

test("horizontal movement must clearly beat vertical movement before swiping", () => {
  assert.deepEqual(getTouchGestureIntent(26, 24), {
    movedEnough: true,
    horizontalIntent: false,
  })

  assert.deepEqual(getTouchGestureIntent(-48, 12), {
    movedEnough: true,
    horizontalIntent: true,
  })
})
