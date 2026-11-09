import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Explicit isolated local database only. All synthetic fixture mutations roll back.
test('Activity recovery restores exact legacy rows, refuses stale/ABA, replays once and retains linked history', {skip:process.env.ACTIVITY_RECOVERY_SQL!=='1',timeout:60000},async()=>{
  const {Client}=await import('pg')
  const db=new Client({host:'/Users/cal/.local/share/holofolder/issue447-local/s',port:55647,user:'activity_test',database:'postgres'})
  await db.connect()
  const migration=readFileSync(new URL('../scripts/087_activity_recovery.sql',import.meta.url),'utf8')
  try {
    await db.query(migration);await db.query(migration)
    await db.query('BEGIN')
    const owner='04470000-0000-4000-8000-000000000001',partner='04470000-0000-4000-8000-000000000002',binder='04470000-0000-4000-8000-000000000011'
    await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[owner,partner])
    await db.query('UPDATE public.billing_configuration SET enforced=false')
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)',[owner,partner])
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic recovery',true)",[binder,owner])
    const flush=()=>db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED')
    await flush()
    const sql=async(q:string,args:unknown[]=[]) => (await db.query(q,args)).rows
    const ctx={actor:{kind:'user',userId:partner},source:'app',clientId:null,batchId:'synthetic-recovery-op',operationId:'synthetic-recovery-op',clientOccurredAt:null}
    const rpc=async(operation:string,request:unknown)=>{
      await db.query("SELECT set_config('role','service_role',true),set_config('request.headers',$1,true)",[JSON.stringify({'x-holo-audit-context':JSON.stringify(ctx)})])
      try{return (await sql('SELECT public.collection_recovery_v1($1,$2,$3) r',[operation,owner,request]))[0].r}
      finally{await db.query('RESET ROLE').catch(()=>{})}
    }
    const rejected=async(run:()=>Promise<unknown>,match:RegExp)=>{await db.query('SAVEPOINT rejected');await assert.rejects(run(),match);await db.query('ROLLBACK TO SAVEPOINT rejected')}
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status,card_id,card_name,card_set,card_finish,card_language) VALUES($1,$2,1,'Bulbasaur','collected','mep-037','Bulbasaur','MEP Black Star Promos','holo','en')",[owner,binder]);await flush()
    const original=(await sql('SELECT to_jsonb(p) r FROM public.pokemon_collection p WHERE user_id=$1',[owner]))[0].r
    await db.query('DELETE FROM public.pokemon_collection WHERE user_id=$1 AND pokemon_id=1',[owner]);await flush()
    const event=(await sql('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1',[owner]))[0].id
    const input={eventId:event,restoreUnassignedItemIds:[]}
    const preview=await rpc('preview',input)
    assert.equal(preview.supported,true);assert.deepEqual(preview.conflicts,[]);assert.match(preview.planToken,/^[a-f0-9]{64}$/)
    const request={...input,planVersion:1,planToken:preview.planToken,operationId:ctx.operationId,confirmed:true}
    await rejected(()=>rpc('apply',{...request,confirmed:false}),/invalid_recovery_request/)
    const result=await rpc('apply',request)
    assert.equal(result.recoveredEventId,event)
    assert.deepEqual(await rpc('apply',request),result)
    const restored=(await sql('SELECT to_jsonb(p) r FROM public.pokemon_collection p WHERE user_id=$1',[owner]))[0].r
    for(const key of Object.keys(original).filter(k=>!['created_at','updated_at'].includes(k)))assert.deepEqual(restored[key],original[key],key)
    assert.equal((await sql('SELECT recovery_of_event_id::text FROM public.collection_activity WHERE id=$1',[result.eventId]))[0].recovery_of_event_id,event)
    assert.equal((await rpc('preview',input)).conflicts[0].reason,'card_changed')
    // Same visible final state after a later add/remove must still conflict.
    await db.query('DELETE FROM public.pokemon_collection WHERE user_id=$1 AND pokemon_id=1',[owner]);await flush()
    assert.equal((await rpc('preview',input)).conflicts[0].reason,'card_changed')
    await rejected(()=>rpc('apply',{...request,operationId:'synthetic-new-retry'}),/storage_operation_mismatch|recovery_plan_conflict/)
    // A final-state-neutral bulk inverse must fit at the free cap, regardless of ID order.
    const wants=[{card_id:'synthetic-a',card_name:'Synthetic A'},{card_id:'synthetic-b',card_name:'Synthetic B'}]
    await db.query("INSERT INTO public.pokemon_collection(id,user_id,binder_id,pokemon_id,pokemon_name,status,wanted_cards) VALUES('04470000-0000-4000-8000-000000000021',$1,$2,2,'Synthetic A','collected',$3),('04470000-0000-4000-8000-000000000022',$1,$2,3,'Synthetic B','collected','[]')",[owner,binder,JSON.stringify(wants)]);await flush()
    await db.query("UPDATE public.pokemon_collection SET wanted_cards=CASE pokemon_id WHEN 2 THEN '[]'::jsonb ELSE $2::jsonb END WHERE user_id=$1",[owner,JSON.stringify(wants)]);await flush()
    const bulkEvent=(await sql('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1',[owner]))[0].id
    ctx.actor.userId=owner
    const bulkPreview=await rpc('preview',{eventId:bulkEvent,restoreUnassignedItemIds:[]})
    assert.equal(bulkPreview.rootRevisionsAdvance,false)
    await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=4')
    ctx.operationId='synthetic-bulk-undo-0001'
    await rpc('apply',{...request,eventId:bulkEvent,planToken:bulkPreview.planToken,operationId:ctx.operationId})
    assert.deepEqual((await sql('SELECT wanted_cards FROM public.pokemon_collection WHERE user_id=$1 AND pokemon_id=2',[owner]))[0].wanted_cards,wants)
    await db.query('UPDATE public.billing_configuration SET enforced=false')
    ctx.operationId=request.operationId;ctx.actor.userId=partner
    await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1',[owner]);await flush()
    await rejected(()=>rpc('apply',request),/storage_access_denied|audit_actor_access_denied/)
    assert.equal((await sql("SELECT has_function_privilege('authenticated','public.collection_recovery_v1(text,uuid,jsonb)','EXECUTE') allowed"))[0].allowed,false)
  } finally {await db.query('ROLLBACK').catch(()=>{});await db.end()}
})

test('recovery races serialize with ordinary writes and concurrent retries return one receipt', {skip:process.env.ACTIVITY_RECOVERY_SQL!=='1',timeout:30000},async()=>{
 const {Client}=await import('pg')
 const config={host:'/Users/cal/.local/share/holofolder/issue447-local/s',port:55647,user:'activity_test',database:'postgres'}
 const setup=new Client(config),writer=new Client(config),recovery=new Client(config)
 await Promise.all([setup.connect(),writer.connect(),recovery.connect()])
 const owner='04470000-0000-4000-8000-000000000101',binder='04470000-0000-4000-8000-000000000111'
 const ctx={actor:{kind:'user',userId:owner},source:'app',clientId:null,batchId:'synthetic-concurrent',operationId:'synthetic-concurrent',clientOccurredAt:null}
 const input=(eventId:string,planToken:string)=>({eventId,restoreUnassignedItemIds:[],planVersion:1,planToken,confirmed:true,operationId:ctx.operationId})
 async function begin(client:InstanceType<typeof Client>) {
   await client.query('BEGIN; SET LOCAL statement_timeout=\'5s\'')
   await client.query("SELECT set_config('role','service_role',true),set_config('request.headers',$1,true)",[JSON.stringify({'x-holo-audit-context':JSON.stringify(ctx)})])
 }
 async function rpc(client:InstanceType<typeof Client>,op:string,request:unknown) {
   return (await client.query('SELECT public.collection_recovery_v1($1,$2,$3) r',[op,owner,request])).rows[0].r
 }
 try {
   await setup.query('BEGIN')
   await setup.query('INSERT INTO auth.users(id) VALUES($1)',[owner])
   await setup.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic concurrent recovery',true)",[binder,owner])
   await setup.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic concurrent card','collected')",[owner,binder])
   await setup.query('COMMIT')
   await setup.query("UPDATE public.pokemon_collection SET card_finish='holo' WHERE user_id=$1",[owner])
   const event=(await setup.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1',[owner])).rows[0].id
   await begin(recovery)
   const preview=await rpc(recovery,'preview',{eventId:event,restoreUnassignedItemIds:[]})
   await recovery.query('COMMIT')
   await writer.query('BEGIN')
   await writer.query('SELECT id FROM public.pokemon_collection WHERE user_id=$1 FOR UPDATE',[owner])
   await begin(recovery)
   const pid=(await recovery.query('SELECT pg_backend_pid() pid')).rows[0].pid
   const pending=rpc(recovery,'apply',input(event,preview.planToken))
   const rejected=assert.rejects(pending,/recovery_plan_conflict/)
   let blocked=false
   for(let i=0;i<100&&!blocked;i++) {
     blocked=(await setup.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked
     if(!blocked)await new Promise(resolve=>setTimeout(resolve,10))
   }
   assert.equal(blocked,true,'recovery must wait for the ordinary row writer')
   await writer.query("UPDATE public.pokemon_collection SET card_name='Synthetic newer edit' WHERE user_id=$1",[owner])
   await writer.query('COMMIT')
   await rejected;await recovery.query('ROLLBACK')
   assert.equal((await setup.query('SELECT card_name FROM public.pokemon_collection WHERE user_id=$1',[owner])).rows[0].card_name,'Synthetic newer edit')
   // Two deliveries of a removal inverse create exactly one linked event and one original row.
   await setup.query('DELETE FROM public.pokemon_collection WHERE user_id=$1',[owner])
   const removed=(await setup.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1',[owner])).rows[0].id
   await begin(recovery)
   const plan=await rpc(recovery,'preview',{eventId:removed,restoreUnassignedItemIds:[]});await recovery.query('COMMIT')
   const apply=async(client:InstanceType<typeof Client>)=>{await begin(client);const r=await rpc(client,'apply',input(removed,plan.planToken));await client.query('COMMIT');return r}
   const [first,second]=await Promise.all([apply(writer),apply(recovery)])
   assert.deepEqual(first,second)
   assert.equal((await setup.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND recovery_of_event_id=$2',[owner,removed])).rows[0].n,1)
 } finally {
   await Promise.all([writer.query('ROLLBACK').catch(()=>{}),recovery.query('ROLLBACK').catch(()=>{})])
   await setup.query('DELETE FROM auth.users WHERE id=$1',[owner])
   await Promise.all([setup.end(),writer.end(),recovery.end()])
 }
})
