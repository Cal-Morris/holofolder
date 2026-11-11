// Hosted verification uses synthetic users and rolls back the migration and every data change.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { defaultBinderDesign } from '../lib/binder-design';

async function main() {
  if (!process.argv.includes('--hosted-rollback')) throw new Error('Pass --hosted-rollback');
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('No database connection configured');
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  const db = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  const owner = crypto.randomUUID(),
    partner = crypto.randomUUID(),
    stranger = crypto.randomUUID();
  const denied = async (sql: string, params: unknown[], message: RegExp) => {
    await db.query('SAVEPOINT expected_failure');
    await assert.rejects(db.query(sql, params), message);
    await db.query('ROLLBACK TO SAVEPOINT expected_failure');
  };
  const authenticate = async (id: string) => {
    await db.query('RESET ROLE');
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',$2,true)",
      [id, JSON.stringify({ sub: id, role: 'authenticated' })],
    );
    await db.query('SET LOCAL ROLE authenticated');
  };
  try {
    await db.query('BEGIN');
    const migration = await readFile(new URL('./057_custom_binder_layouts.sql', import.meta.url), 'utf8');
    await db.query(migration);
    await db.query(migration);
    await db.query('UPDATE public.billing_configuration SET enforced=true');
    await db.query(
      "INSERT INTO auth.users(id,created_at) VALUES($1,now()-interval '30 days'),($2,now()-interval '30 days'),($3,now()-interval '30 days')",
      [owner, partner, stranger],
    );
    const binder = (await db.query('SELECT public.ensure_default_binder($1) AS id', [owner])).rows[0].id;
    await authenticate(owner);
    await denied('UPDATE public.binders SET binder_rows=8 WHERE id=$1', [binder], /permission denied/);
    await db.query('RESET ROLE');
    await db.query('UPDATE public.binders SET binder_rows=3,binder_cols=4 WHERE id=$1', [binder]);
    await denied('UPDATE public.binders SET binder_rows=8,binder_cols=8 WHERE id=$1', [binder], /upgrade_required/);
    await denied(
      'INSERT INTO public.user_settings(user_id,binder_rows,binder_cols) VALUES($1,8,8)',
      [owner],
      /upgrade_required/,
    );
    await db.query('RESET ROLE');
    await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner]);
    await db.query(
      "SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)",
    );
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
      owner,
      partner,
    ]);
    const other = (
      await db.query(
        "INSERT INTO public.binders(owner_user_id,name,binder_rows,binder_cols) VALUES($1,'Synthetic other binder',2,2) RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await authenticate(partner);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.binders WHERE id=$1', [binder])).rows[0].n, 1);
    await db.query('RESET ROLE');
    await db.query('UPDATE public.binders SET binder_rows=8,binder_cols=8 WHERE id=$1', [binder]);
    assert.deepEqual(
      (await db.query('SELECT binder_rows,binder_cols FROM public.binders WHERE id=$1', [other])).rows[0],
      { binder_rows: 2, binder_cols: 2 },
    );
    await denied(
      'UPDATE public.binders SET binder_rows=9 WHERE id=$1',
      [binder],
      /Invalid binder layout|binders_grid_check/,
    );
    await db.query('RESET ROLE');
    const design = { ...defaultBinderDesign(), rows: 8, cols: 8 };
    await db.query('INSERT INTO public.binder_appearances(owner_user_id,design,revision) VALUES($1,$2,1)', [
      owner,
      JSON.stringify(design),
    ]);
    await db.query('INSERT INTO public.user_settings(user_id,binder_rows,binder_cols) VALUES($1,8,8)', [owner]);
    await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner]);
    await authenticate(owner);
    assert.equal(
      (await db.query('SELECT binder_rows FROM public.binders WHERE id=$1', [binder])).rows[0].binder_rows,
      8,
    );
    await db.query('RESET ROLE');
    await db.query("UPDATE public.binders SET name='Synthetic retained layout' WHERE id=$1", [binder]);
    await db.query('UPDATE public.user_settings SET dark_mode=false WHERE user_id=$1', [owner]);
    await denied('UPDATE public.binders SET binder_cols=7 WHERE id=$1', [binder], /upgrade_required/);
    await db.query('UPDATE public.binders SET binder_rows=4,binder_cols=4 WHERE id=$1', [binder]);
    await db.query('RESET ROLE');
    await db.query(
      "UPDATE public.binder_appearances SET design=jsonb_set(design,'{name}','\"Synthetic retained appearance\"') WHERE owner_user_id=$1",
      [owner],
    );
    await denied(
      "UPDATE public.binder_appearances SET design=jsonb_set(design,'{cols}','7') WHERE owner_user_id=$1",
      [owner],
      /upgrade_required/,
    );
    await denied(
      "UPDATE public.binder_appearances SET design=jsonb_set(design,'{cols}','2.5') WHERE owner_user_id=$1",
      [owner],
      /Invalid binder layout/,
    );
    await authenticate(stranger);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1', [owner])).rows[0].n,
      0,
    );
    await db.query('RESET ROLE');
    const plan = await db.query(
      'EXPLAIN (ANALYZE,BUFFERS) UPDATE public.binders SET binder_rows=4,binder_cols=4 WHERE id=$1',
      [binder],
    );
    assert.ok(plan.rows.length);
    console.log(
      'Migration twice, free presets, premium gate, owner/partner writes, binder isolation, bounds, retained layouts after expiry, free reset, settings/appearance bypass protection and stranger RLS passed; all rolled back',
    );
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Layout verification failed');
  process.exitCode = 1;
});
