// Explicit schema/access verification only. The transaction and every synthetic record roll back.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"

async function main() {
  if (!process.argv.includes("--hosted-rollback") || !process.env.COLLECTOR_FUNNEL_TEST_DATABASE_URL) throw new Error("Set COLLECTOR_FUNNEL_TEST_DATABASE_URL explicitly and pass --hosted-rollback.")
  const url = new URL(process.env.COLLECTOR_FUNNEL_TEST_DATABASE_URL); url.searchParams.delete("sslmode")
  const db = new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:10000})
  await db.connect()
  const owner = crypto.randomUUID(), stranger = crypto.randomUUID()
  const denied = async (sql: string, values: unknown[] = []) => { await db.query("SAVEPOINT denied"); await assert.rejects(db.query(sql,values),{code:"42501"}); await db.query("ROLLBACK TO SAVEPOINT denied") }
  try {
    await db.query("BEGIN")
    const migration = await readFile(new URL("./054_collector_funnel.sql",import.meta.url),"utf8")
    await db.query(migration); await db.query(migration)
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,now()),($2,now())",[owner,stranger])
    await db.query("SET LOCAL ROLE service_role")
    await db.query("SELECT public.observe_collector_account($1,now(),true,'reddit','social','launch')",[owner])
    await db.query("SELECT public.observe_collector_account($1,now(),true,'youtube',null,null)",[owner])
    assert.equal((await db.query("SELECT source FROM public.collector_accounts WHERE account_id=$1",[owner])).rows[0].source,"reddit")
    for (const name of ["first_save","activated","first_paid","app_open"] ) {
      const sql = "INSERT INTO public.collector_events(owner_id,actor_id,name,event_key,occurred_at) VALUES($1,$1,$2,$2,now()-interval '100 days') ON CONFLICT(owner_id,event_key) DO NOTHING"
      await db.query(sql,[owner,name]); await db.query(sql,[owner,name])
    }
    assert.equal((await db.query("SELECT count(*)::int n FROM public.collector_events WHERE owner_id=$1",[owner])).rows[0].n,4)
    await db.query("DELETE FROM public.collector_events WHERE owner_id=$1 AND occurred_at<now()-interval '90 days' AND name NOT IN ('first_save','activated','first_paid')",[owner])
    assert.equal((await db.query("SELECT count(*)::int n FROM public.collector_events WHERE owner_id=$1",[owner])).rows[0].n,3)
    const plan = await db.query("EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM public.collector_events WHERE occurred_at<now()-interval '90 days' AND name NOT IN ('first_save','activated','first_paid') ORDER BY occurred_at,id LIMIT 100")
    assert.ok(plan.rows.length)
    await db.query("RESET ROLE")
    for (const id of [owner,stranger]) {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:"authenticated"})]); await db.query("SET LOCAL ROLE authenticated")
      await denied("SELECT * FROM public.collector_events"); await denied("SELECT * FROM public.collector_accounts")
      await denied("SELECT public.observe_collector_account($1,now(),true,null,null,null)",[id])
      await denied("INSERT INTO public.collector_events(owner_id,actor_id,name,event_key,occurred_at) VALUES($1,$1,'first_paid','forged',now())",[id])
      await db.query("RESET ROLE")
    }
    await db.query("SET LOCAL ROLE anon"); await denied("SELECT * FROM public.collector_events"); await db.query("RESET ROLE")
    await db.query("DELETE FROM auth.users WHERE id=$1",[owner])
    assert.equal((await db.query("SELECT count(*)::int n FROM public.collector_events WHERE owner_id=$1",[owner])).rows[0].n,0)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.collector_accounts WHERE account_id=$1",[owner])).rows[0].n,0)
    console.log("Migration twice, immutable first touch, event deduplication, retention, owner/stranger/anon denial, service role and account-deletion cascades passed. All verification changes rolled back.")
  } finally { await db.query("ROLLBACK"); await db.end() }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"Collector schema verification failed.");process.exitCode=1})
