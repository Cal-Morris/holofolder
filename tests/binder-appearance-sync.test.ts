import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { AppearanceConflict, normalizeRemoteAppearance, syncBinderAppearance } from "../lib/binder-appearance-sync"
import { defaultBinderDesign } from "../lib/binder-design"
import { getResolvedCollectionOwner } from "../lib/collection/refresh-policy"

const owner = "00000000-0000-4000-8000-0000000000e2"
describe("appearance sync", () => {
  test("account switches hide the old owner until the current partner owner resolves", () => {
    assert.equal(getResolvedCollectionOwner("user-a", "user-a", "owner-a"), "owner-a")
    assert.equal(getResolvedCollectionOwner("user-b", "user-a", "owner-a"), null)
    assert.equal(getResolvedCollectionOwner("user-b", null, "owner-a"), null)
    assert.equal(getResolvedCollectionOwner(null, "user-a", "owner-a"), null)
    assert.equal(getResolvedCollectionOwner("user-b", "user-b", "partner-owner"), "partner-owner")
  })
  test("rejects another owner and malformed revisions before installing a cache", () => {
    assert.throws(() => normalizeRemoteAppearance({ ownerId: "other", design: null, revision: 0 }, owner))
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: null, revision: 2 }, owner))
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: {}, revision: 0 }, owner))
    assert.throws(() => normalizeRemoteAppearance({ ownerId: owner, design: {}, revision: Infinity }, owner))
    assert.equal(normalizeRemoteAppearance({ ownerId: owner, design: null, revision: 0 }, owner).design, null)
  })
  test("a lost commit acknowledgement is reconciled without another write", async () => {
    const design = defaultBinderDesign()
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => { calls++; return Response.json({ ownerId: owner, design, revision: 2 }, { status: 409 }) }) as typeof fetch
    try {
      const result = await syncBinderAppearance(owner, { design, uploads: {}, pending: true, revision: 1 })
      assert.equal(result.revision, 2)
      assert.equal(calls, 1)
    } finally { globalThis.fetch = original }
  })
  test("a different newer appearance is kept rather than overwritten", async () => {
    const design = defaultBinderDesign(), newer = { ...design, name: "Other device" }
    const original = globalThis.fetch
    globalThis.fetch = (async () => Response.json({ ownerId: owner, design: newer, revision: 2 }, { status: 409 })) as typeof fetch
    try { await assert.rejects(syncBinderAppearance(owner, { design, uploads: {}, pending: true, revision: 1 }), AppearanceConflict) }
    finally { globalThis.fetch = original }
  })
})
