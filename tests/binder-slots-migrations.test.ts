import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { legacySlotId } from "../lib/legacy-binder-transition"

describe("legacy binder transition", () => {
  test("stable species mapping preserves distinct binders and every implicit Dex target", () => {
    const ids = Array.from({ length: 1025 }, (_, i) => legacySlotId("binder-a", i + 1))
    assert.equal(new Set(ids).size, 1025)
    assert.equal(ids[0], "legacy-dex-v1/binder-a/1")
    assert.notEqual(ids[0], legacySlotId("binder-b", 1))
    assert.throws(() => legacySlotId("binder-a", 0))
    assert.throws(() => legacySlotId("binder-a", 1026))
  })
})
