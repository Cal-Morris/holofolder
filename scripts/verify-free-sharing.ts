// Explicit hosted verification, all schema changes and synthetic fixtures are rolled back.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

async function main() {
  const connectionString = process.env.FREE_SHARING_TEST_DATABASE_URL
  if (!connectionString || !process.argv.includes('--hosted-rollback')) throw new Error('Set FREE_SHARING_TEST_DATABASE_URL explicitly and pass --hosted-rollback')
  const url = new URL(connectionString); url.searchParams.delete('sslmode')
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  const db = new pg.Client({ connectionString: url.toString(), ...(!local ? { ssl: { rejectUnauthorized: false } } : {}), connectionTimeoutMillis: 10000 })
  await db.connect()
  const owner = crypto.randomUUID(), stranger = crypto.randomUUID(), partner = crypto.randomUUID()
  const authenticate = async (id: string) => {
    await db.query('RESET ROLE')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, role: 'authenticated' })])
    await db.query('SET LOCAL ROLE authenticated')
  }
  const denied = async (sql: string, values: unknown[]) => {
    await db.query('SAVEPOINT expected_failure')
    await assert.rejects(db.query(sql, values), { code: '42501' })
    await db.query('ROLLBACK TO SAVEPOINT expected_failure')
  }
  try {
    await db.query('BEGIN')
    const ownerPolicies = (await db.query("SELECT policyname,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='binder_shares' AND permissive='PERMISSIVE' ORDER BY policyname")).rows
    assert.equal(ownerPolicies.length, 4)
    const migration = await readFile(new URL('./053_free_binder_sharing.sql', import.meta.url), 'utf8')
    await db.query(migration); await db.query(migration)
    assert.deepEqual((await db.query("SELECT policyname,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='binder_shares' AND permissive='PERMISSIVE' ORDER BY policyname")).rows, ownerPolicies)
    await db.query('UPDATE public.billing_configuration SET enforced=true')
    await db.query('INSERT INTO auth.users(id,created_at) VALUES($1,clock_timestamp()),($2,clock_timestamp()),($3,clock_timestamp())', [owner, stranger, partner])
    const binder = (await db.query('SELECT public.ensure_default_binder($1) AS id', [owner])).rows[0].id
    const strangerBinder = (await db.query('SELECT public.ensure_default_binder($1) AS id', [stranger])).rows[0].id
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner])
    assert.equal((await db.query('SELECT public.billing_partner_allowed($1,$2) AS allowed', [owner, partner])).rows[0].allowed, false)
    await authenticate(owner)
    await db.query("INSERT INTO public.binder_shares(owner_user_id,binder_id,token,is_enabled) VALUES($1,$2,$3,true)", [owner, binder, `synthetic-${crypto.randomUUID()}`])
    await db.query('UPDATE public.binder_shares SET is_enabled=false WHERE owner_user_id=$1', [owner])
    await db.query('UPDATE public.binder_shares SET is_enabled=true WHERE owner_user_id=$1', [owner])
    assert.equal((await db.query('SELECT is_enabled FROM public.binder_shares WHERE owner_user_id=$1', [owner])).rows[0].is_enabled, true)
    const plan = await db.query('EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM public.binder_shares WHERE owner_user_id=$1', [owner])
    assert.ok(plan.rows.length)
    await authenticate(stranger)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.binder_shares WHERE owner_user_id=$1', [owner])).rows[0].n, 0)
    assert.equal((await db.query('UPDATE public.binder_shares SET is_enabled=false WHERE owner_user_id=$1', [owner])).rowCount, 0)
    assert.equal((await db.query('DELETE FROM public.binder_shares WHERE owner_user_id=$1', [owner])).rowCount, 0)
    await denied("INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,$3)", [owner, binder, `synthetic-${crypto.randomUUID()}`])
    await db.query('RESET ROLE'); await db.query('SET LOCAL ROLE anon')
    await db.query('SAVEPOINT anonymous_read')
    try {
      assert.equal((await db.query('SELECT count(*)::int AS n FROM public.binder_shares')).rows[0].n, 0)
    } catch (error) {
      if (!(error instanceof pg.DatabaseError) || error.code !== '42501') throw error
      await db.query('ROLLBACK TO SAVEPOINT anonymous_read')
    }
    await db.query('RESET ROLE')
    await db.query("CREATE POLICY billing_share_insert ON public.binder_shares AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id)); CREATE POLICY billing_share_update ON public.binder_shares AS RESTRICTIVE FOR UPDATE TO authenticated WITH CHECK (NOT is_enabled OR NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id))")
    await authenticate(owner)
    await db.query('UPDATE public.binder_shares SET is_enabled=false WHERE owner_user_id=$1', [owner])
    await denied('UPDATE public.binder_shares SET is_enabled=true WHERE owner_user_id=$1', [owner])
    await authenticate(stranger)
    await denied("INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,$3)", [stranger, strangerBinder, `synthetic-${crypto.randomUUID()}`])
    await db.query('RESET ROLE')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.binder_shares WHERE owner_user_id=$1', [owner])).rows[0].n, 1)
    assert.equal((await db.query('SELECT public.billing_partner_allowed($1,$2) AS allowed', [owner, partner])).rows[0].allowed, false)
    console.log('Free sharing: migration twice, owner create/disable/re-enable, unchanged owner policies, stranger/anonymous denial, paid partner boundary and data-preserving rollback passed; all rolled back')
  } finally { await db.query('ROLLBACK'); await db.end() }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Free-sharing verification failed'); process.exitCode = 1 })
