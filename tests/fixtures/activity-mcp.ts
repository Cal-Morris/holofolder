import assert from 'node:assert/strict'
async function main() {
 // The real SDK and HTTP adapter, with synthetic verified OAuth identity and SQL receipts.
 // @ts-expect-error Bun mocks are confined to this subprocess.
 const {mock}=await import('bun:test')
 mock.module('server-only',()=>({}))
 const {DeveloperAccessError}=await import('../../lib/developer-api/permissions')
 const principal={actorId:'04470000-0000-4000-8000-000000000001',credentialId:'synthetic-grant',transport:'mcp' as const,permissions:['collection:read','collection:write','binders:write']}
 let revoked=false
 // Authentication is synthetic: one context per HTTP request, from the bearer credential's transport.
 mock.module('../../lib/server/developer-access/principal',()=>({
  requireRestContext:async(_request:Request,required:readonly string[])=>{const {requirePermissions}=await import('../../lib/developer-api/permissions');requirePermissions(principal.permissions as never,required as never);return {principal:{...principal,transport:'rest'},ownerUserId:principal.actorId,memberIds:[principal.actorId],requestId:'synthetic-rest'}},
  requireMcpContext:async()=>{if(revoked)throw new DeveloperAccessError('oauth_revoked','Revoked',401);return {principal:{...principal,permissions:[...principal.permissions]},ownerUserId:principal.actorId,memberIds:[principal.actorId],requestId:'synthetic-mcp'}},
 }))
 mock.module('../../lib/server/developer-access/grants',()=>({verifyMcpToken:async()=>({actorId:principal.actorId})}))
 mock.module('../../lib/server/developer-access/audit',()=>({auditDeveloperOperation:()=>{}}))
 const {auditContextHeader}=await import('../../lib/server/audit-context')
 const calls:string[]=[]
 let historyReads=0
 mock.module('../../lib/supabase/admin',()=>({createAdminClient:()=>({from(table:string){
   assert.equal(table,"collection_activity")
   const filters:Record<string,unknown>={}
   const query={select(columns:string){assert.ok(!columns.includes("recovery_state"));assert.ok(!columns.includes("command_evidence"));return query},eq(k:string,v:unknown){filters[k]=v;return query},order(){return query},limit(){return query},then(resolve:(v:unknown)=>void){historyReads++;assert.equal(filters.owner_user_id,principal.actorId);assert.equal(filters.operation_id,"synthetic-original-op");resolve({data:[{id:"12",operation_id:filters.operation_id}],error:null})}}
   return query
 },rpc(name:string,args:Record<string,unknown>){
   assert.equal(name,'collection_recovery_v1');assert.equal(args.owner_id,principal.actorId)
   const context=JSON.parse(auditContextHeader()!);assert.equal(context.source,'mcp');assert.equal(context.actor.userId,principal.actorId);assert.equal(context.clientId,'synthetic-grant')
   calls.push(String(args.operation))
   const data=args.operation==='preview' ? {planVersion:1,eventId:'12',supported:true,unsupported:[],conflicts:[],planToken:'a'.repeat(64),restoreUnassignedItemIds:[],changes:[],rootRevisionsAdvance:false} : {eventId:'13',recoveredEventId:'12'}
   return {abortSignal:async()=>({data,error:null})}
 }})}))
 const {handleRestRequest}=await import('../../lib/server/developer-access/http')
 const rest=(query:string)=>handleRestRequest(new Request('https://synthetic.test/app/api/v1/collection/audit'+query,{headers:{Authorization:'Bearer synthetic-rest-key'}}),{params:Promise.resolve({path:['collection','audit']})})
 let restResponse=await rest('?operationId=synthetic-original-op')
 assert.equal(restResponse.status,200);assert.equal((await restResponse.json()).data[0].operation_id,'synthetic-original-op')
 for(const query of ['?operationId=', '?operationId=one&operationId=two', '?operationId=synthetic-original-op&ownerId=unauthorized']) {restResponse=await rest(query);assert.equal(restResponse.status,400)}
 const {handleMcpRequest}=await import('../../lib/server/mcp/http')
 const request=(method:string,params:unknown={},token='synthetic-oauth-token')=>handleMcpRequest(new Request('https://synthetic.test/app/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}))
 let response=await request('tools/list');assert.equal(response.status,200)
 const listing=await response.json(),tools=listing.result.tools as {name:string;annotations:Record<string,unknown>;inputSchema:{properties:Record<string,unknown>}}[]
 for(const name of ['list_collection_audit','get_collection_audit','preview_collection_recovery','apply_collection_recovery'])assert.ok(tools.some(tool=>tool.name===name),name)
 for(const name of ['list_collection','save_collection_item','delete_collection_item','get_set_slots','get_collection_analytics','get_legacy_pokemon_analytics','resolve_import'])assert.ok(!tools.some(tool=>tool.name===name),name)
 for(const name of ['get_pokemon_set_slots'])assert.ok(tools.some(tool=>tool.name===name),name)
 const auditProperties=tools.find(t=>t.name==='list_collection_audit')!.inputSchema.properties
 assert.ok('inventoryItemId' in auditProperties);assert.ok(!('itemId' in auditProperties))
 assert.equal(tools.find(t=>t.name==='preview_collection_recovery')?.annotations.readOnlyHint,true)
 assert.equal(tools.find(t=>t.name==='apply_collection_recovery')?.annotations.destructiveHint,true)
 assert.equal(tools.find(t=>t.name==='apply_collection_recovery')?.annotations.idempotentHint,true)
 response=await request('tools/call',{name:'list_collection_audit',arguments:{operationId:'synthetic-original-op'}})
 const history=(await response.json()).result.structuredContent
 assert.equal(historyReads,2)
 assert.equal(history.data[0].operation_id,'synthetic-original-op')
 response=await request('tools/call',{name:'list_collection_audit',arguments:{itemId:'synthetic-copy'}})
 assert.equal((await response.json()).result.isError,true)
 assert.equal(historyReads,2,'old ambiguous filter is rejected before database access')
 response=await request('tools/call',{name:'list_collection_audit',arguments:{operationId:'',ownerId:'unauthorized'}})
 assert.equal((await response.json()).result.isError,true)
 assert.equal(historyReads,2)
 response=await request('tools/call',{name:'preview_collection_recovery',arguments:{eventId:'12'}})
 const preview=(await response.json()).result.structuredContent
 assert.equal(preview.rootRevisionsAdvance,false);assert.equal(preview.planToken,'a'.repeat(64))
 const args={eventId:'12',restoreUnassignedItemIds:[],planVersion:1,planToken:preview.planToken,operationId:'synthetic-mcp-retry-0001',confirmed:true}
 response=await request('tools/call',{name:'apply_collection_recovery',arguments:args})
 assert.deepEqual((await response.json()).result.structuredContent,{eventId:'13',recoveredEventId:'12'})
 assert.deepEqual(calls,['preview','apply'])
 principal.permissions=['collection:read']
 response=await request('tools/call',{name:'apply_collection_recovery',arguments:args})
 assert.equal((await response.json()).result.structuredContent.error.code,'insufficient_permissions');assert.equal(calls.length,2)
 principal.permissions=[]
 response=await request('tools/call',{name:'list_collection_audit',arguments:{operationId:'synthetic-original-op'}})
 assert.equal((await response.json()).result.structuredContent.error.code,'insufficient_permissions');assert.equal(historyReads,2)
 revoked=true;response=await request('tools/list');assert.equal(response.status,401);assert.match(response.headers.get('WWW-Authenticate')!,/resource_metadata/)
 response=await request('tools/list',{},'hf_synthetic-rest-key');assert.equal(response.status,401)
}
void main()
