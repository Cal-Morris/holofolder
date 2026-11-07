import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
async function main() {
  const connectionString = process.env.BILLING_TEST_DATABASE_URL
  if (!connectionString || !['127.0.0.1','localhost'].includes(new URL(connectionString).hostname)) throw new Error('Requires an isolated local database')
  const a=new pg.Client({connectionString}), b=new pg.Client({connectionString})
  await Promise.all([a.connect(),b.connect()])
  try {
    await a.query(await readFile(new URL('../tests/billing-access-migration.sql',import.meta.url),'utf8'))
    const migration=await readFile(new URL('./047_billing_access.sql',import.meta.url),'utf8')
    await a.query(migration);await a.query(migration)
    const owner=crypto.randomUUID(),binder=crypto.randomUUID(),other=crypto.randomUUID()
    await a.query('insert into auth.users(id) values($1)',[owner])
    await a.query('update public.billing_configuration set enforced=true')
    await a.query("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,status) select $1,$2,n,'collected' from generate_series(1,9)n",[owner,binder])
    const add=(db:pg.Client,id:string,n:number)=>db.query("insert into public.pokemon_collection(user_id,binder_id,pokemon_id,status) values($1,$2,$3,'collected')",[owner,id,n])
    const results=await Promise.allSettled([add(a,binder,10),add(b,other,11)])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal((await a.query('select count(*)::int as n from public.pokemon_collection where user_id=$1',[owner])).rows[0].n,10)
    const row=(await a.query('select binder_id,pokemon_id from public.pokemon_collection where user_id=$1 limit 1',[owner])).rows[0]
    await assert.rejects(a.query("update public.pokemon_collection set wanted_cards='[{},{}]' where binder_id=$1 and pokemon_id=$2",[row.binder_id,row.pokemon_id]),/card_limit_reached/)
    await a.query("insert into public.perpetual_licences(owner_user_id,source) values($1,'manual')",[owner])
    await add(b,other,12)
    console.log('Real Postgres concurrent inserts across binders: exactly one accepted at free count 9; wants rejected at cap; lifetime bypass accepted')
  } finally {await a.end();await b.end()}
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Concurrency verification failed');process.exitCode=1})
