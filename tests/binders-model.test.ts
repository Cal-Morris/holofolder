import test from "node:test"
import assert from "node:assert/strict"
import {
  binderFromRow,
  bindersFromRows,
  isBinderId,
  normalizeBinderName,
  pickActiveBinder,
  type Binder,
} from "../lib/binders/model"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const C = "33333333-3333-4333-8333-333333333333"

const binder = (id: string, sortOrder: number, isDefault = false): Binder => ({
  id, ownerUserId: "owner", name: id.slice(0, 1), color: null, sortOrder, isDefault, rows: null, cols: null, createdAt: null, updatedAt: null,
})

test("binder rows are validated and sorted for the switcher", () => {
  assert.equal(binderFromRow({ id: "nope", owner_user_id: "owner" }), null)
  const rows = [
    { id: B, owner_user_id: "owner", name: "Trades", sort_order: 2, is_default: false },
    { id: A, owner_user_id: "owner", name: "  ", sort_order: 0, is_default: true, binder_rows: 3, binder_cols: 3 },
    { id: "bad" },
  ]
  const binders = bindersFromRows(rows)
  assert.deepEqual(binders.map((item) => item.id), [A, B])
  assert.equal(binders[0].name, "My binder")
  assert.equal(binders[0].rows, 3)
  assert.equal(binders[1].isDefault, false)
})

test("the active binder is the requested one, else the last opened, else the default", () => {
  const binders = [binder(A, 0, true), binder(B, 1), binder(C, 2)]
  assert.equal(pickActiveBinder(binders, B, C)?.id, B)
  assert.equal(pickActiveBinder(binders, "someone-elses", C)?.id, C)
  assert.equal(pickActiveBinder(binders, null, "gone")?.id, A)
  assert.equal(pickActiveBinder([binder(B, 1), binder(C, 2)], null, null)?.id, B)
  assert.equal(pickActiveBinder([], B, C), null)
})

test("binder names are trimmed and bounded", () => {
  assert.equal(normalizeBinderName("  Trade   binder "), "Trade binder")
  assert.equal(normalizeBinderName(""), null)
  assert.equal(normalizeBinderName("x".repeat(41)), null)
  assert.equal(normalizeBinderName(42), null)
  assert.ok(isBinderId(A))
  assert.ok(!isBinderId("1; drop table"))
})
