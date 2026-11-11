import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const migration = readFileSync(new URL('../scripts/102_storage_rls_owner_short_circuit.sql', import.meta.url), 'utf8');
const statements = migration.replace(/--.*$/gm, '');
const tables = [
  'inventory_owner_state',
  'storage_collection_state',
  'inventory_items',
  'binder_slots',
  'inventory_placements',
  'binder_legacy_rows',
];

test('102 only reorders the six storage read policies', () => {
  assert.doesNotMatch(
    statements,
    /DROP POLICY|CREATE POLICY|GRANT|REVOKE|CREATE (OR REPLACE )?FUNCTION|INDEX|ROW LEVEL SECURITY/i,
  );
  assert.deepEqual(statements.match(/(?<!select )auth\.uid\(\)/g) ?? [], []);
  assert.match(statements, /ALTER POLICY storage_owner_partner_read ON public\.%I USING/);
  assert.ok(statements.includes(`ARRAY[${tables.map((t) => `'${t}'`).join(',')}]`));
  // owner OR (partner AND billing): the billing helper never runs for the owner's own rows.
  assert.match(
    statements,
    /owner_user_id = \(select auth\.uid\(\)\) OR \(owner_user_id IN \(\s*SELECT p\.owner_user_id FROM public\.partnerships p WHERE p\.user1_id = \(select auth\.uid\(\)\) OR p\.user2_id = \(select auth\.uid\(\)\)\)\s*AND public\.billing_partner_allowed\(owner_user_id,\(select auth\.uid\(\)\)\)\)\)/,
  );
});

// Opt-in: a local database already migrated through 102 (e.g. the fresh-schema replay). Rolled back.
const socket = process.env.STORAGE_RLS_TEST_SOCKET;
const database = process.env.STORAGE_RLS_TEST_DATABASE;
test(
  '102 is repeatable and admits exactly the rows the 073 policy did',
  { skip: !socket || !database, timeout: 60000 },
  async () => {
    assert.equal(socket, '/Users/cal/.local/share/holofolder/rls-102-local/s');
    assert.match(database!, /^holofolder_fresh_[a-z0-9_]+$/);
    const db = new Client({ host: socket, port: 55602, user: 'rls102', database });
    await db.connect();
    const owner = '01020000-0000-4000-8000-000000000001',
      partner = '01020000-0000-4000-8000-000000000002';
    const solo = '01020000-0000-4000-8000-000000000003',
      stranger = '01020000-0000-4000-8000-000000000004';
    const policies =
      "SELECT tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2";
    try {
      await db.query('BEGIN');
      const before = (await db.query(policies)).rows;
      await db.query(migration);
      await db.query(migration);
      assert.deepEqual((await db.query(policies)).rows, before);
      await db.query('SET LOCAL session_replication_role = replica'); // synthetic seed only, skips audit capture
      await db.query(
        "INSERT INTO auth.users(id,created_at) VALUES ($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01'),($4,'2020-01-01')",
        [owner, partner, solo, stranger],
      );
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ($1,$2,$1)', [
        owner,
        partner,
      ]);
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES ($1),($2)', [owner, solo]);
      await db.query('SET LOCAL session_replication_role = origin');
      const scenarios: Array<[string, string, boolean]> = [
        ['not enforced', 'UPDATE public.billing_configuration SET enforced=false', true],
        ['unpaid', 'UPDATE public.billing_configuration SET enforced=true', false],
        [
          'expired',
          `INSERT INTO public.billing_accounts(owner_user_id,status,paid_through) VALUES ('${owner}','active',now()-interval '1 day')`,
          false,
        ],
        ['licence', `INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES ('${owner}','manual')`, true],
      ];
      await db.query(
        'INSERT INTO public.billing_configuration(id,enforced) VALUES (true,false) ON CONFLICT (id) DO NOTHING',
      );
      for (const [name, setup, partnerAllowed] of scenarios) {
        await db.query(setup);
        for (const actor of [owner, partner, solo, stranger, null]) {
          // Supabase reads request.jwt.claims; the fresh-schema fixture reads request.jwt.claim.sub.
          await db.query(
            "SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",
            [JSON.stringify(actor ? { sub: actor, role: 'authenticated' } : { role: 'authenticated' }), actor ?? ''],
          );
          const original =
            (
              await db.query(
                `SELECT array_agg(owner_user_id::text ORDER BY 1) o FROM public.inventory_owner_state s WHERE coalesce(((owner_user_id = $1::uuid) OR owner_user_id IN (SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = $1::uuid OR p.user2_id = $1::uuid)) AND public.billing_partner_allowed(owner_user_id,$1::uuid),false)`,
                [actor],
              )
            ).rows[0].o ?? [];
          await db.query('SET LOCAL ROLE authenticated');
          const visible =
            (await db.query('SELECT array_agg(owner_user_id::text ORDER BY 1) o FROM public.inventory_owner_state'))
              .rows[0].o ?? [];
          await db.query('RESET ROLE');
          assert.deepEqual(visible, original, `${name} / ${actor}`);
          const expected =
            actor === owner || (actor === partner && partnerAllowed) ? [owner] : actor === solo ? [solo] : [];
          assert.deepEqual(visible, expected, `${name} / ${actor}`);
        }
      }
    } finally {
      await db.query('ROLLBACK').catch(() => {});
      await db.end();
    }
  },
);
