// Real HTTP checks against disposable, explicitly labelled accounts. Never uses a personal collection.
import { withAuditActor, withLegacyQueueAudit } from '../lib/server/audit-context'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {AwsClient} from 'aws4fetch'
import {getPrivateArtworkConfig} from '../lib/server/binder-artwork-r2'
import {getR2BucketEndpoint} from '../lib/card-image-r2'
import {API_SMOKE_ASSERTIONS,assertSmokeHttpResponse} from './api-smoke-assertions'
import {randomUUID} from 'node:crypto'
import {Client} from 'pg'
import {createAdminClient} from '../lib/supabase/admin'
import {createDeveloperKey} from '../lib/server/developer-access/key-secret'
import {DEVELOPER_OPERATIONS} from '../lib/developer-api/operations'
import {DEVELOPER_PERMISSIONS} from '../lib/developer-api/permissions'
import {defaultBinderDesign} from '../lib/binder-design'
import {apiSmokeExitCode,readServerTiming,summarizeApiPerformance,summarizeApiSmokeCoverage,type ApiPerformanceSample} from '../lib/developer-api/performance-checks'
import {loadProjectEnvFiles} from '../lib/load-project-env'

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]}

async function main() {
 if(!process.argv.includes('--isolated-fixtures'))throw new Error('Pass --isolated-fixtures to create and clean up disposable performance accounts.')
 for(const op of DEVELOPER_OPERATIONS)assert.equal(typeof API_SMOKE_ASSERTIONS[op.name],'function','Missing response assertion for '+op.name)
 await loadProjectEnvFiles()
 const base=arg('--base-url')??'https://app.holofolder.com/app/api/v1'
 const target=new URL(base)
 if(target.protocol!=='https:'&& !['localhost','127.0.0.1'].includes(target.hostname))throw new Error('Use HTTPS or a local test server')
 const output=arg('--output')??'/tmp/holofolder-api-smoke.json'
 const repeats=Number(arg('--repeats')??2)
 if(!Number.isSafeInteger(repeats)||repeats<0||repeats>5)throw new Error('Use between zero and five repeats')
 const runId=randomUUID(),label='perf-'+runId.slice(0,8),admin=createAdminClient()
 const databaseUrl=new URL(process.env.POSTGRES_URL_NON_POOLING??process.env.DATABASE_URL??'')
 databaseUrl.searchParams.delete('sslmode')
 const db=new Client({connectionString:databaseUrl.toString(),ssl:['localhost','127.0.0.1'].includes(databaseUrl.hostname)?undefined:{rejectUnauthorized:false},statement_timeout:15000,connectionTimeoutMillis:10000})
 await db.connect()
 const actors:Array<{id:string;key:string;email:string}>=[],samples:ApiPerformanceSample[]=[],failures:string[]=[]
 const cleanup:{users:boolean;accountIds:string[];artwork:string[]}={users:false,accountIds:[],artwork:[]}
 let activeJob:string|null=null
 const windows=new Map<string,{minute:number;requests:number}>()
 async function persist() {
  await writeFile(output,JSON.stringify({runId,base,measuredAt:new Date().toISOString(),samples,operations:summarizeApiPerformance(samples),coverage:summarizeApiSmokeCoverage(samples),failures,cleanup},null,2))
 }
 async function fixture() {
  const email=`${label}-${actors.length}@example.invalid`
  const {data,error}=await admin.auth.admin.createUser({email,email_confirm:true,app_metadata:{performance_fixture:runId},user_metadata:{display_name:'Synthetic performance fixture'}})
  if(error||!data.user)throw new Error('Could not create isolated performance account')
  const secret=createDeveloperKey(),actor={id:data.user.id,key:secret.key,email};actors.push(actor);cleanup.accountIds.push(actor.id);await persist()
  await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')",[actor.id])
  await db.query("INSERT INTO public.developer_api_keys(id,actor_id,name,secret_digest,permissions,expires_at) VALUES($1,$2,'Synthetic performance fixture',$3,$4,now()+interval '30 minutes')",[secret.id,actor.id,secret.digest,[...DEVELOPER_PERMISSIONS]])
  await persist()
  return actor
 }
 // Pacing stays outside measured time and preserves the production rate limits.
 async function pace(actorId:string,write:boolean):Promise<void> {
  const key=actorId+(write?':write':':read'),minute=Math.floor(Date.now()/60000)
  let window=windows.get(key)
  if(!window||window.minute!==minute){window={minute,requests:0};windows.set(key,window)}
  if(window.requests>=(write?18:58)) {
   console.log(JSON.stringify({event:'rate_budget_pause',kind:write?'write':'read'}))
   await new Promise(resolve=>setTimeout(resolve,Math.min(60000,60500-Date.now()%60000)))
   return pace(actorId,write)
  }
  window.requests++
 }
 async function call(name:string,input:Record<string,unknown>={},actor=actors[0],repeat=0,scenario='default',expectedStatus=200):Promise<Record<string,unknown>> {
  const operation=DEVELOPER_OPERATIONS.find(op=>op.name===name)
  if(!operation)throw new Error('Unknown performance operation: '+name)
  const parsed=operation.schema.parse(input) as Record<string,unknown>,remaining={...parsed}
  const path=operation.path.replace(/\{([^}]+)\}/g,(_match,key)=>{const value=remaining[key];delete remaining[key];return encodeURIComponent(String(value))})
  const url=new URL(base+path)
  if(operation.method==='GET')for(const [key,value] of Object.entries(remaining))if(value!==undefined)url.searchParams.set(key,String(value))
  await pace(actor.id,operation.write)
  const started=performance.now()
  const response=await fetch(url,{method:operation.method,headers:{Authorization:`Bearer ${actor.key}`,'Content-Type':'application/json'},...(operation.method==='GET'?{}:{body:JSON.stringify(remaining)}),signal:AbortSignal.timeout(60000)})
  const bytes=await response.arrayBuffer(),timing=response.headers.get('server-timing')
  const sample:ApiPerformanceSample={operation:name,phase:repeat?'repeat':'first',status:response.status,clientMs:Math.round(performance.now()-started),serverMs:readServerTiming(timing,'total'),authMs:readServerTiming(timing,'auth'),operationMs:readServerTiming(timing,'operation'),bytes:bytes.byteLength,scenario,expectedStatus}
  samples.push(sample)
  let result:Record<string,unknown>={}
  try {
   result=record(JSON.parse(new TextDecoder().decode(bytes)))
   assertSmokeHttpResponse(name,response.status,result,parsed,expectedStatus,scenario)
   sample.assertionsPassed=true
  } catch(error) {sample.assertionsPassed=false;throw error}
  finally {console.log(JSON.stringify(sample));await persist()}
  return result
 }
 async function read(name:string,input:Record<string,unknown>={},actor=actors[0]) {
  let result=await call(name,input,actor)
  for(let n=1;n<=repeats;n++)result=await call(name,input,actor,n)
  return result
 }
 const cards=[{cardId:'base1-1',language:'en'}],comparisonCards=[{cardId:'base1-1',finish:'holo'}]
 try {
  const owner=await fixture(),partner=await fixture()
  const defaultBinder=(await db.query('SELECT public.ensure_default_binder($1) id',[owner.id])).rows[0].id as string
  // Native execution needs its own reviewed fixture lifecycle; missing coverage fails the report.
  // Clearly synthetic owned data exercises nonempty collection lists and pagination.
  await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) SELECT $1,$2,n,'Synthetic performance slot '||n,'considering' FROM generate_series(1,1010) n",[owner.id,defaultBinder])
  await read('list_languages');await read('list_cards');await read('get_card',{id:'base1-1'})
  await read('list_sets');await read('get_set',{id:'base1'});await read('list_series');await read('get_series',{id:'base'})
  await read('list_pokemon');await read('get_pokemon',{id:'1'});await read('list_illustrators');await read('get_pokemon_set_slots',{id:'base1'})
  const listed=await read('list_binders')
  assert.equal(record((listed.binders as unknown[])[0]).slotCount,1010,'Grouped counts must include the entire collection')
  const created=await call('create_binder',{name:'Synthetic performance binder',idempotencyKey:runId})
  const binderId=String(created.createdBinderId)
  await call('update_binder',{id:binderId,name:'Synthetic renamed performance binder'})
  const binderRows=[...((listed.binders??[]) as Array<{id:string}>).map(b=>b.id),binderId]
  await call('reorder_binders',{order:binderRows.reverse()})
  const settings=await read('get_settings',{binderId:defaultBinder})
  const settingsInput={...record(settings.settings),binderId:defaultBinder,baseFingerprint:settings.fingerprint}
  const settingsSchema=DEVELOPER_OPERATIONS.find(op=>op.name==='update_settings')!.schema
  assert.ok('shape' in settingsSchema)
  await call('update_settings',Object.fromEntries(Object.keys(settingsSchema.shape).map(key=>[key,record(settingsInput)[key]])))
  // Seed a legacy recovery event through the retained internal CAS RPC. This is
  // disposable fixture setup, not restored public species-row dispatch.
  const previous = await admin.from('pokemon_collection').select('*').eq('user_id',owner.id).eq('binder_id',defaultBinder).eq('pokemon_id',1).single()
  assert.equal(previous.error,null);assert.ok(previous.data)
  const deletion = await withAuditActor(owner.id, () => withLegacyQueueAudit(async () => await admin.rpc('developer_delete_collection',
   {actor:owner.id,owner_id:owner.id,binder:defaultBinder,pokemon:1,expected:previous.data})))
  assert.equal(deletion.error,null);assert.equal(deletion.data?.deleted,true)
  const removed=await call('list_collection_audit',{collectionId:defaultBinder,pokemonId:1,limit:1})
  const removedEvent=record((removed.data as unknown[])[0])
  assert.equal(removedEvent.action,'collection_item','Recovery must target the fixture deletion')
  const preview=await call('preview_collection_recovery',{eventId:removedEvent.id,restoreUnassignedItemIds:[]})
  assert.equal(preview.supported,true);assert.deepEqual(preview.conflicts,[]);assert.equal(preview.rootRevisionsAdvance,false)
  assert.equal(typeof preview.planToken,'string','Fixture recovery must produce a usable reviewed plan')
  const undoInput={eventId:removedEvent.id,restoreUnassignedItemIds:[],planVersion:1,planToken:preview.planToken,operationId:randomUUID(),confirmed:true}
  const undo=await call('apply_collection_recovery',undoInput)
  assert.deepEqual(await call('apply_collection_recovery',undoInput,owner,0,'idempotent-replay'),undo)
  const linked=await call('list_collection_audit',{recoveryOfEventId:removedEvent.id})
  assert.equal(record((linked.data as unknown[])[0]).id,undo.eventId,'Undo must be linked from the original event')
  const restored=await call('get_collection_audit',{id:undo.eventId})
  assert.equal(restored.recovery_of_event_id,removedEvent.id)
  await read('get_identity');await call('update_identity',{username:label,displayName:'Synthetic performance fixture'})
  await read('get_binder_identity',{binderId})
  await call('update_binder_identity',{binderId,slug:label})
  await call('update_sharing',{binderId,enabled:true,showPrices:false})
  await read('get_sharing',{binderId})
  const appearance=await read('get_appearance')
  const design=defaultBinderDesign();design.name='Synthetic performance fixture'
  await call('update_appearance',{baseRevision:appearance.revision,design})
  await read('get_prices',{cards});await read('get_price_history',{id:'base1-1'})
  const history=await read('list_collection_audit',{})
  if(Array.isArray(history.data)&&history.data.length)await read('get_collection_audit',{id:record(history.data[0]).id})
  await read('check_deal',{cardId:'base1-1',language:'en',askingPrice:50,currency:'GBP'})
  await read('get_price_checks',{id:'base1-1',finish:'holo'})
  await read('inspect_comparison_job',{cards:comparisonCards})
  const deniedJob=await call('start_comparison_job',{cards:comparisonCards,confirmed:true,idempotencyKey:runId},owner,0,'default',403)
  assert.equal(record(deniedJob.error).code,'ui_only')
  // Seed an inert job to verify read/cancel without starting any paid background work.
  const jobId=randomUUID()
  await db.query("INSERT INTO public.comparison_jobs(id,owner_user_id,scope_key,targets,progress) VALUES($1,$2,$3,$4,$5)",[jobId,owner.id,runId,JSON.stringify(comparisonCards),JSON.stringify({done:0,total:1,fresh:0,checked:0,failed:0,stopped:{}})])
  activeJob=jobId
  await read('get_comparison_job',{id:jobId})
  await call('cancel_comparison_job',{id:jobId});activeJob=null
  await call('refresh_prices',{cards})
  await call('refresh_price_checks',{id:'base1-1',finish:'holo',source:'ebay'})
  for(const input of [{source:'soldcomps'},{}]) {
   const denied=await call('refresh_price_checks',{id:'base1-1',finish:'holo',...input},owner,0,'soldcomps-ui-only',403)
   assert.equal(record(denied.error).code,'ui_only')
  }
  await call('get_listings',{id:'base1-1',finish:'holo'})
  const rejected=await call('invite_partner',{email:partner.email})
  await read('list_partners')
  await call('reject_partner_invite',{inviteId:rejected.id},partner)
  const invitation=await call('invite_partner',{email:partner.email})
  await call('accept_partner_invite',{inviteId:invitation.id},partner)
  await call('disconnect_partner',{},partner)
  const clientId=randomUUID()
  await call('add_show_purchase',{clientId,cardId:'base1-1',cardName:'Synthetic performance purchase',language:'en',finish:'holo',price:1,currency:'GBP',boughtAt:new Date().toISOString()})
  await read('list_show_purchases');await call('remove_show_purchase',{clientId})
  const artworkId=randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  const upload=await call('prepare_artwork_upload',{id:artworkId,mimeType:'image/png',size:png.byteLength})
  cleanup.artwork.push(`${owner.id}/${artworkId}`);await persist()
  const put=await fetch(String(upload.signedUploadUrl),{method:'PUT',headers:upload.headers as Record<string,string>,body:png,signal:AbortSignal.timeout(30000)})
  if(!put.ok)throw new Error('Synthetic private artwork upload failed')
  const artwork=await read('get_artwork',{id:artworkId})
  const download=await fetch(String(artwork.downloadUrl),{signal:AbortSignal.timeout(30000)})
  assert.equal(download.status,200,'Private artwork must be downloadable')
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),png,'Private artwork bytes must survive the round trip')
  await call('delete_binder',{id:binderId})
  await db.query('UPDATE public.developer_api_keys SET revoked_at=now() WHERE actor_id=$1',[owner.id])
  await call('list_languages',{},owner,0,'revoked-key',401)
 } catch(error) {
  failures.push(error instanceof Error?error.message:'Performance run failed')
  console.error(failures.at(-1))
 } finally {
  if(activeJob) {try {await call('cancel_comparison_job',{id:activeJob})}catch{failures.push('Background job cleanup failed')}}
  const config=getPrivateArtworkConfig()
  if(config&&config.accessKeyId.length===32) {
   const signer=new AwsClient({...config,service:'s3',region:'auto',retries:0})
   for(const key of [...cleanup.artwork]) {
    if(!actors.some(actor=>key.startsWith(actor.id+'/')))throw new Error('Artwork cleanup refused an unrelated object')
    try {
     const signed=await signer.sign(getR2BucketEndpoint(config)+key,{method:'DELETE'})
     const result=await fetch(signed,{signal:AbortSignal.timeout(15000)})
     if(result.ok||result.status===404)cleanup.artwork=cleanup.artwork.filter(p=>p!==key)
    }catch {failures.push('Private artwork cleanup failed')}
   }
  }
  for(const actor of actors) {
   const current=await admin.auth.admin.getUserById(actor.id)
   if(current.data.user?.app_metadata.performance_fixture!==runId){failures.push('Fixture identity changed; cleanup refused');continue}
   await db.query('DELETE FROM public.binder_public_slugs WHERE owner_user_id=$1',[actor.id])
   await db.query('DELETE FROM public.developer_request_budgets WHERE bucket=ANY($1::text[])',[[actor.id+':read',actor.id+':write']])
   await db.query('DELETE FROM public.account_username_reservations WHERE user_id=$1',[actor.id])
   const result=await admin.auth.admin.deleteUser(actor.id)
   if(result.error)failures.push('Disposable account cleanup failed')
  }
  cleanup.users=actors.length>0&&(await db.query('SELECT count(*)::int n FROM auth.users WHERE id=ANY($1::uuid[])',[actors.map(actor=>actor.id)])).rows[0].n===0
  await persist();await db.end()
 }
 const coverage=summarizeApiSmokeCoverage(samples)
 console.log(JSON.stringify({event:'coverage',successVerified:coverage.filter(row=>row.successVerified).length,
  stagedDenialVerified:coverage.filter(row=>row.stagedDenialVerified).length,uncovered:coverage.filter(row=>row.coverage==='uncovered').length,
  total:coverage.length,nativeExecutionVerified:false,cleanup}))
 process.exitCode=apiSmokeExitCode(samples,failures,cleanup,process.argv.includes('--strict-performance'))
 if(cleanup.artwork.length)console.error('Delete only the disposable private object keys in cleanup.artwork using the Cloudflare account connection.')
}
if(import.meta.main)main().catch(()=>{console.error('Performance setup failed; inspect the output cleanup state.');process.exitCode=1})
