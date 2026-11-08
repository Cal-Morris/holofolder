// Synthetic hosted verification, all fixture and DDL changes are rolled back.
import assert from 'node:assert/strict'
import {developerEntitled} from '../lib/developer-api/permissions'
import {resolveBillingAccess} from '../lib/billing'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
async function main() {
if (!process.argv.includes('--hosted-rollback')) throw new Error('Pass --hosted-rollback to verify without persisting changes.')
const url = new URL(process.env.POSTGRES_URL_NON_POOLING!); url.searchParams.delete('sslmode')
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
try {
 await db.query('BEGIN')
 const sql=await readFile(new URL('./059_developer_access.sql',import.meta.url),'utf8')
 await db.query(sql);await db.query(sql)
 const oauthSql=await readFile(new URL('./060_mcp_oauth_grants.sql',import.meta.url),'utf8')
 await db.query(oauthSql);await db.query(oauthSql)
 const ordinary={user_id:crypto.randomUUID(),claims:{sub:crypto.randomUUID(),role:'authenticated',aud:'authenticated'}}
 assert.deepEqual((await db.query('SELECT public.developer_access_token_hook($1) AS result',[ordinary])).rows[0].result,{claims:ordinary.claims})
 assert.equal((await db.query("SELECT pg_has_role('authenticator','holo_mcp','MEMBER') AS member")).rows[0].member,false)
 const mutationSql=await readFile(new URL('./061_developer_mutations.sql',import.meta.url),'utf8')
 await db.query(mutationSql);await db.query(mutationSql)
 const managementSql=await readFile(new URL('./062_developer_management.sql',import.meta.url),'utf8')
 await db.query(managementSql);await db.query(managementSql)
 const retentionSql=await readFile(new URL('./063_developer_retention.sql',import.meta.url),'utf8')
 await db.query(retentionSql);await db.query(retentionSql)
 const resourceSql=await readFile(new URL('./064_mcp_resource_boundary.sql',import.meta.url),'utf8')
 await db.query(resourceSql);await db.query(resourceSql)
 const atomicOperationsSql=await readFile(new URL('./065_developer_atomic_operations.sql',import.meta.url),'utf8')
 await db.query(atomicOperationsSql);await db.query(atomicOperationsSql)
 const recoverySql=await readFile(new URL('./066_mcp_revocation_recovery.sql',import.meta.url),'utf8')
 await db.query(recoverySql);await db.query(recoverySql)
 const directSql=await readFile(new URL('./067_direct_developer_access.sql',import.meta.url),'utf8')
 await db.query(directSql);await db.query(directSql)
 for(const file of ['068_catalog_image_inventory.sql','069_developer_access_round_trips.sql','071_binder_slot_counts.sql','072_developer_entitlement_lookup.sql']) {
  const sql=await readFile(new URL('./'+file,import.meta.url),'utf8')
  await db.query(sql);await db.query(sql)
 }
 const actor=crypto.randomUUID(), key=crypto.randomUUID()
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[actor])
 await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')",[actor])
 const retry=[actor,actor,'Synthetic API binder','synthetic-retry-key','b'.repeat(64)]
 const first=(await db.query('SELECT public.developer_create_binder($1,$2,$3,$4,$5) AS result',retry)).rows[0].result
 assert.deepEqual((await db.query('SELECT public.developer_create_binder($1,$2,$3,$4,$5) AS result',retry)).rows[0].result,first)
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.binders WHERE owner_user_id=$1 AND name='Synthetic API binder'",[actor])).rows[0].n,1)
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT public.developer_create_binder($1,$2,$3,$4,$5)',[...retry.slice(0,4),'c'.repeat(64)]),/idempotency_conflict/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic card','collected')",[actor,first.id])
 const expected=(await db.query('SELECT to_jsonb(p) AS row FROM public.pokemon_collection p WHERE binder_id=$1',[first.id])).rows[0].row
 await db.query("UPDATE public.pokemon_collection SET status='finalized' WHERE binder_id=$1",[first.id])
 assert.equal((await db.query('SELECT public.developer_delete_collection($1,$1,$2,1,$3) AS result',[actor,first.id,expected])).rows[0].result.conflict,true)
 const current=(await db.query('SELECT to_jsonb(p) AS row FROM public.pokemon_collection p WHERE binder_id=$1',[first.id])).rows[0].row
 assert.equal((await db.query('SELECT public.developer_delete_collection($1,$1,$2,1,$3) AS result',[actor,first.id,current])).rows[0].result.deleted,true)
 const recipient=crypto.randomUUID(),stranger=crypto.randomUUID()
 await db.query("UPDATE auth.users SET email=$2,email_confirmed_at=now() WHERE id=$1",[actor,`synthetic-${actor}@example.invalid`])
 await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now()),($3,$4,now())",[recipient,`synthetic-${recipient}@example.invalid`,stranger,`synthetic-${stranger}@example.invalid`])
 const action=async(who:string,kind:string,email:string|null=null,invite:string|null=null)=>(await db.query('SELECT public.developer_partner_action($1,$2,$3,$4) AS result',[who,kind,email,invite])).rows[0].result
 const invitation=await action(actor,'invite',`synthetic-${recipient}@example.invalid`)
 assert.deepEqual(await action(actor,'invite',`synthetic-${recipient}@example.invalid`),invitation)
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(action(stranger,'accept',null,invitation.id),/Invite not found/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 const joined=await action(recipient,'accept',null,invitation.id)
 assert.deepEqual(await action(recipient,'accept',null,invitation.id),joined)
 assert.equal((await db.query('SELECT owner_user_id FROM public.partnerships WHERE id=$1',[joined.id])).rows[0].owner_user_id,actor)
 const binderIds=(await db.query('SELECT id FROM public.binders WHERE owner_user_id=$1 ORDER BY id',[actor])).rows.map(row=>row.id).reverse()
 await db.query('SELECT public.developer_reorder_binders($1,$2,$3)',[recipient,actor,binderIds])
 assert.deepEqual((await db.query('SELECT id FROM public.binders WHERE owner_user_id=$1 ORDER BY sort_order',[actor])).rows.map(row=>row.id),binderIds)
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT public.developer_reorder_binders($1,$2,$3)',[stranger,actor,binderIds]),/Collection access denied/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 const comparison=[actor,actor,'synthetic-scope',[],{},'synthetic-comparison-key','d'.repeat(64)]
 const job=(await db.query('SELECT public.developer_create_comparison_job($1,$2,$3,$4,$5,$6,$7) AS result',comparison)).rows[0].result
 assert.equal(job.created,true)
 const replay=(await db.query('SELECT public.developer_create_comparison_job($1,$2,$3,$4,$5,$6,$7) AS result',comparison)).rows[0].result
 assert.equal(replay.created,false);assert.equal(replay.job.id,job.job.id)
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT public.developer_create_comparison_job($1,$2,$3,$4,$5,$6,$7)',[...comparison.slice(0,6),'e'.repeat(64)]),/idempotency_conflict/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 await action(recipient,'disconnect')
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.partnerships WHERE id=$1',[joined.id])).rows[0].n,0)
 await db.query("INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at) VALUES($1,'synthetic_expired','synthetic-expired-key',$2,'{}',now()-interval '1 day')",[actor,'a'.repeat(64)])
 await db.query('SELECT public.consume_developer_budget($1,10)',[`synthetic-retention:${actor}`])
 assert.equal((await db.query("SELECT count(*)::int AS n FROM public.developer_idempotency WHERE actor_id=$1 AND operation='synthetic_expired'",[actor])).rows[0].n,0,'Expired idempotency metadata must be cleaned on ordinary API traffic')
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query("INSERT INTO auth.oauth_authorizations(authorization_id,client_id,redirect_uri,scope,resource,code_challenge,code_challenge_method,response_type,expires_at) VALUES($1,$2,'https://synthetic.invalid/callback','email','https://wrong-resource.invalid',$3,'s256','code',now()+interval '5 minutes')",[crypto.randomUUID(),crypto.randomUUID(),'a'.repeat(43)]),/MCP authorization requires its exact resource/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 const client=crypto.randomUUID(), authorization=crypto.randomUUID()
 await db.query("INSERT INTO auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_name,client_type,token_endpoint_auth_method) VALUES($1,'dynamic','https://synthetic.invalid/callback','authorization_code,refresh_token','Synthetic direct MCP client','public','none')",[client])
 const insertAuthorization="INSERT INTO auth.oauth_authorizations(id,authorization_id,client_id,user_id,redirect_uri,scope,resource,code_challenge,code_challenge_method,expires_at) VALUES($1,$2,$3,$4,'https://synthetic.invalid/callback','email',$5,$6,'s256',now()+interval '5 minutes')"
 for(const resource of ['https://holofolder.com/app/mcp','https://wrong-resource.invalid']) {
  await db.query('SAVEPOINT direct_resource_failure')
  await assert.rejects(db.query(insertAuthorization,[crypto.randomUUID(),crypto.randomUUID(),client,actor,resource,'a'.repeat(43)]),/MCP authorization requires its exact resource/)
  await db.query('ROLLBACK TO SAVEPOINT direct_resource_failure')
 }
 await db.query(insertAuthorization,[crypto.randomUUID(),authorization,client,actor,'https://app.holofolder.com/app/mcp','a'.repeat(43)])
 assert.equal((await db.query('SELECT public.read_developer_oauth_request($1,$2) AS result',[authorization,actor])).rows[0].result.grant_active,false)
 const grant=(await db.query('SELECT public.approve_developer_oauth_request($1,$2,$3) AS result',[authorization,actor,['catalog:read']])).rows[0].result
 assert.equal((await db.query('SELECT public.read_developer_oauth_request($1,$2) AS result',[authorization,actor])).rows[0].result.grant_active,true)
 assert.equal((await db.query('SELECT public.read_developer_oauth_request($1,$2) AS result',[authorization,stranger])).rows[0].result,null)
 const hooked=(await db.query('SELECT public.developer_access_token_hook($1) AS result',[{user_id:actor,claims:{sub:actor,client_id:client,aud:'authenticated',role:'authenticated'}}])).rows[0].result.claims
 assert.equal(hooked.aud,'https://app.holofolder.com/app/mcp')
 assert.equal(hooked.role,'holo_mcp')
 assert.equal(hooked.developer_grant_id,grant)
 assert.deepEqual((await db.query('SELECT public.developer_access_token_hook($1) AS result',[ordinary])).rows[0].result,{claims:ordinary.claims})
 const settingsRow={binder_color_id:'synthetic',binder_page_colors:{},binder_slot_glare_enabled:true,card_finish_effects_enabled:true,dark_mode:false,show_binder_value:true,pricing_region:null,preferred_currency:null,preferred_card_language:null,layout_rows:4,layout_cols:4}
 const initialSettings=(await db.query('SELECT to_jsonb(s) AS row FROM public.user_settings s WHERE user_id=$1',[actor])).rows[0]?.row??null
 const initialLayout=(await db.query("SELECT jsonb_build_object('binder_rows',binder_rows,'binder_cols',binder_cols) AS layout FROM public.binders WHERE id=$1",[first.id])).rows[0].layout
 assert.equal((await db.query('SELECT public.developer_save_settings($1,$1,$2,$3,$4,$5) AS result',[actor,first.id,initialSettings,initialLayout,settingsRow])).rows[0].result.conflict,false)
 const savedSettings=(await db.query('SELECT to_jsonb(s) AS row FROM public.user_settings s WHERE user_id=$1',[actor])).rows[0].row
 await db.query('UPDATE public.user_settings SET dark_mode=true WHERE user_id=$1',[actor])
 assert.equal((await db.query('SELECT public.developer_save_settings($1,$1,$2,$3,$4,$5) AS result',[actor,first.id,savedSettings,{binder_rows:4,binder_cols:4},{...settingsRow,layout_rows:5}])).rows[0].result.conflict,true)
 assert.equal((await db.query('SELECT binder_rows FROM public.binders WHERE id=$1',[first.id])).rows[0].binder_rows,4)
 assert.equal((await db.query('SELECT dark_mode FROM public.user_settings WHERE user_id=$1',[actor])).rows[0].dark_mode,true)
 const lastBinder=(await db.query('SELECT public.developer_delete_binder($1,$1,$2,false) AS result',[actor,first.id])).rows[0].result
 assert.equal(lastBinder.reason,'last-binder')
 const spare=(await db.query('SELECT public.developer_create_binder($1,$1,$2,$3,$4) AS result',[actor,'Synthetic deletion binder','synthetic-delete-binder','f'.repeat(64)])).rows[0].result
 await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,2,'Synthetic retained card','collected')",[actor,spare.id])
 assert.equal((await db.query('SELECT public.developer_delete_binder($1,$1,$2,false) AS result',[actor,spare.id])).rows[0].result.reason,'needs-confirmation')
 assert.equal((await db.query('SELECT public.developer_delete_binder($1,$1,$2,true) AS result',[actor,spare.id])).rows[0].result.ok,true)
 const values=[key,actor,'Synthetic test key','a'.repeat(64),['catalog:read'],90]
 await db.query('SELECT public.create_developer_api_key($1,$2,$3,$4,$5,$6)',values)
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.developer_api_keys WHERE actor_id=$1',[actor])).rows[0].n,1)
 await db.query("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
 const authorize=async(digest='a'.repeat(64),permissions=['catalog:read'])=>(await db.query("SELECT public.authenticate_developer_request($1,$2,$3,'read',$4) AS result",[key,digest,permissions,`preauth:synthetic-${actor}`])).rows[0].result
 const authorized=await authorize()
 assert.equal(authorized.actor_id,actor);assert.equal(authorized.owner_user_id,actor);assert.equal(authorized.budget.allowed,true)
 assert.equal((await authorize('b'.repeat(64))).error,'invalid_api_key')
 assert.equal((await authorize('a'.repeat(64),['collection:write'])).error,'insufficient_permissions')
 const allowedReads=(await db.query("SELECT public.authenticate_developer_request($1,$2,ARRAY['catalog:read'],'read',NULL) AS result FROM generate_series(1,59)",[key,'a'.repeat(64)])).rows
 assert.ok(allowedReads.every(row=>row.result.budget.allowed))
 assert.equal((await authorize()).budget.allowed,false)
 await db.query('UPDATE public.developer_api_keys SET revoked_at=now() WHERE id=$1',[key])
 assert.equal((await authorize()).error,'invalid_api_key')
 await db.query("UPDATE public.developer_api_keys SET revoked_at=NULL,expires_at=now()-interval '1 day' WHERE id=$1",[key])
 assert.equal((await authorize()).error,'invalid_api_key')
 await db.query("UPDATE public.developer_api_keys SET expires_at=now()+interval '90 days' WHERE id=$1",[key])
 await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES(least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$1)',[actor,recipient])
 const partner=(await db.query("SELECT public.resolve_developer_access($1,NULL) AS result",[recipient])).rows[0].result
 assert.equal(partner.owner_user_id,actor);assert.deepEqual(new Set(partner.member_ids),new Set([actor,recipient]))
 const free=(await db.query("SELECT public.resolve_developer_access($1,'read') AS result",[stranger])).rows[0].result
 assert.equal(free.owner_user_id,stranger);assert.equal(free.budget,null)
 for(const role of ['anon','authenticated','holo_mcp']) {
  assert.equal((await db.query("SELECT has_function_privilege($1,'public.authenticate_developer_request(uuid,text,text[],text,text)','execute') AS allowed",[role])).rows[0].allowed,false)
  assert.equal((await db.query("SELECT has_table_privilege($1,'public.card_image_inventory','select') AS allowed",[role])).rows[0].allowed,false)
 }
 // Lightweight developer entitlement must agree with the full billing resolver for every paid state.
 await db.query('UPDATE auth.users SET created_at=now() WHERE id=$1',[stranger])
 for(const [status,paidUntil] of [['none',null],['active',new Date(Date.now()+86400000).toISOString()],['past_due',new Date(Date.now()+86400000).toISOString()],['canceled',null],['active','2020-01-01T00:00:00Z']] as const) {
  await db.query('INSERT INTO public.billing_accounts(owner_user_id,status,paid_through) VALUES($1,$2,$3) ON CONFLICT(owner_user_id) DO UPDATE SET status=excluded.status,paid_through=excluded.paid_through',[stranger,status,paidUntil])
  const full=(await db.query('SELECT public.get_billing_access($1) AS result',[stranger])).rows[0].result
  const lean=(await db.query('SELECT public.resolve_developer_access($1,NULL) AS result',[stranger])).rows[0].result.billing_access
  assert.equal(developerEntitled(resolveBillingAccess(stranger,lean)),developerEntitled(resolveBillingAccess(stranger,full)))
  assert.equal('saved_card_count' in lean,false)
 }
 const actualCounts=(await db.query('SELECT binder_id::text,slot_count::int FROM public.get_binder_slot_counts($1) ORDER BY binder_id',[actor])).rows
 const expectedCounts=(await db.query('SELECT binder_id::text,count(*)::int AS slot_count FROM public.pokemon_collection WHERE user_id=$1 AND binder_id IS NOT NULL GROUP BY binder_id ORDER BY binder_id',[actor])).rows
 assert.deepEqual(actualCounts,expectedCounts)
 for(const role of ['anon','authenticated','holo_mcp'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.get_binder_slot_counts(uuid)','execute') AS allowed",[role])).rows[0].allowed,false)
 const budgets=(await db.query("SELECT public.consume_developer_budget($1,10) AS budget FROM generate_series(1,11)",[actor])).rows.map(row=>row.budget.allowed)
 assert.deepEqual(budgets,[...Array(10).fill(true),false])
 for(let n=1;n<10;n++) await db.query('SELECT public.create_developer_api_key($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),...values.slice(1)])
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT public.create_developer_api_key($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),...values.slice(1)]),/key_limit_reached/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})])
 await db.query('SET LOCAL ROLE authenticated')
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT * FROM public.developer_api_keys'),/permission denied/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 await db.query('SAVEPOINT expected_failure')
 await assert.rejects(db.query('SELECT public.consume_developer_budget($1,10)',[actor]),/permission denied/)
 await db.query('ROLLBACK TO SAVEPOINT expected_failure')
 await db.query('RESET ROLE')
 const plan=await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM public.developer_api_keys WHERE actor_id=$1',[actor]);assert.ok(plan.rows.length)
 console.log('PASS: key and OAuth migrations through 072 twice (070 is separately applied concurrent index DDL), entitlement parity and grouped count parity, one-call key validation, expiry/revocation/permissions, owner/partner/free membership, 60/min limit and image inventory isolation, direct resource/consent/audience checks, unchanged first-party claims, MCP DB impersonation denied;, personal key insertion, ten-key cap, shared limit exhaustion, private table/RPC denial and actor lookup EXPLAIN; all rolled back.')
} finally {await db.query('ROLLBACK');await db.end()}

}
main().catch(error => { console.error(error instanceof Error ? error.name==='AssertionError'?error.stack:error.message : "Verification failed"); process.exitCode = 1 })
