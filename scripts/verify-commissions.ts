// Explicit verification of migration 140 only. The transaction and every synthetic record roll back.
// COMMISSIONS_TEST_DATABASE_URL=postgresql://... bun scripts/verify-commissions.ts --hosted-rollback
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  if (!process.argv.includes('--hosted-rollback') || !process.env.COMMISSIONS_TEST_DATABASE_URL)
    throw new Error('Set COMMISSIONS_TEST_DATABASE_URL explicitly and pass --hosted-rollback.');
  const url = new URL(process.env.COMMISSIONS_TEST_DATABASE_URL);
  url.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  const [affiliate, customer, stranger] = [1, 2, 3].map(() => crypto.randomUUID());
  const one = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)).rows[0];
  const as = async (role: 'authenticated' | 'anon' | 'service_role', sub?: string) => {
    await db.query('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role, sub })]);
    await db.query(`SET LOCAL ROLE ${role}`);
  };
  const earning = (id: string, ref: string, paid: number, commission: number) =>
    db.query(
      `INSERT INTO public.commission_entries(affiliate_owner_id,customer_owner_id,kind,stripe_object_id,stripe_payment_ref,
        amount_paid_pence,rate_bps,commission_pence,occurred_at,hold_until)
       VALUES($1,$2,'subscription',$3,$4,$5,3000,$6,now(),now()+interval '30 days')
       ON CONFLICT (stripe_object_id) DO NOTHING`,
      [affiliate, customer, id, ref, paid, commission],
    );
  const adjust = async (ref: string, key: string, remaining: number) =>
    (await one('SELECT public.commission_adjust_v1($1,$2,$3,now()) d', [ref, key, remaining])).d;
  const net = async (ref: string) =>
    Number(
      (await one(`SELECT sum(commission_pence) n FROM public.commission_entries WHERE stripe_payment_ref=$1`, [ref])).n,
    );
  try {
    await db.query('BEGIN');
    const migration = await readFile(new URL('./140_commission_programme.sql', import.meta.url), 'utf8');
    await db.query(migration);
    await db.query(migration);
    await db.query('INSERT INTO auth.users(id,created_at) VALUES($1,now()),($2,now()),($3,now())', [
      affiliate,
      customer,
      stranger,
    ]);
    await as('service_role');
    await db.query(
      `INSERT INTO public.affiliates(owner_user_id,display_name,payout_email,stripe_promotion_code_id,promotion_code)
       VALUES($1,'Synthetic creator','payouts@example.test','promo_SYNTHETIC','SYNTHETIC')`,
      [affiliate],
    );
    await db.query(
      `INSERT INTO public.affiliate_customers(customer_owner_id,affiliate_owner_id,source,stripe_checkout_session_id,attributed_at)
       VALUES($1,$2,'promotion_code','cs_synthetic',now())`,
      [customer, affiliate],
    );
    // One affiliate per customer and never self.
    const first = await db.query(
      `INSERT INTO public.affiliate_customers VALUES($1,$2,'invite','cs_other',now()) ON CONFLICT DO NOTHING`,
      [customer, affiliate],
    );
    assert.equal(first.rowCount, 0, 'first touch only');
    await db.query('SAVEPOINT s');
    await assert.rejects(
      db.query(`INSERT INTO public.affiliate_customers VALUES($1,$1,'invite','cs_self',now())`, [affiliate]),
      /check/,
    );
    await db.query('ROLLBACK TO SAVEPOINT s');

    // Idempotent earnings: a replayed invoice records once.
    await earning('in_synthetic', 'pi_synthetic', 399, 119);
    await earning('in_synthetic', 'pi_synthetic', 399, 119);
    assert.equal(await net('pi_synthetic'), 119);

    // Refunds and disputes converge on 30% of what is still paid, whatever the order; a replayed event is a no-op.
    assert.equal(await adjust('pi_unknown', 'adjust:evt_unknown', 0), null, 'unrelated charge');
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_refund', 299), -30, 'partial refund');
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_refund', 0), 0, 'replay');
    assert.equal(await net('pi_synthetic'), 89);
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_dispute', 0), -89, 'dispute holds the money');
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_refund_late', 0), 0, 'late refund event during the dispute');
    assert.equal(await net('pi_synthetic'), 0);
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_won', 299), 89, 'won dispute restores what was not refunded');
    assert.equal(await adjust('pi_synthetic', 'adjust:evt_over', 99999), 30, 'clamped to the amount paid');
    assert.equal(await net('pi_synthetic'), 119);
    const held = await one(
      `SELECT bool_and(a.hold_until >= e.hold_until) ok FROM public.commission_entries a
       JOIN public.commission_entries e ON e.id=a.earning_id WHERE a.stripe_payment_ref='pi_synthetic'`,
    );
    assert.equal(held.ok, true, 'adjustments share the earning hold');

    // RLS and column privileges.
    await as('authenticated', affiliate);
    assert.equal(
      Number((await one('SELECT count(*) c FROM public.commission_entries')).c),
      5,
      'affiliate reads own entries',
    );
    assert.equal((await one('SELECT display_name, promotion_code FROM public.affiliates')).promotion_code, 'SYNTHETIC');
    for (const sql of [
      'SELECT payout_email FROM public.affiliates',
      'SELECT customer_owner_id FROM public.commission_entries',
      'SELECT stripe_payment_ref FROM public.commission_entries',
      'SELECT * FROM public.affiliate_customers',
      `INSERT INTO public.commission_entries(affiliate_owner_id,kind,stripe_object_id,amount_paid_pence,rate_bps,
        commission_pence,occurred_at,hold_until) VALUES('${affiliate}','lifetime','cs_forged',7900,3000,2370,now(),now())`,
      `UPDATE public.commission_entries SET status='paid', paid_out_at=now()`,
      "SELECT public.commission_adjust_v1('pi_synthetic','forged',0,now())",
    ]) {
      await db.query('SAVEPOINT s');
      await assert.rejects(db.query(sql), /permission denied/, sql);
      await db.query('ROLLBACK TO SAVEPOINT s');
    }
    const plan = (
      await db.query(
        `EXPLAIN (ANALYZE, FORMAT TEXT) SELECT commission_pence,status,hold_until FROM public.commission_entries
         WHERE affiliate_owner_id=$1 ORDER BY id`,
        [affiliate],
      )
    ).rows
      .map((r) => r['QUERY PLAN'])
      .join('\n');
    console.log(plan);
    await as('authenticated', stranger);
    assert.equal(Number((await one('SELECT count(*) c FROM public.commission_entries')).c), 0, 'stranger sees none');
    assert.equal(Number((await one('SELECT count(*) c FROM public.affiliates')).c), 0);
    await as('anon');
    await db.query('SAVEPOINT s');
    await assert.rejects(db.query('SELECT id FROM public.commission_entries'), /permission denied/);
    await db.query('ROLLBACK TO SAVEPOINT s');

    // Customer deletion keeps the affiliate's earnings; affiliate deletion removes their ledger.
    await db.query('RESET ROLE');
    await db.query('DELETE FROM auth.users WHERE id=$1', [customer]);
    assert.equal(
      Number(
        (await one('SELECT count(*) c FROM public.commission_entries WHERE affiliate_owner_id=$1', [affiliate])).c,
      ),
      5,
    );
    await db.query('DELETE FROM auth.users WHERE id=$1', [affiliate]);
    assert.equal(
      Number(
        (await one('SELECT count(*) c FROM public.commission_entries WHERE stripe_payment_ref=$1', ['pi_synthetic'])).c,
      ),
      0,
    );
    console.log('Migration 140 verified; rolling back.');
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
