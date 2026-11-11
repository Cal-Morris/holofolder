import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createDeveloperKey} from '../../lib/server/developer-access/key-secret'
import {requireRestContext} from '../../lib/server/developer-access/principal'
import {createDeveloperImageResolver} from '../../lib/server/developer-images'
import {sanitizeDeveloperImages} from '../../lib/server/developer-image-fields'

async function main() {
process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.test'
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role'
process.env.VERCEL='1'
const key=createDeveloperKey(),actor=crypto.randomUUID()
let calls=0,errorCode:string|null=null,allowed=true,perpetual=true
let rpcError:Record<string,unknown>|null=null
const requests:URL[]=[]
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input:input.url)
 requests.push(url);calls++
 assert.equal(url.hostname,'synthetic.supabase.test','JSON serialization must never contact R2')
 if(url.pathname.endsWith('/rpc/authenticate_developer_request')) {
  const args=JSON.parse(String(init?.body))
  assert.equal(args.key_id,key.id)
  assert.equal(args.presented_digest,key.digest)
  assert.equal(args.presented_digest,createHash('sha256').update(key.key.split('.')[1]).digest('hex'))
  assert.equal(JSON.stringify(args).includes(key.key),false)
  assert.deepEqual(args.required_permissions,['catalog:read'])
  assert.equal(args.request_kind,'read')
  assert.match(args.preauth_bucket,/^preauth:[a-f0-9]{64}$/)
  if(rpcError)return Response.json(rpcError,{status:500})
  return Response.json(errorCode?{error:errorCode,retry_after:30}:{actor_id:actor,credential_id:key.id,permissions:['catalog:read'],owner_user_id:actor,member_ids:[actor],billing_access:{perpetual},budget:perpetual?{allowed,retry_after:20}:null})
 }
 if(url.pathname.endsWith('/card_image_inventory'))return Response.json([{object_key:'pokemon/tcg/cards/en/base1/1/high.webp'}])
 throw new Error('Unexpected request')
}
const request=new Request('https://synthetic.test/app/api/v1/languages',{headers:{authorization:`Bearer ${key.key}`,'x-vercel-forwarded-for':'192.0.2.1'}})
const context=await requireRestContext(request,['catalog:read'],'read','synthetic-request')
assert.equal(context.principal.actorId,actor);assert.equal(calls,1,'the shared authorization path takes one RPC')
for(const [code,status] of [['invalid_api_key',401],['insufficient_permissions',403],['rate_limited',429]] as const){errorCode=code;await assert.rejects(()=>requireRestContext(request,['catalog:read'],'read'),{status})}
errorCode=null;allowed=false;await assert.rejects(()=>requireRestContext(request,['catalog:read'],'read'),{status:429})
allowed=true;perpetual=false;await assert.rejects(()=>requireRestContext(request,['catalog:read'],'read'),{status:402})
rpcError={code:'XX000',message:'temporary failure'};await assert.rejects(()=>requireRestContext(request,['catalog:read'],'read'),/authorization unavailable/)
process.env.R2_ACCOUNT_ID='a'.repeat(32);process.env.R2_ACCESS_KEY_ID='synthetic';process.env.R2_SECRET_ACCESS_KEY='synthetic';process.env.R2_BUCKET='synthetic-cards';process.env.R2_PUBLIC_BASE_URL='https://assets.synthetic.test/'
const source='https://assets.tcgdex.net/en/base/base1/1/high.webp'
const rows=Array.from({length:100},()=>({image:source,details:{images:{large:source}}}))
const before=calls
const resolve=await createDeveloperImageResolver(rows)
const output=await sanitizeDeveloperImages(rows,resolve) as Array<{image:string}>
assert.equal(calls-before,1,'one inventory read for 100 cards and their nested image fields')
assert.equal(output.length,100);assert.equal(output[0].image,'https://assets.synthetic.test/pokemon/tcg/cards/en/base1/1/high.webp')
assert.equal(requests.at(-1)?.searchParams.get('bucket'),'eq.synthetic-cards')
console.log('passed')

}
main().catch(error=>{console.error(error);process.exitCode=1})
