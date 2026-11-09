import assert from 'node:assert/strict'
async function main() {
 // Synthetic identities and evidence only, module mocks stay in this subprocess.
 // @ts-expect-error Bun module mocks are confined to subprocesses.
 const {mock}=await import('bun:test')
 const account='04470000-0000-4000-8000-000000000001',owner='04470000-0000-4000-8000-000000000002'
 let oauth=false,signedIn=true,error:unknown=null,calls=0
 const session={auth:{getClaims:async()=>({data:{claims:signedIn ? {sub:account,...(oauth ? {client_id:'oauth'} : {})} : null}}),getUser:async()=>({data:{user:signedIn ? {id:account}:null}})},from(){const q={select(){return q},or(){return q},limit(){return q},maybeSingle:async()=>({data:{id:'membership',owner_user_id:owner,user1_id:account,user2_id:owner},error:null})};return q},rpc:async()=>({data:true,error:null})}
 mock.module('../../lib/supabase/server',()=>({createClient:async()=>session}))
 mock.module('server-only',()=>({}))
 const {auditContextHeader}=await import('../../lib/server/audit-context')
 const preview={eventId:'12',planVersion:1,supported:true,unsupported:[],conflicts:[],planToken:'a'.repeat(64),restoreUnassignedItemIds:[],changes:[{table:'pokemon_collection',id:'synthetic',before:null,after:{pokemon_name:'Bulbasaur',private_cert:'do-not-send'}}],rootRevisionsAdvance:false}
 mock.module('../../lib/supabase/admin',()=>({createAdminClient:()=>({rpc(name:string,args:Record<string,unknown>){calls++;assert.equal(name,'collection_recovery_v1');assert.equal(args.owner_id,owner);const ctx=JSON.parse(auditContextHeader()!);assert.equal(ctx.actor.userId,account);assert.equal(ctx.source,'app');if(args.operation==='apply')assert.equal(ctx.operationId,'synthetic-retry-0001');return {abortSignal:async()=>({data:args.operation==='preview' ? preview : {eventId:'13',recoveredEventId:'12',private_cert:'do-not-send'},error})}}})}))
 const {firstPartyRecovery}=await import('../../lib/server/operations/activity-recovery')
 const request=(operation='preview',input:unknown={eventId:'12'},headers:Record<string,string>={})=>firstPartyRecovery(new Request('https://synthetic.test/app/api/collection-activity/recovery?operation='+operation,{method:'POST',headers:{'Content-Type':'application/json','X-Binder-Owner':owner,...headers},body:JSON.stringify(input)}))
 let response=await request();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.ok(!JSON.stringify(await response.json()).includes('do-not-send'))
 const confirmed={eventId:'12',restoreUnassignedItemIds:[],planVersion:1,planToken:'a'.repeat(64),confirmed:true,operationId:'synthetic-retry-0001'}
 response=await request('apply',confirmed);assert.deepEqual(await response.json(),{eventId:'13',recoveredEventId:'12'})
 const before=calls
 response=await request('apply',{...confirmed,ownerId:account});assert.equal(response.status,400)
 response=await request('apply',{...confirmed,confirmed:false});assert.equal(response.status,400)
 response=await request('preview',{}, {'X-Binder-Owner':account});assert.equal(response.status,403)
 response=await request('preview',{}, {Origin:'https://evil.test'});assert.equal(response.status,403)
 oauth=true;response=await request();assert.equal(response.status,401);oauth=false
 signedIn=false;response=await request();assert.equal(response.status,401);signedIn=true
 assert.equal(calls,before)
 error={code:'40001',message:'private database details'};response=await request('apply',confirmed);assert.equal(response.status,409);assert.ok(!JSON.stringify(await response.json()).includes('private database details'))
}
void main()
