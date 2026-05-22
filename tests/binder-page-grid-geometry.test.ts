import test from "node:test"
import assert from "node:assert/strict"
import { getBinderSlotBoundaryOffsets } from "../lib/binder-page-scan"

test("getBinderSlotBoundaryOffsets returns ordered start and end offsets for each slot", () => {
  const offsets = getBinderSlotBoundaryOffsets(400, 4, 0.05)

  assert.equal(offsets.length, 8)
  assert.deepEqual(offsets.map(Math.round), [0, 95, 102, 197, 203, 298, 305, 400])
})

test("getBinderSlotBoundaryOffsets keeps a single slot as the full span", () => {
  assert.deepEqual(getBinderSlotBoundaryOffsets(250, 1, 0.05), [0, 250])
})
