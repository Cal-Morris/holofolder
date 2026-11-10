import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rawRestoreFixture } from './fixtures/raw-restore'
import { planRawContentRestore } from '@/lib/raw-restore-plan'
import { parseRawRestoreCommand, isRawRestoreRejection } from '@/lib/domain/raw-restore'
import { isRawRestoreReceipt } from '@/lib/collection/raw-restore-delivery'
import { RAW_RESTORE_V2_LIMITS } from '@/lib/domain/raw-restore'
import { rawRestoreV2GraphBytes } from '@/lib/raw-restore-envelope'
import { rawRestoreSchema } from '@/lib/developer-api/storage'

async function convertedFixture(reordered=false) {
 const f=await rawRestoreFixture()
 const file=JSON.parse(f.input.text)
 for(const s of f.snapshot.binders[0].slots){
  const item=f.snapshot.items.find(i=>i.id===s.inventoryItemId)!
  const source={id:item.id,binder_id:s.collectionId,pokemon_id:1,synthetic:true}
  item.legacySource=source;s.legacySource={legacyRowId:item.id,sourceRow:source}
  file.binders[0].slots.find((v:{id:string})=>v.id===s.id).legacySource=s.legacySource
  const original=file.items.find((i:{id:string})=>i.id===item.id)
  if(original)original.legacySource=source
 }
 if(reordered)file.binders[0].slots.reverse()
 f.input.current=await f.brand(f.snapshot);f.input.text=JSON.stringify(file)
 return f
}
for(const reordered of [false,true])test(`v4 preserves exact sources and stable IDs with ${reordered?'changed':'unchanged'} order`,async()=>{
 const f=await convertedFixture(reordered),r=planRawContentRestore(f.input).request
 assert.equal(r.version,4);if(r.version!==4)throw new Error('fixture')
 assert.deepEqual(parseRawRestoreCommand(r),r);assert.equal(rawRestoreSchema.safeParse(r).success,true)
 assert.deepEqual(r.items.map(i=>i.itemId),['copy-a','copy-b'])
 assert.equal(r.slots.some(p=>'legacySource' in p.after),false)
 const receipt={version:4 as const,changed:true as const,inventoryRevision:r.inventoryRevision+1,collectionId:r.collection.collectionId,
  collectionVersion:r.collection.version+1,layoutRevision:r.collection.layoutRevision+(reordered?1:0),slotOrder:r.slotOrder,
  slotIds:r.slotOrder.after,releasedItemIds:r.releaseItemIds}
 assert.equal(isRawRestoreReceipt(receipt,r),true)
 assert.equal(isRawRestoreReceipt({...receipt,version:3},r),false)
 assert.equal(isRawRestoreReceipt({...receipt,layoutRevision:receipt.layoutRevision+1},r),false)
 assert.equal(isRawRestoreRejection({version:4,outcome:'rejected',operationId:r.operationId,code:'raw_restore_content_conflict',inventoryRevision:r.inventoryRevision},r.operationId,4),true)
 assert.ok(rawRestoreV2GraphBytes(f.snapshot,f.snapshot.binders[0])<RAW_RESTORE_V2_LIMITS.graphBytes)
})
test('converted review refuses changed/omitted slot or item source, foreign origin, grades and metadata',async()=>{
 for(const mutation of ['slot','missing-slot','item','missing-item','grade','metadata','foreign-origin']){
  const f=await convertedFixture(),file=JSON.parse(f.input.text)
  if(mutation==='slot')file.binders[0].slots[0].legacySource.sourceRow.synthetic=false
  if(mutation==='missing-slot')delete file.binders[0].slots[0].legacySource
  if(mutation==='item')file.items[0].legacySource.synthetic=false
  if(mutation==='missing-item')delete file.items[0].legacySource
  if(mutation==='grade')file.items[0].grading={provider:{kind:'known',id:'psa'},grade:'10',scale:null,designation:null,subgrades:[],certificate:null,holder:null,label:{variant:null,assetIds:[]}}
  if(mutation==='metadata')file.items[0].acquiredAt='2020-01-01'
  if(mutation==='foreign-origin'){
   f.snapshot.items[0].legacySource={synthetic:'other-origin'}
   f.input.current=await f.brand(f.snapshot);file.items[0].legacySource=f.snapshot.items[0].legacySource
  }
  assert.throws(()=>planRawContentRestore({...f.input,text:JSON.stringify(file)}),Error,mutation)
 }
})
