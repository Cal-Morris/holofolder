import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recoveryApplySchema, recoveryPreviewSchema, recoveryExplanation } from '../lib/domain/activity-recovery'
test('recovery accepts only exact reviewed confirmed intents and string event IDs',()=>{
  assert.equal(recoveryPreviewSchema.safeParse({eventId:'9223372036854775808'}).success,false)
  assert.equal(recoveryPreviewSchema.safeParse({eventId:12}).success,false)
  assert.deepEqual(recoveryPreviewSchema.parse({eventId:'12'}),{eventId:'12',restoreUnassignedItemIds:[]})
  const request={eventId:'12',operationId:'synthetic-retry',planVersion:1,planToken:'a'.repeat(64),confirmed:true}
  assert.equal(recoveryApplySchema.safeParse(request).success,true)
  assert.equal(recoveryApplySchema.safeParse({...request,confirmed:false}).success,false)
  assert.equal(recoveryApplySchema.safeParse({...request,ownerId:'foreign'}).success,false)
  assert.equal(recoveryApplySchema.safeParse({...request,planToken:'wrong'}).success,false)
  assert.match(recoveryExplanation('card_changed'),/newer edit/)
})

test('short Undo retries the exact durable request after an unknown outcome',async()=>{
 const {undoCommittedActivity}=await import('../lib/undo-committed-activity')
 const originalFetch=globalThis.fetch,descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
 const values=new Map<string,string>(),applied:unknown[]=[]
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)}}
 Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true})
 let previews=0,refreshes=0
 globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{
   if(String(url).includes('scope=1'))return Response.json({scope:{accountId:'actor',ownerId:'owner',membershipKey:'synthetic'}})
   if(String(url).includes('preview')) {previews++;return Response.json({planToken:'a'.repeat(64),conflicts:[],unsupported:[]})}
   applied.push(JSON.parse(String(init?.body)))
   if(applied.length===1)throw new Error('Synthetic lost response')
   return Response.json({eventId:'2',recoveredEventId:'1'})
 }) as typeof fetch
 try {
   const undo=()=>undoCommittedActivity('1','actor','owner',()=>true,async()=>{refreshes++})
   await assert.rejects(undo(),/Synthetic lost response/)
   await undo()
   assert.equal(previews,1);assert.equal(refreshes,1);assert.deepEqual(applied[0],applied[1])
   assert.equal([...values.keys()].filter(k=>k.startsWith('holofolder_activity_undo_v1:')).length,0)
 } finally {
   globalThis.fetch=originalFetch
   if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage')
 }
})
