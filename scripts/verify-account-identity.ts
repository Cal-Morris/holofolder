import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

async function main() {
  const apply = process.argv.includes('--apply');
  assert.ok(
    process.argv.slice(2).every((arg) => arg === '--apply'),
    'Usage: verify-account-identity.ts [--apply]',
  );
  const connection = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
  assert.ok(connection && process.env.NEXT_PUBLIC_SUPABASE_URL, 'Project database configuration is required');
  const target = new URL(connection);
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  assert.ok(
    target.hostname.startsWith(`db.${project}.`) || target.username.includes(project),
    'Database must match configured Supabase project',
  );
  target.searchParams.set('sslmode', 'no-verify');
  const client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 });
  const sql = await readFile(new URL('./047_account_usernames.sql', import.meta.url), 'utf8');
  let checks = 0;
  try {
    await client.connect();
    const before = (
      await client.query(
        "select to_regclass('public.account_identities') as identity, to_regclass('public.account_username_reservations') as reservations",
      )
    ).rows[0];
    console.log(JSON.stringify({ targetMatchesProject: true, existingSchema: before }));
    await client.query('begin');
    await client.query(sql);
    await client.query(sql);
    const actor = crypto.randomUUID(),
      other = crypto.randomUUID();
    await client.query('insert into auth.users(id) values ($1),($2)', [actor, other]);
    const asUser = async (id: string) => {
      await client.query('reset role');
      await client.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: id, role: 'authenticated' }),
      ]);
      await client.query('set local role authenticated');
    };
    const claim = async (name: string) =>
      (await client.query('select public.claim_account_username($1) as username', [name])).rows[0].username;
    const denied = async (query: string, params: unknown[], code: string) => {
      await client.query('savepoint expected_failure');
      await assert.rejects(
        client.query(query, params),
        (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === code,
      );
      await client.query('rollback to savepoint expected_failure');
      checks++;
    };
    await asUser(actor);
    assert.equal(await claim(' Synthetic-Cal '), 'synthetic-cal');
    assert.equal(await claim('synthetic-new'), 'synthetic-new');
    assert.equal(await claim('synthetic-cal'), 'synthetic-cal', 'Original owner can reclaim a reservation');
    await denied('select public.claim_account_username($1)', ['c/'], '22023');
    await denied('update public.account_identities set username=$1', ['hijack'], '42501');
    await denied('select * from public.account_username_reservations', [], '42501');
    await asUser(other);
    assert.equal(
      (await client.query('select * from public.account_identities')).rowCount,
      0,
      'Another account cannot read private identity',
    );
    await denied('select public.claim_account_username($1)', ['SYNTHETIC-CAL'], '23505');
    await denied('select public.claim_account_username($1)', ['synthetic-new'], '23505');
    assert.equal(await claim('synthetic-other'), 'synthetic-other');
    await client.query('reset role');
    await client.query('delete from auth.users where id=$1', [actor]);
    assert.equal((await client.query('select * from public.account_identities where user_id=$1', [actor])).rowCount, 0);
    await asUser(other);
    await denied('select public.claim_account_username($1)', ['synthetic-cal'], '23505');
    await client.query('reset role');
    await client.query('set local role anon');
    await denied('select public.claim_account_username($1)', ['synthetic-anon'], '42501');
    await denied('select * from public.account_identities', [], '42501');
    await client.query('reset role');
    await asUser(other);
    const plan = await client.query(
      'explain (analyze, buffers, format json) select username from public.account_identities where user_id=$1',
      [other],
    );
    assert.ok(plan.rows[0]['QUERY PLAN'][0]['Execution Time'] >= 0);
    await client.query('rollback');
    if (apply && !before.identity && !before.reservations) {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
    } else if (apply) {
      assert.ok(before.identity && before.reservations, 'Partial existing schema requires inspection');
    }
    if (apply) {
      const schema = (
        await client.query(
          "select count(*)::int as tables from pg_class where oid in ('public.account_identities'::regclass,'public.account_username_reservations'::regclass) and relrowsecurity",
        )
      ).rows[0];
      assert.equal(schema.tables, 2);
      const actors = (await client.query('select id from auth.users order by id limit 2')).rows;
      assert.equal(actors.length, 2, 'Two existing accounts required for rolled-back concurrency verification');
      const competing = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 10_000 });
      try {
        await competing.connect();
        await client.query('begin');
        await asUser(actors[0].id);
        const contested = `verify-${crypto.randomUUID().slice(0, 20)}`;
        assert.equal(await claim(contested), contested);
        await competing.query('begin');
        await competing.query("set local lock_timeout = '300ms'");
        await competing.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: actors[1].id, role: 'authenticated' }),
        ]);
        await competing.query('set local role authenticated');
        await assert.rejects(
          competing.query('select public.claim_account_username($1)', [contested]),
          (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '55P03',
        );
        checks++;
      } finally {
        await competing.query('rollback').catch(() => undefined);
        await competing.end();
        await client.query('rollback');
      }
    }
    console.log(
      JSON.stringify({
        verification: 'passed',
        syntheticWrites: 'rolled back',
        idempotentMigration: true,
        denialChecks: checks,
        applied: apply ? '047_account_usernames.sql' : false,
      }),
    );
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
});
