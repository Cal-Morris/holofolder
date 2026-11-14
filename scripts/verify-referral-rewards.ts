// Explicit verification of migration 133 only. The transaction and every synthetic record roll back.
// REFERRAL_REWARDS_TEST_DATABASE_URL=postgresql://... bun scripts/verify-referral-rewards.ts --hosted-rollback
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  if (!process.argv.includes('--hosted-rollback') || !process.env.REFERRAL_REWARDS_TEST_DATABASE_URL)
    throw new Error('Set REFERRAL_REWARDS_TEST_DATABASE_URL explicitly and pass --hosted-rollback.');
  const url = new URL(process.env.REFERRAL_REWARDS_TEST_DATABASE_URL);
  url.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  const [inviter, invitee, old, partner] = [1, 2, 3, 4].map(() => crypto.randomUUID());
  const one = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0];
  const service = (sql: string, values: unknown[] = []) => one(sql, values);
  const days = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
  const saveTen = (owner: string) =>
    db.query(
      `WITH s AS (INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1::uuid) RETURNING owner_user_id) INSERT INTO public.inventory_items(id,owner_user_id,identity) SELECT 'verify-'||$1::text||'-'||n,$1::uuid,'{"kind":"card","cardId":"synthetic-verify","finish":"normal","language":"en"}' FROM s, generate_series(1,10) n`,
      [owner],
    );
  try {
    await db.query('BEGIN');
    const migration = await readFile(new URL('./133_premium_grants_and_referrals.sql', import.meta.url), 'utf8');
    await db.query(migration);
    await db.query(migration);
    await db.query(
      "INSERT INTO auth.users(id,created_at) VALUES($1,now()-interval '30 days'),($2,now()),($3,now()-interval '30 days'),($4,now())",
      [inviter, invitee, old, partner],
    );
    await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
      inviter,
      partner,
    ]);
    await db.query('SET LOCAL ROLE service_role');
    await db.query(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true)`);

    const code = (await service('SELECT public.referral_code_v1($1) c', [inviter])).c;
    assert.match(code, /^[a-z2-9]{10}$/);
    assert.equal((await service('SELECT public.referral_code_v1($1) c', [inviter])).c, code, 'stable code');

    const attribute = async (who: string, c: string, clicked = "now()-interval '1 hour'") =>
      (await service(`SELECT public.attribute_referral_v1($1,$2,${clicked}) s`, [who, c])).s;
    assert.equal(await attribute(invitee, 'zzzzzzzzzz'), 'unknown_code');
    assert.equal(await attribute(inviter, code), 'self');
    assert.equal(await attribute(old, code), 'not_new', 'existing account');
    assert.equal(await attribute(invitee, code, "now()+interval '1 minute'"), 'not_new', 'created before the click');
    assert.equal(await attribute(partner, code), 'partner');
    assert.equal(await attribute(invitee, code), 'attributed');
    const otherCode = (await service('SELECT public.referral_code_v1($1) c', [old])).c;
    assert.equal(await attribute(invitee, otherCode), 'already_attributed', 'first touch only');

    const claim = async (who: string) => (await service('SELECT public.claim_referral_reward_v1($1) s', [who])).s;
    assert.equal(await claim(invitee), 'not_activated');
    assert.equal((await service('SELECT public.billing_has_paid($1) p', [inviter])).p, false);
    await saveTen(invitee);
    assert.equal(await claim(invitee), 'rewarded');
    assert.equal(await claim(invitee), 'already_rewarded', 'one reward per invitee');
    const grants = (
      await db.query(
        'SELECT owner_user_id,reason,starts_at,ends_at FROM public.premium_grants WHERE owner_user_id IN ($1,$2)',
        [inviter, invitee],
      )
    ).rows;
    assert.equal(grants.length, 2);
    const mine = grants.find((g) => g.owner_user_id === invitee)!;
    // Trial overlap: the invitee's month starts when their 7-day trial ends.
    assert.ok(Math.abs(days(new Date(), mine.starts_at) - 7) < 0.01, 'invitee grant chains after the trial');
    assert.equal(Math.round(days(mine.starts_at, mine.ends_at)), 30);
    const access = (await service('SELECT public.get_billing_access($1) a', [inviter])).a;
    assert.ok(Math.abs(days(new Date(), access.granted_until) - 30) < 0.01);
    assert.equal(access.referral_pending, false);
    assert.equal((await service('SELECT public.billing_has_paid($1) p', [inviter])).p, true);
    assert.equal((await service('SELECT public.get_billing_access($1) a', [invitee])).a.referral_pending, false);

    // Inviter cap: 12 rewarded invites, chained back to back; later invitees still get their own month.
    for (let i = 0; i < 12; i++) {
      const friend = crypto.randomUUID();
      await db.query('RESET ROLE');
      await db.query('INSERT INTO auth.users(id,created_at) VALUES($1,now())', [friend]);
      await db.query('SET LOCAL ROLE service_role');
      assert.equal(await attribute(friend, code), 'attributed');
      await saveTen(friend);
      assert.equal(await claim(friend), 'rewarded');
      if (i === 11)
        assert.equal(
          (await service('SELECT count(*)::int n FROM public.premium_grants WHERE owner_user_id=$1', [friend])).n,
          1,
        );
    }
    const chain = await service(
      "SELECT count(*)::int n, min(starts_at) s, max(ends_at) e FROM public.premium_grants WHERE owner_user_id=$1 AND reason='referral_inviter'",
      [inviter],
    );
    assert.equal(chain.n, 12);
    assert.equal(Math.round(days(chain.s, chain.e)), 360, 'contiguous, capped at 12 months');

    // Owners read only their own rows; clients cannot write or call the trusted functions.
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: invitee, role: 'authenticated' }),
    ]);
    await db.query('SET LOCAL ROLE authenticated');
    assert.equal((await one('SELECT count(*)::int n FROM public.premium_grants')).n, 1);
    assert.equal((await one('SELECT count(*)::int n FROM public.referrals')).n, 1);
    assert.equal((await one('SELECT count(*)::int n FROM public.referral_codes')).n, 0);
    for (const sql of [
      "INSERT INTO public.premium_grants(owner_user_id,starts_at,ends_at,reason) VALUES('" +
        invitee +
        "',now(),now()+interval '1 year','referral_invitee')",
      `SELECT public.claim_referral_reward_v1('${invitee}')`,
      `SELECT public.attribute_referral_v1('${invitee}','${code}',now())`,
      `SELECT public.referral_code_v1('${invitee}')`,
    ]) {
      await db.query('SAVEPOINT denied');
      await assert.rejects(db.query(sql), { code: '42501' });
      await db.query('ROLLBACK TO SAVEPOINT denied');
    }
    const plan = (await db.query('EXPLAIN ANALYZE SELECT public.get_billing_access($1)', [invitee])).rows
      .map((r) => r['QUERY PLAN'])
      .join('\n');
    console.log(plan);

    // Deleting the invitee keeps the inviter's earned month.
    await db.query('RESET ROLE');
    await db.query('DELETE FROM auth.users WHERE id=$1', [invitee]);
    assert.equal(
      (
        await one(
          "SELECT count(*)::int n FROM public.premium_grants WHERE owner_user_id=$1 AND reason='referral_inviter'",
          [inviter],
        )
      ).n,
      12,
    );
    console.log('referral rewards verified; rolling back');
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
    await db.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
