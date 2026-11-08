// Hosted verification uses synthetic accounts and rolls back every change, including the migration.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

async function main() {
  const connectionString = process.env.TRIAL_TEST_DATABASE_URL
  if (!connectionString || !process.argv.includes('--hosted-rollback')) throw new Error('Set TRIAL_TEST_DATABASE_URL explicitly and pass --hosted-rollback')
  const url = new URL(connectionString); url.searchParams.delete('sslmode')
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 })
  await db.connect()
  const owner = crypto.randomUUID(), partner = crypto.randomUUID(), stranger = crypto.randomUUID()
  const authenticate = async (id: string) => {
    await db.query('RESET ROLE')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, role: 'authenticated' })])
    await db.query('SET LOCAL ROLE authenticated')
  }
  const denied = async (sql: string, values: unknown[], message: RegExp) => {
    await db.query('SAVEPOINT expected_failure')
    await assert.rejects(db.query(sql, values), message)
    await db.query('ROLLBACK TO SAVEPOINT expected_failure')
  }
  const paid = async () => (await db.query('SELECT public.billing_has_paid($1) AS paid', [owner])).rows[0].paid
  try {
    await db.query('BEGIN')
    const before = (await db.query('SELECT grandfather_cutoff,enforced,(SELECT count(*) FROM public.perpetual_licences) AS licences FROM public.billing_configuration')).rows[0]
    const migration = await readFile(new URL('./056_signup_premium_trial.sql', import.meta.url), 'utf8')
    await db.query(migration); await db.query(migration)
    assert.deepEqual((await db.query('SELECT grandfather_cutoff,enforced,(SELECT count(*) FROM public.perpetual_licences) AS licences FROM public.billing_configuration')).rows[0], before)
    await db.query('UPDATE public.billing_configuration SET enforced=true')
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,now()),($2,now()-interval '30 days'),($3,now()-interval '30 days')", [owner, partner, stranger])
    assert.equal(await paid(), true)
    const access = (await db.query("SELECT public.get_billing_access($1) AS access, now()+interval '168 hours' AS expected", [owner])).rows[0]
    assert.equal(Date.parse(access.access.trial_ends_at), access.expected.getTime())
    assert.equal(access.access.paid_through, null)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.billing_accounts WHERE owner_user_id=$1', [owner])).rows[0].n, 0)
    const binder = (await db.query('SELECT public.ensure_default_binder($1) AS id', [owner])).rows[0].id
    await db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic trial binder')", [owner])
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) SELECT $1,$2,n,'Synthetic trial card','collected' FROM generate_series(1,101)n", [owner, binder])
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
    await authenticate(partner)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 101)
    assert.ok((await db.query('SELECT public.get_billing_access($1) AS access', [owner])).rows[0].access.trial_ends_at)
    await denied('UPDATE auth.users SET created_at=now() WHERE id=$1', [owner], /permission denied/)
    await authenticate(stranger)
    assert.equal((await db.query('SELECT public.get_billing_access($1) AS access', [owner])).rows[0].access, null)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 0)
    await db.query('RESET ROLE')
    await db.query("UPDATE auth.users SET created_at=now()-interval '168 hours'+interval '1 millisecond' WHERE id=$1", [owner])
    assert.equal(await paid(), true)
    await db.query("UPDATE auth.users SET created_at=now()-interval '168 hours' WHERE id=$1", [owner])
    assert.equal(await paid(), false)
    await denied("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic expired binder')", [owner], /binder_limit_reached/)
    await denied("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,102,'Synthetic expired card','collected')", [owner, binder], /card_limit_reached/)
    await authenticate(owner)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.binders WHERE owner_user_id=$1', [owner])).rows[0].n, 2)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 101)
    await db.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic retained edit' WHERE user_id=$1", [owner])
    await authenticate(partner)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 0)
    await db.query('RESET ROLE')
    await db.query("UPDATE auth.users SET created_at=now()+interval '1 hour' WHERE id=$1", [owner])
    assert.equal(await paid(), false)
    await db.query("INSERT INTO public.billing_accounts(owner_user_id,status,paid_through) VALUES($1,'active',now()+interval '30 days')", [owner])
    assert.equal(await paid(), true)
    await db.query("UPDATE public.billing_accounts SET status='canceled' WHERE owner_user_id=$1", [owner])
    await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner])
    assert.equal(await paid(), true)
    const plan = await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT public.billing_has_paid($1)', [owner])
    assert.ok(plan.rows.length)
    console.log('Trial: migration twice, exact 168-hour signup expiry, no billing account, premium limits, partner/stranger RLS, timestamp tamper denial, retained data/edits, future signup denial and paid/lifetime overrides passed; all rolled back')
  } finally { await db.query('ROLLBACK'); await db.end() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Trial verification failed'); process.exitCode = 1 })
