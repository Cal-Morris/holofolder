import assert from 'node:assert/strict'
import { stagedSmokeInputs, validateStagedSmokeInputs } from '../../scripts/api-smoke-staged'
import { assertSmokeHttpResponse, assertStagedSmokeResponse } from '../../scripts/api-smoke-assertions'
import { createDeveloperKey } from '../../lib/server/developer-access/key-secret'
import { DEVELOPER_PERMISSIONS, DeveloperAccessError } from '../../lib/developer-api/permissions'

async function main() {
 // Synthetic dependencies only. The registry, auth checks, transports, SDK, dispatcher and fixed admission are real.
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.test'
 process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role'
 process.env.VERCEL='0'
 // @ts-expect-error Bun module mocks are confined to this subprocess.
 const {mock}=await import('bun:test')
 mock.module('server-only',()=>({}))
 const key=createDeveloperKey(),actor='00830000-0000-4000-8000-000000000001'
 let revoked=false,executorCalls=0,restAuthCalls=0,mcpAuthCalls=0
 mock.module('../../lib/server/developer-access/grants',()=>({authenticateMcpToken:async(token:string)=>{
  mcpAuthCalls++
  if(revoked||token!=='synthetic-oauth')throw new DeveloperAccessError('oauth_revoked','Synthetic revoked token.',401)
  return {actorId:actor,credentialId:'synthetic-oauth',transport:'mcp',permissions:[...DEVELOPER_PERMISSIONS]}
 }}))
 globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url)
  assert.equal(url.hostname,'synthetic.supabase.test','no hosted network allowed')
  const body=JSON.parse(String(init?.body??'{}'))
  if(url.pathname.endsWith('/authenticate_developer_request')) {
   restAuthCalls++
   assert.equal(body.key_id,key.id);assert.equal(body.presented_digest,key.digest)
   return Response.json(revoked?{error:'invalid_api_key'}:{actor_id:actor,credential_id:key.id,owner_user_id:actor,member_ids:[actor],
    permissions:[...DEVELOPER_PERMISSIONS],billing_access:{perpetual:true},budget:{allowed:true}})
  }
  if(url.pathname.endsWith('/resolve_developer_access'))return Response.json({owner_user_id:actor,member_ids:[actor],billing_access:{perpetual:true},budget:{allowed:true}})
  // Any read/projection/catalog/executor request after authority fails this test too.
  executorCalls++
  throw new Error('Unexpected executor or data dependency '+url.pathname)
 }
 const {handleRestRequest}=await import('../../lib/server/developer-access/http')
 const {handleMcpRequest}=await import('../../lib/server/mcp/http')
 const inputs=stagedSmokeInputs('00830000-0000-4000-8000-000000000011','synthetic-http')
 for(const op of validateStagedSmokeInputs(inputs)) {
  const value=op.schema.parse(inputs[op.name]) as Record<string,unknown>
  async function rest(args:Record<string,unknown>) {
   const remaining={...args}
   const path=op.path.replace(/\{([^}]+)\}/g,(_match,key)=>{const value=remaining[key];delete remaining[key];return encodeURIComponent(String(value))})
   const url=new URL('https://synthetic.test/app/api/v1'+path)
   if(op.method==='GET')for(const [key,value] of Object.entries(remaining))url.searchParams.set(key,String(value))
   return handleRestRequest(new Request(url,{method:op.method,headers:{authorization:`Bearer ${key.key}`,'Content-Type':'application/json'},
    ...(op.method==='GET'?{}:{body:JSON.stringify(remaining)})}),{params:Promise.resolve({path:path.slice(1).split('/')})})
  }
  async function mcp(args:Record<string,unknown>) {
   return handleMcpRequest(new Request('https://synthetic.test/app/mcp',{method:'POST',headers:{authorization:'Bearer synthetic-oauth','Content-Type':'application/json',Accept:'application/json, text/event-stream'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:op.name,arguments:args}})}))
  }
  const response=await rest(value),body=await response.json()
  assertSmokeHttpResponse(op.name,response.status,body,value,503,'native-staged')
  assert.equal(body.error.requestId,response.headers.get('x-request-id'))
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  const sdk=await mcp(value),rpc=await sdk.json()
  assert.equal(sdk.status,200);assert.equal(rpc.result.isError,true)
  assertStagedSmokeResponse(op.name,rpc.result.structuredContent)
  assert.deepEqual(JSON.parse(rpc.result.content[0].text),rpc.result.structuredContent)
  assert.equal(rpc.result.structuredContent.error.requestId,sdk.headers.get('x-request-id'))
  const invalid=await rest({...value,forgedOwner:actor})
  assert.equal(invalid.status,400)
  assert.throws(()=>assertSmokeHttpResponse(op.name,invalid.status,{},value,503,'native-staged'))
  const invalidSdk=await (await mcp({...value,forgedOwner:actor})).json()
  assert.throws(()=>assertStagedSmokeResponse(op.name,invalidSdk.result?.structuredContent))
  revoked=true
  const unauthorized=await rest(value)
  assert.equal(unauthorized.status,401)
  assert.equal((await mcp(value)).status,401)
  revoked=false
 }
 assert.ok(restAuthCalls>=45);assert.ok(mcpAuthCalls>=30)
 assert.equal(executorCalls,0,'all 15 native attempts and invalid/unauthorized variants must stop before every executor/data RPC')
}
main().catch(error=>{console.error(error);process.exitCode=1})
