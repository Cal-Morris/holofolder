import assert from 'node:assert/strict'
async function main() {
 // The real SDK and HTTP adapter, with synthetic verified OAuth identity and SQL receipts.
 // @ts-expect-error Bun mocks are confined to this subprocess.
 const {mock}=await import('bun:test')
 mock.module('server-only',()=>({}))
 const {DeveloperAccessError}=await import('../../lib/developer-api/permissions')
 const principal={actorId:'04470000-0000-4000-8000-000000000001',credentialId:'synthetic-grant',transport:'mcp' as const,permissions:['collection:read','collection:write','binders:write']}
 let revoked=false
 mock.module('../../lib/server/developer-access/grants',()=>({authenticateMcpToken:async()=>{if(revoked)throw new DeveloperAccessError('oauth_revoked','Revoked',401);return principal}}))
 mock.module('../../lib/server/developer-access/entitlement',()=>({requireDeveloperEntitlement:async()=>({ownerUserId:principal.actorId,memberIds:[principal.actorId]})}))
 mock.module('../../lib/server/developer-access/limits',()=>({consumeDeveloperLimit:async()=>{},consumeDeveloperPreauth:async()=>{},developerPreauthBucket:()=>"synthetic"}))
 mock.module('../../lib/server/developer-access/audit',()=>({auditDeveloperOperation:()=>{}}))
 const {auditContextHeader}=await import('../../lib/server/audit-context')
 const calls:string[]=[]
 mock.module('../../lib/supabase/admin',()=>({createAdminClient:()=>({rpc(name:string,args:Record<string,unknown>){
   assert.equal(name,'collection_recovery_v1');assert.equal(args.owner_id,principal.actorId)
   const context=JSON.parse(auditContextHeader()!);assert.equal(context.source,'mcp');assert.equal(context.actor.userId,principal.actorId);assert.equal(context.clientId,'synthetic-grant')
   calls.push(String(args.operation))
   const data=args.operation==='preview' ? {planVersion:1,eventId:'12',supported:true,unsupported:[],conflicts:[],planToken:'a'.repeat(64),restoreUnassignedItemIds:[],changes:[],rootRevisionsAdvance:false} : {eventId:'13',recoveredEventId:'12'}
   return {abortSignal:async()=>({data,error:null})}
 }})}))
 const {handleMcpRequest}=await import('../../lib/server/mcp/http')
 const request=(method:string,params:unknown={},token='synthetic-oauth-token')=>handleMcpRequest(new Request('https://synthetic.test/app/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}))
 let response=await request('tools/list');assert.equal(response.status,200)
 const listing=await response.json(),tools=listing.result.tools as {name:string;annotations:Record<string,unknown>}[]
 for(const name of ['list_collection_audit','get_collection_audit','preview_collection_recovery','apply_collection_recovery'])assert.ok(tools.some(tool=>tool.name===name),name)
 assert.equal(tools.find(t=>t.name==='preview_collection_recovery')?.annotations.readOnlyHint,true)
 assert.equal(tools.find(t=>t.name==='apply_collection_recovery')?.annotations.destructiveHint,true)
 assert.equal(tools.find(t=>t.name==='apply_collection_recovery')?.annotations.idempotentHint,true)
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
 revoked=true;response=await request('tools/list');assert.equal(response.status,401);assert.match(response.headers.get('WWW-Authenticate')!,/resource_metadata/)
 response=await request('tools/list',{},'hf_synthetic-rest-key');assert.equal(response.status,401)
}
void main()
