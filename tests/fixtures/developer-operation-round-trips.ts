import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import type {OperationContext} from '../../lib/developer-api/types'

async function main() {
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.test'
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role'
 // @ts-expect-error Bun module mocks are confined to this subprocess.
 const {mock}=await import('bun:test')
 mock.module('server-only',()=>({}))
 const actor='00000000-0000-4000-8000-000000000003',owner='00000000-0000-4000-8000-000000000001',binder='00000000-0000-4000-8000-000000000002'
 const calls:string[]=[]

 const row={id:binder,owner_user_id:owner,name:'Synthetic binder',is_default:true,sort_order:0,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',binder_rows:4,binder_cols:4,color:null}
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url)
  calls.push(url.pathname)
  assert.equal(url.hostname,'synthetic.supabase.test')
  const attribution=JSON.parse(new Headers(init?.headers).get('x-holo-audit-context')??'null')
  assert.equal(attribution?.actor?.userId,actor,'service writes/reads must receive the authenticated API actor, never the resolved owner by inference')
  assert.ok(['rest','mcp'].includes(attribution.source))
  assert.equal(attribution.clientId,createHash('sha256').update('synthetic').digest('hex'))
  assert.ok(!url.pathname.includes('/auth/'),'ID-only operations must reuse the authenticated actor')
  assert.ok(!url.pathname.endsWith('/partnerships'),'API operations must reuse the already verified owner')
  if(url.pathname.endsWith('/rpc/get_binder_slot_counts')) {
   assert.equal(JSON.parse(String(init?.body)).owner_id,owner)
   return Response.json([{binder_id:binder,slot_count:7}])
  }
  if(url.pathname.endsWith('/binders')) {
   const value=new Headers(init?.headers).get('accept')?.includes('object+json')?row:[row]
   return Response.json(value)
  }
  if(url.pathname.endsWith('/storage_collection_state')||url.pathname.endsWith('/inventory_owner_state')) {
   assert.equal(url.searchParams.get('owner_user_id'),'eq.'+owner)
   return Response.json([])
  }
  if(url.pathname.endsWith('/user_settings'))return Response.json([])
  if(url.pathname.endsWith('/collection_activity')||url.pathname.endsWith('/card_price_history'))return Response.json([])
  throw new Error('Unexpected dependency '+url.pathname)
 }
 let priceChecks=0
 mock.module('../../lib/server/card-price-checks',()=>({loadSavedCardPriceChecks:async()=>[],loadCardPriceChecks:async()=>{priceChecks++;return {ebay:null,soldcomps:null,errors:{}}}}))
 const {executeDeveloperOperation}=await import('../../lib/server/operations/developer-dispatch')
 const context:OperationContext={principal:{actorId:actor,credentialId:createHash('sha256').update('synthetic').digest('hex'),permissions:['binders:read','settings:read','collection:read'],transport:'rest'},ownerUserId:owner,memberIds:[owner,actor],requestId:'synthetic'}
 const listed=await executeDeveloperOperation(context,'list_binders',{}) as {binders:Array<{slotCount:number}>}
 assert.equal(listed.binders[0].slotCount,7)
 assert.equal(calls.length,2,'binder list and grouped slot counts require two parallel database calls')
 calls.length=0
 const settings=await executeDeveloperOperation(context,'get_settings',{binderId:binder}) as {fingerprint:string}
 assert.ok(settings.fingerprint)
 assert.equal(calls.length,2,'settings and the owner-scoped binder layout require two parallel reads')
 calls.length=0
 for(const name of ['list_collection','save_collection_item','delete_collection_item','get_set_slots','get_collection_analytics','get_legacy_pokemon_analytics','resolve_import']) {
  const before:number=calls.length
  await assert.rejects(executeDeveloperOperation(context,name,{}),{code:'not_found',status:404})
  assert.equal(calls.length,before,'retired operations cannot reach internal legacy handlers')
 }
 for(const transport of ['rest','mcp'] as const) {
  const ctx={...context,principal:{...context.principal,transport}}
  for(const [operation,input] of [['refresh_price_checks',{id:'base1-1',source:'soldcomps'}],['refresh_price_checks',{id:'base1-1'}],['start_comparison_job',{cards:[],confirmed:true}]] as const) {
   const previous:number=calls.length
   await assert.rejects(executeDeveloperOperation(ctx,operation,input),error=>{const value=error as {status:number;code:string};return value.status===403&&value.code==='ui_only'})
   assert.equal(calls.length,previous,'UI-only work must be denied before dependencies')
  }
  await executeDeveloperOperation(ctx,'get_price_checks',{id:'base1-1',source:'soldcomps'})
  await executeDeveloperOperation(ctx,'refresh_price_checks',{id:'base1-1',source:'ebay'})
 }
 assert.equal(priceChecks,4,'REST and MCP may read saved sold evidence and refresh only eBay')
 console.log('passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
