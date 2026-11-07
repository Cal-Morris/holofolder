// Explicit hosted verification is rollback-only, including the migration and synthetic accounts.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

async function main() {
const url = new URL(process.env.BILLING_TEST_DATABASE_URL ?? '')
url.searchParams.delete('sslmode')
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
await db.connect()
const user = crypto.randomUUID(), partner = crypto.randomUUID()
const denied = async (sql: string, values: unknown[]) => {
  await db.query('savepoint denied')
  await assert.rejects(db.query(sql, values))
  await db.query('rollback to savepoint denied')
}
try {
  await db.query('begin')
  const migration = await readFile(new URL('./049_billing_access.sql', import.meta.url), 'utf8')
  await db.query(migration)
  const before = await db.query('select count(*)::int as count from public.perpetual_licences')
  await db.query("insert into auth.users(id,created_at) values ($1,clock_timestamp()),($2,clock_timestamp())", [user, partner])
  await db.query(migration)
  assert.equal((await db.query('select count(*)::int as count from public.perpetual_licences')).rows[0].count, before.rows[0].count)
  await db.query('update public.billing_configuration set enforced=true')
  const binder = (await db.query('select public.ensure_default_binder($1) as id', [user])).rows[0].id
  await db.query("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) select $1,$2,n,'Synthetic card','collected' from generate_series(1,10) n", [user,binder])
  await denied("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) values($1,$2,11,'Synthetic extra','collected')",[user,binder])
  await denied("update public.pokemon_collection set wanted_cards='[{}]' where user_id=$1 and pokemon_id=1",[user])
  await db.query("update public.pokemon_collection set pokemon_name='Synthetic renamed' where user_id=$1", [user])
  await db.query('delete from public.pokemon_collection where user_id=$1 and pokemon_id=10',[user])
  await db.query("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) values($1,$2,11,'Synthetic replacement','collected')",[user,binder])
  await db.query('insert into public.partnerships(user1_id,user2_id,owner_user_id) values($1,$2,$1)',[user,partner])
  assert.equal((await db.query('select public.billing_partner_allowed($1,$2) as allowed',[user,partner])).rows[0].allowed,false)
  await db.query("insert into public.perpetual_licences(owner_user_id,source) values($1,'manual')",[user])
  assert.equal((await db.query('select public.billing_partner_allowed($1,$2) as allowed',[user,partner])).rows[0].allowed,true)
  await db.query("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) values($1,$2,12,'Synthetic paid','collected')",[user,binder])
  await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)",[partner,JSON.stringify({sub:partner,role:'authenticated'})])
  await db.query('set local role authenticated')
  assert.equal((await db.query('select count(*)::int as count from public.pokemon_collection where user_id=$1',[user])).rows[0].count,11)
  await denied("insert into public.perpetual_licences(owner_user_id,source) values($1,'manual')",[partner])
  await db.query('reset role')
  await db.query('delete from public.perpetual_licences where owner_user_id=$1',[user])
  await db.query('set local role authenticated')
  assert.equal((await db.query('select count(*)::int as count from public.pokemon_collection where user_id=$1',[user])).rows[0].count,0)
  await db.query('reset role')
  const plan=await db.query('explain (analyze,buffers) select public.get_billing_access($1)',[user])
  assert.ok(plan.rows.length)
  console.log('Billing migration rerun, grandfather cutoff, cap, wants, deletion, perpetual override, partner RLS and licence tamper checks passed; all rolled back')
} finally { await db.query('rollback'); await db.end() }

}
main().catch(error => { console.error(error instanceof Error ? error.message : "Billing verification failed");process.exitCode=1 })
