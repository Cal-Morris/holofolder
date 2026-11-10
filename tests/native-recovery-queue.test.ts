import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryStore } from '@/lib/offline-store/kv'
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue'
import { readCompleteInventorySnapshot } from '@/lib/collection/slot-snapshot'
import { parseNativeRecoveryRequest } from '@/lib/domain/native-recovery'
import type { NativeRecoveryIntent } from '@/lib/collection/native-recovery-intent'

// Synthetic scope and empty complete reads; no SQL or hosted correctness claim.
const scope = {deviceId:'synthetic-device',workspaceId:'holofolder',accountId:'synthetic-actor',ownerUserId:'synthetic-owner'}
const intent: NativeRecoveryIntent = {operation:'recovery.apply',request:{eventId:'101',restoreUnassignedItemIds:[],planVersion:1,planToken:'a'.repeat(64),operationId:'synthetic-recovery',confirmed:true},context:{source:'app',clientId:scope.deviceId,clientOccurredAt:'2026-01-01T00:00:00Z'}}
const receipt = {inventoryRevision:2,eventId:'201',recoveredEventId:'101'}
async function complete(revision=2) {
  const page = async () => ({inventoryRevision:revision,total:0,rows:[],next:null})
  return readCompleteInventorySnapshot(scope.ownerUserId,revision,{items:page,placements:page,collections:page,binders:page})
}
test('canonical parser rejects version mixing, private evidence, duplicate choices and implicit replacement',()=>{
  for(const request of [{...intent.request,recovery_state:{}},{...intent.request,planVersion:2},{...intent.request,restoreUnassignedItemIds:['a','a']},{...intent.request,confirmed:false}]) assert.throws(()=>parseNativeRecoveryRequest('recovery.apply',request))
  assert.throws(()=>parseNativeRecoveryRequest('recovery.preview.v2',{eventId:'101',planVersion:2,restoreUnassignedItemIds:[],replacementDefaultCollectionId:null,inventoryRevision:1,collections:[]}))
})
test('unknown outcomes persist through reload, original recipient, context and immutable request; no optimistic state',async()=>{
  const store=createMemoryStore(), q=createSlotOfflineQueue(store,scope)
  await q.saveSnapshot(await complete(1));await q.retainRecovery(intent,()=>scope)
  for(const reason of ['timeout','409','403','expiry']) {
    await assert.rejects(q.replayRecovery('synthetic-recovery',async original=>{assert.deepEqual(original,intent);throw new Error(reason)},()=>complete(),()=>scope))
    const r=await createSlotOfflineQueue(store,scope).read()
    assert.deepEqual(r.recovery![0].intent,intent);assert.equal(r.recovery![0].synchronized,false);assert.equal(r.optimistic!.inventoryRevision,1)
  }
  await assert.rejects(q.retainRecovery({...intent,request:{...intent.request,planToken:'b'.repeat(64)}},()=>scope),/idempotency/)
  await assert.rejects(q.retainRecovery({...intent,request:{...intent.request,operationId:'another-request'}},()=>scope),/reconciliation/)
})
test('accepted historical receipt requires a separate post-reply complete read and current scope',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.saveSnapshot(await complete(1));await q.retainRecovery(intent,()=>scope)
  const stale=await complete(2)
  await assert.rejects(q.replayRecovery('synthetic-recovery',async()=>receipt,async()=>stale,()=>scope),/fresh-complete/)
  let record=await q.read();assert.equal(record.recovery![0].receipt!.eventId,'201');assert.equal(record.recovery![0].synchronized,false)
  // Reload then resume read without repeating apply. Newer current state wins over historical receipt.
  const reloaded=createSlotOfflineQueue(store,scope)
  await reloaded.replayRecovery('synthetic-recovery',async()=>{throw new Error('must not resend accepted receipt')},()=>complete(9),()=>scope)
  record=await reloaded.read();assert.equal(record.recovery![0].synchronized,true);assert.equal(record.snapshot!.inventoryRevision,9);assert.deepEqual(record.recovery![0].intent,intent)
})
test('scope change after send retains original lease and never reads or ACKs; foreign account cannot replay',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.retainRecovery(intent,()=>scope)
  let active: typeof scope|null=scope,reads=0
  await q.replayRecovery('synthetic-recovery',async()=>{active=null;return receipt},async()=>{reads++;return complete()},()=>active)
  assert.equal(reads,0);assert.equal((await q.read()).recovery![0].synchronized,false)
  await createSlotOfflineQueue(store,{...scope,accountId:'other-account'}).replayRecovery('synthetic-recovery',async()=>{throw new Error('cross-account-send')},()=>complete(),()=>({...scope,accountId:'other-account'}))
  assert.equal((await q.read()).recovery!.length,1)
})
test('failed IDB commit never accepts confirmation, partial read and older revision never synchronize',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await assert.rejects(createSlotOfflineQueue({...store,update:async()=>{throw new Error('quota')}},scope).retainRecovery(intent,()=>scope),/quota/)
  assert.equal((await q.read()).recovery,undefined)
  await q.saveSnapshot(await complete(5));await q.retainRecovery(intent,()=>scope)
  await assert.rejects(q.replayRecovery('synthetic-recovery',async()=>receipt,()=>complete(2),()=>scope),/stale-recovery/)
  assert.equal((await q.read()).recovery![0].synchronized,false)
})
test('concurrent retries lease one original request, torn-down lease can retry after expiry',async()=>{
  const q=createSlotOfflineQueue(createMemoryStore(),scope)
  await q.retainRecovery(intent,()=>scope)
  let release!:()=>void,started!:()=>void,sends=0
  const barrier=new Promise<void>(yes=>{release=yes}),sent=new Promise<void>(yes=>{started=yes})
  const first=q.replayRecovery('synthetic-recovery',async()=>{sends++;started();await barrier;return receipt},()=>complete(),()=>scope,100)
  await sent
  await q.replayRecovery('synthetic-recovery',async()=>{sends++;return receipt},()=>complete(),()=>scope,101)
  assert.equal(sends,1);release();await first
  assert.equal((await q.read()).recovery![0].synchronized,true)
})
const proof={outcome:'rejected' as const,operationId:'synthetic-recovery',code:'recovery_plan_conflict' as const,inventoryRevision:2}
test('terminal proof survives failed fresh read/reload and needs explicit fresh discard; never acceptance',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.saveSnapshot(await complete(1));await q.retainRecovery(intent,()=>scope)
  await assert.rejects(q.replayRecovery(proof.operationId,async()=>proof,async()=>{throw new Error('read-failed')},()=>scope),/read-failed/)
  assert.deepEqual((await q.read()).recovery![0].rejection,proof)
  const reload=createSlotOfflineQueue(store,scope)
  await reload.replayRecovery(proof.operationId,async()=>{throw new Error('never resend terminal')},()=>complete(4),()=>scope)
  assert.equal((await reload.read()).recovery![0].synchronized,false)
  await assert.rejects(reload.retainRecovery({...intent,request:{...intent.request,operationId:'new-preview-request'}},()=>scope),/reconciliation/)
  const stale=await complete(4)
  await assert.rejects(reload.discardRecovery(proof.operationId,async()=>stale,()=>scope),/fresh-complete/)
  await reload.discardRecovery(proof.operationId,()=>complete(5),()=>scope)
  const r=(await reload.read()).recovery![0]
  assert.equal(r.resolution,'discarded');assert.equal(r.synchronized,false);assert.equal(r.receipt,null)
  assert.deepEqual(r.intent,intent);assert.deepEqual(r.rejection,proof)
  await reload.retainRecovery({...intent,request:{...intent.request,operationId:'new-preview-request',planToken:'b'.repeat(64)}},()=>scope)
  assert.equal((await reload.read()).recovery!.length,2)
})
test('unknown/accepted outcomes, forged proofs and IDB abort cannot enable discard',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.retainRecovery(intent,()=>scope)
  await assert.rejects(q.discardRecovery(proof.operationId,()=>complete(),()=>scope),/proof-required/)
  for(const bad of [{...proof,operationId:'other-id'},{...proof,code:'40001'},{...proof,evidence:{}},{...proof,inventoryRevision:-1}]) {
    await assert.rejects(q.replayRecovery(proof.operationId,async()=>bad,()=>complete(),()=>scope))
    assert.equal((await q.read()).recovery![0].rejection,undefined)
  }
  await q.replayRecovery(proof.operationId,async()=>proof,()=>complete(),()=>scope)
  const abort=createSlotOfflineQueue({...store,update:async()=>{throw new Error('idb-abort')}},scope)
  await assert.rejects(abort.discardRecovery(proof.operationId,()=>complete(),()=>scope),/idb-abort/)
  assert.equal((await q.read()).recovery![0].resolution,undefined)
})
test('terminal discard fences concurrent tabs and scope teardown while reading',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.retainRecovery(intent,()=>scope);await q.replayRecovery(proof.operationId,async()=>proof,()=>complete(),()=>scope)
  let active:typeof scope|null=scope, release!:()=>void,started!:()=>void
  const barrier=new Promise<void>(yes=>release=yes),sending=new Promise<void>(yes=>started=yes)
  const first=q.discardRecovery(proof.operationId,async()=>{started();await barrier;return complete()},()=>active,100)
  await sending
  await assert.rejects(q.discardRecovery(proof.operationId,()=>complete(),()=>scope,101),/proof-required/)
  active=null;release();await assert.rejects(first,/fresh-complete/)
  const retained=(await q.read()).recovery![0]
  assert.deepEqual(retained.rejection,proof);assert.equal(retained.resolution,undefined);assert.ok(retained.lease)
})
test('aborted proof commit retains unknown original for exact retry; accepted receipt cannot be discarded',async()=>{
  const store=createMemoryStore(),q=createSlotOfflineQueue(store,scope)
  await q.retainRecovery(intent,()=>scope)
  let writes=0
  const failing=createSlotOfflineQueue({...store,update:async(key,change)=>{if(++writes===2)throw new Error('proof-idb-abort');return store.update(key,change)}},scope)
  await assert.rejects(failing.replayRecovery(proof.operationId,async original=>{assert.deepEqual(original,intent);return proof},()=>complete(),()=>scope),/proof-idb-abort/)
  assert.equal((await q.read()).recovery![0].rejection,undefined)
  await assert.rejects(q.discardRecovery(proof.operationId,()=>complete(),()=>scope),/proof-required/)
  await q.replayRecovery(proof.operationId,async original=>{assert.deepEqual(original,intent);return receipt},()=>complete(),()=>scope)
  await assert.rejects(q.discardRecovery(proof.operationId,()=>complete(),()=>scope),/proof-required/)
  assert.equal((await q.read()).recovery![0].synchronized,true)
})
