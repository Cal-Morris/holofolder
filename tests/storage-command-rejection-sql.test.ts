import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
const socket = process.env.STORAGE_REJECTION_TEST_SOCKET;
const connection = (database = 'postgres') => {
  assert.equal(socket, '/Users/cal/.local/share/holofolder/issue363-rejection-089-local/s');
  return new Client({ host: socket, port: 55489, user: 'rejection_test', database });
};
const owner = '00890000-0000-4000-8000-000000000001',
  partner = '00890000-0000-4000-8000-000000000002',
  binder = '00890000-0000-4000-8000-000000000011';
async function seed(db: Client) {
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01');", [owner, partner]);
  await db.query('UPDATE public.billing_configuration SET enforced=false');
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner]);
  await db.query(
    "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic rejection',true)",
    [binder, owner],
  );
  await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
  await db.query(
    "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
    [binder, owner],
  );
  await db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
}
async function header(db: Client, id: string, actor = partner, source = 'app') {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [
    JSON.stringify({
      'x-holo-audit-context': JSON.stringify({
        actor: { kind: 'user', userId: actor },
        source,
        clientId: null,
        operationId: id,
        batchId: id,
        clientOccurredAt: null,
      }),
    }),
    JSON.stringify({ role: 'service_role' }),
  ]);
  await db.query('SET LOCAL ROLE service_role');
}
const command = (id: string, revision = 1) => ({
  operationId: id,
  inventoryRevision: revision,
  collections: [],
  commands: [
    {
      kind: 'add',
      itemId: `synthetic/${id}`,
      identity: { kind: 'pokemon', pokemonId: 1 },
      grading: null,
      acquiredAt: null,
    },
  ],
});
const call = async (db: Client, request: unknown, operation = 'inventory') =>
  (await db.query('SELECT public.storage_execute_v1($1,$2,$3) result', [operation, owner, request])).rows[0].result;
async function rejected(db: Client, run: () => Promise<unknown>, code: string) {
  await db.query('SAVEPOINT expected_error');
  await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code);
  await db.query('ROLLBACK TO SAVEPOINT expected_error');
}
test(
  '089 retains ACLs/helpers and rolls partial mutations back before lifetime terminal rejection',
  { skip: !socket, timeout: 60000 },
  async () => {
    const db = connection();
    await db.connect();
    try {
      const definitions = async () =>
        (
          await db.query(`SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,p.proacl::text,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','collection_audit_private') AND p.proname NOT IN ('storage_execute_v1','execute_command_v1') ORDER BY 1`)
        ).rows;
      const acls = async () =>
        (
          await db.query(
            `SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`,
          )
        ).rows;
      const before = await definitions(),
        beforeAcl = await acls();
      const migration = readFileSync(new URL('../scripts/089_storage_command_rejection.sql', import.meta.url), 'utf8');
      await db.query(migration);
      await db.query(migration);
      assert.deepEqual(await definitions(), before);
      assert.deepEqual(await acls(), beforeAcl);
      const cfg = (
        await db.query(
          "SELECT proconfig FROM pg_proc WHERE oid='public.storage_execute_v1(text,uuid,jsonb)'::regprocedure",
        )
      ).rows[0].proconfig;
      assert.ok(cfg.includes('statement_timeout=10s'));
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'collection_audit_private.execute_command_v1(text,uuid,uuid,jsonb,jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      }
      await db.query("BEGIN; SET LOCAL TIME ZONE 'UTC'; SET LOCAL statement_timeout='10s'");
      await seed(db);
      const stale = command('synthetic-terminal-stale');
      await header(db, stale.operationId);
      const proof = await call(db, stale);
      assert.deepEqual(proof, {
        outcome: 'rejected',
        operationId: stale.operationId,
        code: 'inventory_revision_conflict',
        inventoryRevision: 0,
      });
      await db.query(
        "RESET ROLE; UPDATE public.inventory_owner_state SET inventory_revision=1 WHERE owner_user_id='" + owner + "'",
      );
      await header(db, stale.operationId);
      assert.deepEqual(await call(db, stale), proof, 'request would now pass but the terminal ID cannot commit');
      await rejected(db, () => call(db, { ...stale, inventoryRevision: 0 }), '40001');
      await header(db, stale.operationId, partner, 'rest');
      await rejected(db, () => call(db, stale), 'HF402');
      await db.query('RESET ROLE');
      await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner]);
      await header(db, stale.operationId, partner, 'rest');
      await rejected(db, () => call(db, stale), '40001');

      await header(db, stale.operationId, owner);
      // Actor keys differ, so owner delivery is a distinct ledger namespace, not the partner's rejection.
      const accepted = await call(db, stale);
      assert.equal(accepted.changed, true);
      await header(db, stale.operationId, owner);
      assert.deepEqual(await call(db, stale), accepted, 'accepted replay still wins before mutable checks');
      await db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      for (const code of ['23505', '40001']) {
        await db.query('SAVEPOINT injected_error');
        await db.query(
          "CREATE FUNCTION pg_temp.reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_unclassified_failure' USING ERRCODE=TG_ARGV[0]; END $$",
        );
        await db.query(
          "CREATE TRIGGER synthetic_error BEFORE INSERT ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_insert('" +
            code +
            "')",
        );
        const unknown = command('synthetic-unclassified-' + code, 2);
        await header(db, unknown.operationId);
        await rejected(db, () => call(db, unknown), code);
        await db.query('RESET ROLE');
        assert.equal(
          (
            await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
              unknown.operationId,
            ])
          ).rows[0].n,
          0,
        );
        await db.query('ROLLBACK TO SAVEPOINT injected_error');
      }
      const partial = {
        ...command('synthetic-partial', 2),
        commands: [command('synthetic-partial').commands[0], { ...command('synthetic-partial').commands[0] }],
      };
      await header(db, partial.operationId);
      const failed = await call(db, partial);
      assert.equal(failed.code, 'item_conflict');
      await db.query('RESET ROLE');
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='synthetic/synthetic-partial'"))
          .rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
            [owner, partial.operationId],
          )
        ).rows[0].n,
        0,
      );
      const slots = {
        collectionId: binder,
        operationId: 'synthetic-slots-rejected',
        inventoryRevision: 1,
        collectionVersion: 0,
        layoutRevision: 0,
        commands: [{ kind: 'create', ids: ['synthetic/rejected-slot'], beforeSlotId: null }],
      };
      await header(db, slots.operationId);
      const slotProof = await call(db, slots, 'slots');
      assert.equal(slotProof.code, 'slot_revision_conflict');
      await db.query("RESET ROLE; DELETE FROM public.binders WHERE id='" + binder + "'");
      await header(db, slots.operationId);
      assert.deepEqual(await call(db, slots, 'slots'), slotProof, 'terminal replay before removed collection checks');
      await db.query("RESET ROLE; DELETE FROM public.partnerships WHERE owner_user_id='" + owner + "'");
      await header(db, slots.operationId);
      await rejected(db, () => call(db, slots, 'slots'), '42501');
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
test(
  '089 two-session exact deliveries serialize to one terminal result; rollback and cancellation remain unknown',
  { skip: !socket || process.env.STORAGE_REJECTION_RACE !== '1', timeout: 30000 },
  async () => {
    const a = connection('holofolder_fresh_rejection'),
      b = connection('holofolder_fresh_rejection');
    await a.connect();
    await b.connect();
    try {
      await a.query(readFileSync(new URL('../scripts/089_storage_command_rejection.sql', import.meta.url), 'utf8'));
      await a.query('BEGIN');
      await seed(a);
      await a.query('COMMIT');
      const stale = command('synthetic-racing-reject');
      await a.query('BEGIN');
      await header(a, stale.operationId);
      const terminal = await call(a, stale);
      await b.query('BEGIN');
      const pid = (await b.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;
      await header(b, stale.operationId);
      let settled = false;
      const waiting = call(b, stale).then((v) => {
        settled = true;
        return v;
      });
      // Observe a real PostgreSQL lock wait, no timing inference about absent ledger rows.
      await a.query('RESET ROLE');
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await a.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked', [pid])).rows[0].blocked;
        if (blocked) break;
      }
      assert.equal(blocked, true);
      assert.equal(settled, false);
      await a.query('COMMIT');
      assert.deepEqual(await waiting, terminal);
      await b.query('COMMIT');
      assert.equal(
        (
          await a.query(
            'SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND request_key=$2',
            [partner, stale.operationId],
          )
        ).rows[0].n,
        1,
      );
      // Two deliveries of an acceptable command commit one mutation and return one receipt.
      const acceptedRequest = command('synthetic-racing-accept', 0);
      await a.query('BEGIN');
      await header(a, acceptedRequest.operationId);
      const accepted = await call(a, acceptedRequest);
      await b.query('BEGIN');
      await header(b, acceptedRequest.operationId);
      const replay = call(b, acceptedRequest);
      await a.query('COMMIT');
      assert.deepEqual(await replay, accepted);
      await b.query('COMMIT');
      assert.equal(
        (
          await a.query('SELECT count(*)::int n FROM public.inventory_items WHERE id=$1', [
            acceptedRequest.commands[0].itemId,
          ])
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await a.query(
            'SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
            [owner, acceptedRequest.operationId],
          )
        ).rows[0].n,
        1,
      );
      // Cancel a duplicate waiting on the serialization fence. A missing ledger row does not
      // establish terminal rejection; its original request can still commit on exact retry.
      const cancelled = command('synthetic-racing-cancel', 1);
      await a.query('BEGIN');
      await a.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4701))', [owner]);
      await b.query('BEGIN');
      await header(b, cancelled.operationId);
      const cancelledCall = assert.rejects(
        call(b, cancelled),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '57014',
      );
      blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await a.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked', [pid])).rows[0].blocked;
        if (blocked) break;
      }
      assert.equal(blocked, true);
      await a.query('SELECT pg_cancel_backend($1)', [pid]);
      await cancelledCall;
      await b.query('ROLLBACK');
      await a.query('COMMIT');
      assert.equal(
        (
          await a.query(
            'SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND request_key=$2',
            [partner, cancelled.operationId],
          )
        ).rows[0].n,
        0,
      );
      await b.query('BEGIN');
      await header(b, cancelled.operationId);
      assert.equal((await call(b, cancelled)).changed, true);
      await b.query('COMMIT');
      // Accepted partner delivery holds non-key owner changes through commit.
      const membershipRequest = command('synthetic-membership-accept', 2);
      await a.query('BEGIN');
      await header(a, membershipRequest.operationId);
      assert.equal((await call(a, membershipRequest)).changed, true);
      await b.query('BEGIN');
      const changedOwner = b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [
        partner,
        owner,
      ]);
      await a.query('RESET ROLE');
      blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await a.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked', [pid])).rows[0].blocked;
        if (blocked) break;
      }
      assert.equal(blocked, true);
      await a.query('COMMIT');
      await changedOwner;
      await b.query('COMMIT');
      await b.query('BEGIN');
      await header(b, membershipRequest.operationId);
      await rejected(b, () => call(b, membershipRequest), '42501');
      await b.query('ROLLBACK');
      await a.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [owner, partner]);
      // Owner-change-first: KEY SHARE can read the old owner, but the helper's SHARE
      // waits for the update and must re-resolve current authority instead of using stale context.
      const denied = command('synthetic-owner-change-first', 3);
      await b.query('BEGIN');
      await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [partner, owner]);
      await a.query('BEGIN');
      const aPid = (await a.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;
      await header(a, denied.operationId);
      const deniedCall = assert.rejects(
        call(a, denied),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501',
      );
      blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await b.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked', [aPid])).rows[0].blocked;
        if (blocked) break;
      }
      assert.equal(blocked, true);
      await b.query('COMMIT');
      await deniedCall;
      await a.query('ROLLBACK');
      assert.equal(
        (
          await b.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            denied.operationId,
          ])
        ).rows[0].n,
        0,
      );
      await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [owner, partner]);
      // A returned function result inside an uncommitted transaction is not a committed proof.
      const rolled = command('synthetic-rolled-reject', 4);
      await a.query('BEGIN');
      await header(a, rolled.operationId);
      assert.equal((await call(a, rolled)).outcome, 'rejected');
      await a.query('ROLLBACK');
      assert.equal(
        (
          await a.query(
            'SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND request_key=$2',
            [partner, rolled.operationId],
          )
        ).rows[0].n,
        0,
      );
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      // Committed synthetic fixtures live only in the disposable empty-schema database.
      await a.end();
      await b.end();
    }
  },
);
