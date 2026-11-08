// Local concurrency proof or explicit rollback-only verification against the hosted schema.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

async function verifyHosted(db: pg.Client) {
  const denied = async (sql: string, values: unknown[], message?: RegExp) => {
    await db.query('SAVEPOINT expected_failure')
    if (message) await assert.rejects(db.query(sql, values), message)
    else await assert.rejects(db.query(sql, values))
    await db.query('ROLLBACK TO SAVEPOINT expected_failure')
  }
  await db.query('BEGIN')
  try {
    const before = (await db.query('SELECT grandfather_cutoff,enforced,(SELECT count(*) FROM public.perpetual_licences) AS licences FROM public.billing_configuration')).rows[0]
    const migration = await readFile(new URL('./052_free_plan_allowances.sql', import.meta.url), 'utf8')
    await db.query(migration); await db.query(migration)
    assert.deepEqual((await db.query('SELECT grandfather_cutoff,enforced,(SELECT count(*) FROM public.perpetual_licences) AS licences FROM public.billing_configuration')).rows[0], before)
    await db.query('UPDATE public.billing_configuration SET enforced=true')
    await db.query("SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    const owner = crypto.randomUUID(), stranger = crypto.randomUUID()
    await db.query('INSERT INTO auth.users(id,created_at) VALUES($1,clock_timestamp()),($2,clock_timestamp())', [owner, stranger])
    const binder = (await db.query('SELECT public.ensure_default_binder($1) AS id', [owner])).rows[0].id
    assert.equal((await db.query('SELECT public.ensure_default_binder($1) AS id', [owner])).rows[0].id, binder)
    const access = (await db.query('SELECT public.get_billing_access($1) AS access', [owner])).rows[0].access
    assert.equal(access.free_card_limit, 100); assert.equal(access.free_binder_limit, 1)
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) SELECT $1,$2,n,'Synthetic free-plan verification','collected' FROM generate_series(1,100)n", [owner, binder])
    await denied("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,101,'Synthetic extra','collected')", [owner, binder], /card_limit_reached/)
    await denied("UPDATE public.pokemon_collection SET wanted_cards='[{}]' WHERE user_id=$1 AND pokemon_id=1", [owner], /card_limit_reached/)
    await denied("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic extra')", [owner], /binder_limit_reached/)
    await db.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic replacement' WHERE user_id=$1", [owner])
    await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner])
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,101,'Synthetic lifetime','collected')", [owner, binder])
    await db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic lifetime binder')", [owner])
    await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner])
    await db.query('UPDATE public.billing_configuration SET free_card_limit=10,free_binder_limit=20')
    await db.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic rollback edit' WHERE user_id=$1", [owner])
    await db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic rollback binder')", [owner])
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 101)
    await db.query('UPDATE public.billing_configuration SET free_card_limit=100,free_binder_limit=1')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)", [owner, JSON.stringify({ sub: owner, role: 'authenticated' })])
    await db.query('SET LOCAL ROLE authenticated')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 101)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [stranger])).rows[0].n, 0)
    await denied('UPDATE public.billing_configuration SET free_card_limit=999', [])
    await db.query('RESET ROLE')
    const plan = await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT public.get_billing_access($1)', [owner])
    assert.ok(plan.rows.length)
    console.log('Hosted schema: migration twice, unchanged cutoff/licences/enforcement, 100-entry cap, wanted weighting, first/default binder, lifetime bypass, over-limit edits, rollback and owner/configuration permissions passed; all rolled back')
  } finally { await db.query('ROLLBACK') }
}

async function main() {
  const connectionString = process.env.FREE_PLAN_TEST_DATABASE_URL
  const hosted = process.argv.includes('--hosted-rollback')
  if (!connectionString) throw new Error('Set FREE_PLAN_TEST_DATABASE_URL explicitly')
  const url = new URL(connectionString)
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
  if (!local && !hosted) throw new Error('Remote verification requires --hosted-rollback')
  url.searchParams.delete('sslmode')
  const options = { connectionString: url.toString(), ...(!local ? { ssl: { rejectUnauthorized: false } } : {}), connectionTimeoutMillis: 10000 }
  const a = new pg.Client(options), b = new pg.Client(options)
  await a.connect()
  try {
    if (hosted) { await verifyHosted(a); return }
    await b.connect()
    await a.query(await readFile(new URL('../tests/billing-access-migration.sql', import.meta.url), 'utf8'))
    await a.query(`ALTER TABLE public.binders ADD COLUMN name text DEFAULT 'Synthetic binder', ADD COLUMN is_default boolean DEFAULT false;
      CREATE UNIQUE INDEX synthetic_default_binder ON public.binders(owner_user_id) WHERE is_default;`)
    await a.query(await readFile(new URL('./049_billing_access.sql', import.meta.url), 'utf8'))
    const cutoff = (await a.query('SELECT grandfather_cutoff FROM public.billing_configuration')).rows[0].grandfather_cutoff
    const migration = await readFile(new URL('./052_free_plan_allowances.sql', import.meta.url), 'utf8')
    await a.query(migration); await a.query(migration)
    assert.deepEqual((await a.query('SELECT grandfather_cutoff FROM public.billing_configuration')).rows[0].grandfather_cutoff, cutoff)
    const owner = crypto.randomUUID(), binder = crypto.randomUUID(), other = crypto.randomUUID(), newcomer = crypto.randomUUID()
    await a.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner, newcomer])
    assert.equal((await a.query('SELECT public.get_billing_access($1) AS access', [owner])).rows[0].access.free_card_limit, 100)
    assert.equal((await a.query('SELECT public.get_billing_access($1) AS access', [owner])).rows[0].access.free_binder_limit, 1)
    await a.query('INSERT INTO public.binders(id,owner_user_id,is_default) VALUES($1,$2,true),($3,$2,false)', [binder, owner, other])
    await a.query('UPDATE public.billing_configuration SET enforced=true')
    await a.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,status) SELECT $1,$2,n,'collected' FROM generate_series(1,99)n", [owner, binder])
    const add = (db: pg.Client, id: string, n: number) => db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,status) VALUES($1,$2,$3,'collected')", [owner, id, n])
    const results = await Promise.allSettled([add(a, binder, 100), add(b, other, 101)])
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, 'only one concurrent save at 99 may succeed')
    assert.equal((await a.query('SELECT count(*)::int AS n FROM public.pokemon_collection WHERE user_id=$1', [owner])).rows[0].n, 100)
    await assert.rejects(a.query("UPDATE public.pokemon_collection SET wanted_cards='[{}]' WHERE user_id=$1 AND pokemon_id=1", [owner]), /card_limit_reached/)
    await a.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic renamed' WHERE user_id=$1", [owner])
    await assert.rejects(a.query('INSERT INTO public.binders(owner_user_id) VALUES($1)', [owner]), /binder_limit_reached/)
    await a.query("UPDATE public.binders SET name='Synthetic existing extra' WHERE id=$1", [other])
    const firstBinders = await Promise.allSettled([a, b].map(db => db.query('INSERT INTO public.binders(owner_user_id) VALUES($1)', [newcomer])))
    assert.equal(firstBinders.filter(r => r.status === 'fulfilled').length, 1, 'only one concurrent first binder may succeed')
    const defaultOwner = crypto.randomUUID()
    await a.query('INSERT INTO auth.users(id) VALUES($1)', [defaultOwner])
    await Promise.all([a, b].map(db => db.query('INSERT INTO public.binders(owner_user_id,is_default) VALUES($1,true) ON CONFLICT(owner_user_id) WHERE is_default DO NOTHING', [defaultOwner])))
    assert.equal((await a.query('SELECT count(*)::int AS n FROM public.binders WHERE owner_user_id=$1', [defaultOwner])).rows[0].n, 1)
    await a.query('UPDATE public.billing_configuration SET free_card_limit=10,free_binder_limit=20')
    await a.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic after rollback' WHERE user_id=$1", [owner])
    await assert.rejects(add(a, other, 102), /card_limit_reached/)
    await a.query('INSERT INTO public.binders(owner_user_id) VALUES($1)', [owner])
    await a.query('UPDATE public.billing_configuration SET free_card_limit=100,free_binder_limit=1')
    await a.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner])
    await add(a, other, 103)
    await a.query('INSERT INTO public.binders(owner_user_id) SELECT $1 FROM generate_series(1,17)', [owner])
    await assert.rejects(a.query('INSERT INTO public.binders(owner_user_id) VALUES($1)', [owner]), /binder_safety_limit_reached/)
    await assert.rejects(a.query('UPDATE public.binders SET owner_user_id=$1 WHERE id=$2', [newcomer, other]), /owner cannot be changed/)
    await a.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner])
    await a.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic expired' WHERE user_id=$1", [owner])
    await a.query('DELETE FROM public.pokemon_collection WHERE user_id=$1 AND pokemon_id=1', [owner])
    await assert.rejects(add(a, other, 104), /card_limit_reached/)
    await a.query('DELETE FROM public.pokemon_collection WHERE user_id=$1 AND pokemon_id=2', [owner])
    await add(a, other, 104)
    await a.query('BEGIN')
    const plan = await a.query('EXPLAIN (ANALYZE,BUFFERS) SELECT public.get_billing_access($1)', [owner])
    assert.ok(plan.rows.length)
    await a.query('ROLLBACK')
    console.log('Free plan: double migration, 100-entry concurrent cap across binders, wanted weighting, non-growing edits, one-binder race, default creation, lifetime bypass, expiry, safety ceiling and data-preserving rollback passed')
  } finally { await a.end(); await b.end() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Free-plan verification failed'); process.exitCode = 1 })
