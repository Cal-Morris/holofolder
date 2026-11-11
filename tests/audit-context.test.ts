import { readAuditHeader } from "../lib/supabase/audit-header"
import { test } from "node:test"
import assert from "node:assert/strict"
import { auditContextHeader, withAuditActor, withAuditSystem, captureAuditOperations } from "../lib/server/audit-context"

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

