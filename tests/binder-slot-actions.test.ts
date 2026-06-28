import test from "node:test"
import assert from "node:assert/strict"
import { getBinderSlotQuickActions } from "../lib/binder-slot-actions"

test("getBinderSlotQuickActions exposes add and want actions for editable slots", () => {
  assert.deepEqual(getBinderSlotQuickActions({
    hasAssignedCard: false,
    readOnly: false,
  }), {
    addLabel: "Add",
    addAccessibleLabel: "Add card",
    wantLabel: "Want",
    wantAccessibleLabel: "Want card",
    canShowActions: true,
  })
})

test("getBinderSlotQuickActions labels assigned slots as editable and hides read-only actions", () => {
  assert.deepEqual(getBinderSlotQuickActions({
    hasAssignedCard: true,
    readOnly: false,
  }), {
    addLabel: "Edit",
    addAccessibleLabel: "Edit card",
    wantLabel: "Want",
    wantAccessibleLabel: "Want card",
    canShowActions: true,
  })

  assert.equal(getBinderSlotQuickActions({
    hasAssignedCard: true,
    readOnly: true,
  }).canShowActions, false)
})
