import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sendNativeRecovery} from '@/lib/collection/native-recovery-browser'
const scope={actorUserId:'actor',ownerUserId:'owner',authSessionId:'auth-session',sessionId:'membership-epoch'}
const preview={planVersion:1,eventId:'101',supported:true,unsupported:[],conflicts:[],planToken:'a'.repeat(64),restoreUnassignedItemIds:[],changes:[],rootRevisionsAdvance:true}
const request={eventId:'101',restoreUnassignedItemIds:[]}
test('native browser preview rejects malformed evidence, conflicted tokens and scope races',async()=>{
  const fetchOriginal=globalThis.fetch, nav=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}})
  try {
    for(const bad of [{...preview,changes:undefined},{...preview,rootRevisionsAdvance:false},{...preview,conflicts:[{reason:'occupied'}]},{...preview,eventId:'102'},{...preview,certificate:'synthetic-private'}]) {
      globalThis.fetch=async()=>Response.json({version:1,operation:'recovery.preview',preview:bad},{headers:{'Cache-Control':'private, no-store'}})
      await assert.rejects(sendNativeRecovery('recovery.preview',request,()=>scope,true))
    }
    let current:typeof scope|null=scope
    globalThis.fetch=async()=>{current=null;return Response.json({version:1,operation:'recovery.preview',preview},{headers:{'Cache-Control':'private, no-store'}})}
    await assert.rejects(sendNativeRecovery('recovery.preview',request,()=>current,true),/access changed/)
    globalThis.fetch=async()=>Response.json({version:1,operation:'recovery.apply',operationId:'different-operation',receipt:{eventId:'201',recoveredEventId:'101',inventoryRevision:2}},{headers:{'Cache-Control':'private, no-store'}})
    await assert.rejects(sendNativeRecovery('recovery.apply',{...request,planVersion:1,planToken:preview.planToken,confirmed:true,operationId:'original-operation'},()=>scope,true),/identity changed/)
  } finally {
    globalThis.fetch=fetchOriginal
    if(nav)Object.defineProperty(globalThis,'navigator',nav);else Reflect.deleteProperty(globalThis,'navigator')
  }
})
