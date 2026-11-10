import { readAuditHeader } from "../lib/supabase/audit-header"
import { test } from "node:test"
import assert from "node:assert/strict"
import { auditContextHeader, withAuditActor, withAuditSystem, captureAuditOperations, withAuditOperation, withLegacyQueueAudit } from "../lib/server/audit-context"

test("trusted server attribution survives async work without crossing requests; database transactions have unique IDs", async () => {
  assert.equal(auditContextHeader(),undefined)
  const [first,second]=await Promise.all([withAuditActor("synthetic-partner",async()=>{
    await Promise.resolve()
    assert.equal(readAuditHeader() !== undefined,true)
    const a=JSON.parse(auditContextHeader()!),b=JSON.parse(auditContextHeader()!)
    assert.notEqual(a.operationId,b.operationId);assert.equal(a.batchId,b.batchId)
    return a
  },{principal:{actorId:"synthetic-partner",transport:"mcp",credentialId:"synthetic-grant",permissions:[]},ownerUserId:"synthetic-owner",memberIds:[],requestId:"synthetic-request"}),
  withAuditActor("other-actor",async()=>{await Promise.resolve();return JSON.parse(auditContextHeader()!)})])
  assert.deepEqual(first.actor,{kind:"user",userId:"synthetic-partner"});assert.equal(first.source,"mcp");assert.equal(first.clientId,"synthetic-grant")
  assert.equal(second.actor.userId,"other-actor");assert.equal(second.source,"app");assert.equal(second.clientId,null)
  assert.equal(auditContextHeader(),undefined)
})

test("explicit service job context is isolated; unwrapped work stays Unknown",()=>{
 const context=withAuditSystem("synthetic-job",()=>JSON.parse(auditContextHeader()!))
 assert.deepEqual(context.actor,{kind:"system",job:"synthetic-job"});assert.equal(context.source,"system")
 assert.equal(auditContextHeader(),undefined)
 assert.throws(()=>withAuditSystem("untrusted job with spaces",()=>undefined))
})
test('capturing committed edit identifiers preserves distinct transaction operation IDs',()=>{
 const operations=new Set<string>()
 withAuditActor('synthetic-actor',()=>captureAuditOperations(operations,()=>{
   const first=JSON.parse(auditContextHeader()!).operationId
   const second=JSON.parse(auditContextHeader()!).operationId
   assert.notEqual(first,second)
   assert.deepEqual([...operations],[first,second])
 }))
 assert.equal(auditContextHeader(),undefined)
})

test("first-party queue scope preserves operation capture and cannot bleed into app, REST, MCP or system contexts", async () => {
  assert.throws(() => withLegacyQueueAudit(() => undefined))
  withAuditSystem("synthetic-job", () => assert.throws(() => withLegacyQueueAudit(() => undefined)))
  const ids = new Set<string>()
  await withAuditActor("synthetic-actor", () => captureAuditOperations(ids, async () => {
    const batch = JSON.parse(auditContextHeader()!).batchId
    const [tagged, ordinary] = await Promise.all([
      withLegacyQueueAudit(async () => { await Promise.resolve(); return JSON.parse(auditContextHeader()!) }),
      Promise.resolve().then(() => JSON.parse(auditContextHeader()!)),
    ])
    assert.equal(tagged.legacyQueueGeneration, 2); assert.equal(tagged.purpose, "legacy.queue")
    assert.equal(tagged.batchId, batch); assert.ok(ids.has(tagged.operationId))
    assert.notEqual(tagged.operationId, ordinary.operationId)
    assert.equal(Object.hasOwn(ordinary, "purpose"), false)
    withLegacyQueueAudit(() => withAuditOperation("synthetic-operation", () => {
      const context = JSON.parse(auditContextHeader()!)
      assert.equal(context.operationId, "synthetic-operation"); assert.equal(context.batchId, "synthetic-operation")
      assert.equal(context.legacyQueueGeneration, 2); assert.ok(ids.has(context.operationId))
    }))
    for (const transport of ["rest", "mcp"] as const) {
      withLegacyQueueAudit(() => withAuditActor("synthetic-actor", () => {
        const context = JSON.parse(auditContextHeader()!)
        assert.equal(context.source, transport); assert.equal(Object.hasOwn(context, "purpose"), false)
        assert.equal(Object.hasOwn(context, "legacyQueueGeneration"), false)
        assert.throws(() => withLegacyQueueAudit(() => undefined))
      }, { principal: { actorId: "synthetic-actor", transport, credentialId: "synthetic-key", permissions: [] }, ownerUserId: "synthetic-owner", memberIds: [], requestId: "synthetic-request" }))
    }
    assert.equal(Object.hasOwn(JSON.parse(auditContextHeader()!), "purpose"), false)
  }))
  assert.equal(auditContextHeader(), undefined)
})
