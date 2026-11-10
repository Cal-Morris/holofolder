import { test } from "node:test"
import assert from "node:assert/strict"
import { sendStorageCommand } from "@/lib/collection/storage-command-browser"
import type { InventoryReadScope } from "@/lib/collection/inventory-read-transport"
import type { SlotOfflineIntent } from "@/lib/collection/slot-optimistic"
const scope: InventoryReadScope = { actorUserId: "actor", ownerUserId: "owner", authSessionId: "auth-session", sessionId: "epoch" }
const intent: SlotOfflineIntent = { kind: "slots", request: { collectionId: "22222222-2222-4222-8222-222222222222", operationId: "original-operation", inventoryRevision: 1, collectionVersion: 1, layoutRevision: 1,
  commands: [{ kind: "create", ids: ["new-slot"], beforeSlotId: null }] }, context: { source: "app", clientId: null, operationId: "original-operation", batchId: "original-operation", clientOccurredAt: null } }
const receipt = { inventoryRevision: 2, changed: true, collectionVersion: 2, layoutRevision: 2, removedSlotIds: [] }
test("sender preserves exact request but never forwards queued authority or treats receipt as snapshot", async () => {
  const old = globalThis.fetch
  try {
    const requests: string[] = []
    globalThis.fetch = async (_url, init) => {
      requests.push(String(init?.body)); assert.deepEqual(JSON.parse(String(init?.body)), intent.request)
      const headers = new Headers(init?.headers)
      assert.equal(headers.get("X-Binder-Owner"), scope.ownerUserId)
      assert.equal(headers.get("X-Binder-Auth-Session"), scope.authSessionId)
      assert.equal(headers.has("x-holo-audit-context"), false)
      return Response.json({ version: 1, operationId: intent.request.operationId, receipt }, { headers: { "Cache-Control": "private, no-store" } })
    }
    const result = await sendStorageCommand(intent, () => scope, new AbortController().signal)
    assert.deepEqual(result, { status: 200, operationId: intent.request.operationId, inventoryRevision: 2 })
    await sendStorageCommand(intent, () => scope, new AbortController().signal)
    assert.equal(requests[0], requests[1]); assert.equal("snapshot" in result, false)
  } finally { globalThis.fetch = old }
})
test("mismatched/reordered replies, changed session, aborted fetch and malformed receipts stay unknown", async () => {
  const old = globalThis.fetch
  try {
    for (const body of [{ version: 1, operationId: "other-operation", receipt }, { version: 1, operationId: intent.request.operationId, receipt: { ...receipt, inventoryRevision: -1 } }, { snapshot: {} }]) {
      globalThis.fetch = async () => Response.json(body, { headers: { "Cache-Control": "private, no-store" } })
      assert.equal((await sendStorageCommand(intent, () => scope, new AbortController().signal)).status, 0)
    }
    let current = scope
    globalThis.fetch = async () => { current = { ...scope, sessionId: "new-epoch" }; return Response.json({ version: 1, operationId: intent.request.operationId, receipt }, { headers: { "Cache-Control": "private, no-store" } }) }
    assert.equal((await sendStorageCommand(intent, () => current, new AbortController().signal)).status, 0)
    globalThis.fetch = async () => { throw new Error("unknown outcome") }
    assert.equal((await sendStorageCommand(intent, () => scope, new AbortController().signal)).status, 0)
  } finally { globalThis.fetch = old }
})
test("billing, auth, permanent and conflict responses retain status without manufacturing current state", async () => {
  const old = globalThis.fetch
  try {
    for (const status of [400, 401, 402, 403, 404, 409, 413, 503]) {
      globalThis.fetch = async () => Response.json({ error: { code: "storage_conflict", message: "Synthetic", requestId: "synthetic" } }, { status })
      assert.deepEqual(await sendStorageCommand(intent, () => scope, new AbortController().signal), { status, code: "storage_conflict" })
    }
  } finally { globalThis.fetch = old }
})
test("only private, matching terminal ledger envelopes authorize rejection reconciliation", async () => {
  const old = globalThis.fetch
  const rejection = { outcome: "rejected", operationId: intent.request.operationId, code: "slot_revision_conflict", inventoryRevision: 2 }
  try {
    globalThis.fetch = async () => Response.json({ version: 1, operationId: intent.request.operationId, rejection }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
    assert.deepEqual(await sendStorageCommand(intent, () => scope, new AbortController().signal), { status: 409, operationId: intent.request.operationId, code: rejection.code, rejection })
    for (const bad of [{ ...rejection, operationId: "another-operation" }, { ...rejection, code: "idempotency_conflict" }, { ...rejection, inventoryRevision: -1 }, { ...rejection, certificate: "synthetic" }]) {
      globalThis.fetch = async () => Response.json({ version: 1, operationId: intent.request.operationId, rejection: bad }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
      assert.equal((await sendStorageCommand(intent, () => scope, new AbortController().signal)).rejection, undefined)
    }
    globalThis.fetch = async () => Response.json({ version: 1, operationId: intent.request.operationId, rejection }, { status: 409 })
    assert.equal((await sendStorageCommand(intent, () => scope, new AbortController().signal)).rejection, undefined)
  } finally { globalThis.fetch = old }
})
