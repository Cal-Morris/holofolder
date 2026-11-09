import { test } from "node:test"
import assert from "node:assert/strict"
import { parseStorageRequest, normalizeStorageResult, storageExecutionError } from "@/lib/server/operations/storage-contract"
import { withAuditActor, withAuditOperation, auditContextHeader } from "@/lib/server/audit-context"

const preview = { eventId: "1", restoreUnassignedItemIds: [] }
test("recovery requests contain intent only and apply requires a reviewed token and confirmation", () => {
  assert.deepEqual(parseStorageRequest("recovery.preview", preview), preview)
  for (const extra of [{ actor: "fake" }, { source: "app" }, { ownerId: "fake" }, { headers: {} }]) {
    assert.throws(() => parseStorageRequest("recovery.preview", { ...preview, ...extra }))
  }
  const apply = { ...preview, operationId: "synthetic-bridge-1", planVersion: 1, planToken: "a".repeat(64), confirmed: true }
  assert.deepEqual(parseStorageRequest("recovery.apply", apply), apply)
  for (const change of [{ confirmed: false }, { planToken: "bad" }, { eventId: "9223372036854775808" }, { restoreUnassignedItemIds: ["x", "x"] }]) {
    assert.throws(() => parseStorageRequest("recovery.apply", { ...apply, ...change }))
  }
})
test("receipts project safe fields and fail closed on unsafe revisions or unbounded responses", () => {
  assert.deepEqual(normalizeStorageResult("inventory", { inventoryRevision: 2, changed: true, selectedItemIds: ["copy-1"], acquiredItemIds: [], evidence: { certificate: "private" } }),
    { inventoryRevision: 2, changed: true, selectedItemIds: ["copy-1"], acquiredItemIds: [] })
  assert.throws(() => normalizeStorageResult("inventory", { inventoryRevision: "9007199254740992" }))
  assert.throws(() => normalizeStorageResult("slots", { inventoryRevision: 1, removedSlotIds: Array(20000).fill("x") }))
})
test("SQL errors never expose details, hints, SQL or private metadata", () => {
  for (const code of ["40001", "42501", "22023", "PGRST202", "XX000"]) {
    const result = storageExecutionError({ code, message: "private certificate SQL", details: "secret", hint: "credentials" })
    assert.ok(!JSON.stringify(result).includes("private"))
    assert.ok(!result.message.includes("certificate"))
  }
  assert.equal(storageExecutionError({ code: "40001" }).status, 409)
  assert.equal(storageExecutionError({ code: "P0001", message: "card_limit_reached" }).status, 402)
})
test("bound audit operation survives awaits and does not leak to another request", async () => {
  await withAuditActor("00000000-0000-4000-8000-000000000001", async () => {
    await withAuditOperation("synthetic-bridge-1", async () => {
      await Promise.resolve()
      const header = JSON.parse(auditContextHeader()!)
      assert.equal(header.operationId, "synthetic-bridge-1")
      assert.equal(header.batchId, "synthetic-bridge-1")
      assert.equal(header.source, "app")
    })
  })
  assert.equal(auditContextHeader(), undefined)
})

test("app and shared REST/MCP authentication, scopes, revocation and trusted service fetch", async () => {
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [new URL("./fixtures/storage-execution-auth.ts", import.meta.url).pathname], { stdio: "pipe" })
})
