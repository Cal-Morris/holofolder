import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
const enabled = process.env.RECOVERY_TERMINAL_TEST_SOCKET;
const config = {
  host: '/Users/cal/.local/share/holofolder/recovery-092-local/s',
  port: 55592,
  user: 'recovery092',
  database: 'postgres',
};
const owner = '00920000-0000-4000-8000-000000000001',
  partner = '00920000-0000-4000-8000-000000000002';
const source = { source: 'app', clientId: null, batchId: null, clientOccurredAt: null };
const flush = (db: Client) => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
async function seed(db: Client) {
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner]);
  await db.query('UPDATE public.billing_configuration SET enforced=false');
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner]);
  await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
  await flush(db);
}
async function header(db: Client, id: string, actor = partner, transport = 'app') {
  await db.query('RESET ROLE');
  await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [
    JSON.stringify({
      'x-holo-audit-context': JSON.stringify({
        actor: { kind: 'user', userId: actor },
        ...source,
        source: transport,
        operationId: id,
      }),
    }),
    JSON.stringify({ role: 'service_role' }),
  ]);
  await db.query('SET LOCAL ROLE service_role');
}
async function send(
  db: Client,
  request: Record<string, unknown>,
  operation = 'recovery.apply',
  actor = partner,
  transport = 'app',
  recipient = owner,
) {
  await header(db, String(request.operationId), actor, transport);
  return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, recipient, request])).rows[0].r;
}
async function add(db: Client) {
  await db.query('RESET ROLE');
  const id = 'synthetic/' + randomUUID(),
    op = 'synthetic-add-' + randomUUID();
  const revision = Number(
    (await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner]))
      .rows[0].inventory_revision,
  );
  await db.query('SELECT public.inventory_command_v1($1,$2,$3,$4)', [
    partner,
    owner,
    {
      operationId: op,
      inventoryRevision: revision,
      collections: [],
      commands: [
        { kind: 'add', itemId: id, identity: { kind: 'pokemon', pokemonId: 1 }, grading: null, acquiredAt: null },
      ],
    },
    source,
  ]);
  await flush(db);
  return (
    await db.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
      owner,
    ])
  ).rows[0].id as string;
}
async function plan(db: Client, event: string) {
  await db.query('RESET ROLE');
  return (
    await db.query("SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,'{}') r", [partner, owner, event])
  ).rows[0].r;
}
const request = (eventId: string, planToken: string) => ({
  eventId,
  planToken,
  operationId: 'synthetic-recover-' + randomUUID(),
  planVersion: 1,
  confirmed: true,
  restoreUnassignedItemIds: [],
});
async function error(db: Client, run: () => Promise<unknown>, code: string) {
  await db.query('SAVEPOINT failure');
  await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code);
  await db.query('ROLLBACK TO SAVEPOINT failure');
}
async function state(db: Client) {
  await db.query('RESET ROLE');
  return (
    await db.query(
      `SELECT jsonb_build_object('items',(SELECT coalesce(jsonb_agg(i ORDER BY id),'[]') FROM public.inventory_items i WHERE owner_user_id=$1),'history',(SELECT coalesce(jsonb_agg(a ORDER BY id),'[]') FROM public.collection_activity a WHERE owner_user_id=$1),'root',(SELECT to_jsonb(s) FROM public.inventory_owner_state s WHERE owner_user_id=$1),'pending',(SELECT coalesce(jsonb_agg(p),'[]') FROM collection_audit_private.pending p WHERE owner_id=$1)) r`,
      [owner],
    )
  ).rows[0].r;
}
// Private restored database only. All fixtures are synthetic; ordinary proofs roll back.
test(
  '092 twice preserves other engines, owners/ACL/RLS and real v1 accepted/rejected replay with zero effects',
  { skip: !enabled, timeout: 60000 },
  async () => {
    assert.equal(enabled, config.host);
    const db = new Client(config);
    await db.connect();
    try {
      const functions = async () =>
        (
          await db.query(
            "SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,proowner,proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1",
          )
        ).rows;
      const tables = async () =>
        (
          await db.query(
            "SELECT c.oid::regclass::text name,relowner,relacl::text,relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','collection_audit_private','auth','storage') ORDER BY 1",
          )
        ).rows;
      const before = await functions(),
        access = await tables(),
        sql = readFileSync(new URL('../scripts/092_recovery_terminal_noncommit.sql', import.meta.url), 'utf8');
      await db.query(sql);
      const once = await functions();
      await db.query(sql);
      assert.deepEqual(await functions(), once);
      assert.deepEqual(await tables(), access);
      const changed = new Set([
        'storage_execute_v1(text,uuid,jsonb)',
        'collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)',
        'collection_audit_private.recovery_apply_v2(uuid,uuid,jsonb,jsonb)',
      ]);
      for (const f of before) {
        const next = once.find((n) => n.name === f.name)!;
        assert.equal(next.proowner, f.proowner);
        assert.equal(next.proacl, f.proacl);
        if (!changed.has(f.name)) assert.equal(next.digest, f.digest);
      }
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role'])
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'collection_audit_private.execute_recovery_v1(text,uuid,uuid,jsonb,jsonb)','EXECUTE') ok",
              [role],
            )
          ).rows[0].ok,
          false,
        );
      assert.ok(
        (
          await db.query(
            "SELECT proconfig FROM pg_proc WHERE oid='public.storage_execute_v1(text,uuid,jsonb)'::regprocedure",
          )
        ).rows[0].proconfig.includes('statement_timeout=10s'),
      );
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      await seed(db);
      const event = await add(db),
        p = await plan(db, event),
        input = request(event, p.planToken);
      const accepted = await send(db, input);
      assert.equal(accepted.recoveredEventId, event);
      await add(db);
      assert.deepEqual(await send(db, input), accepted, 'accepted lost reply survives later unrelated mutation');
      // The inverse of the recovery makes the original event stale again; accepted replay is historical.
      await db.query('RESET ROLE');
      const inversePlan = await plan(db, accepted.eventId);
      await send(db, request(accepted.eventId, inversePlan.planToken));
      assert.deepEqual(await send(db, input), accepted, 'later inverse cannot invalidate accepted receipt');
      await db.query('RESET ROLE');
      for (const actor of [owner, partner, '00920000-0000-4000-8000-000000000099']) {
        await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: actor, role: 'authenticated' }),
        ]);
        await db.query('SET LOCAL ROLE authenticated');
        const rows = (
          await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])
        ).rows[0].n;
        assert.equal(rows > 0, actor !== '00920000-0000-4000-8000-000000000099');
        await db.query('RESET ROLE');
      }
      await db.query('SET LOCAL ROLE anon');
      await error(db, () => db.query('SELECT * FROM public.inventory_items'), '42501');
      await db.query('RESET ROLE');
      const another = await add(db),
        old = await plan(db, another),
        stale = request(another, old.planToken);
      await add(db);
      const baseline = await state(db);
      const proof = await send(db, stale);
      assert.deepEqual(proof, {
        outcome: 'rejected',
        operationId: stale.operationId,
        code: 'recovery_plan_conflict',
        inventoryRevision: baseline.root.inventory_revision,
      });
      assert.deepEqual(await state(db), baseline, 'terminal rejection changes no inverse/history/root/pending state');
      assert.deepEqual(await send(db, stale), proof);
      await error(db, () => send(db, { ...stale, planToken: 'b'.repeat(64) }), '40001');
      await error(db, () => send(db, stale, 'recovery.apply.v2'), '22023');
      const actorProof = await send(db, stale, 'recovery.apply', owner);
      assert.equal(actorProof.outcome, 'rejected');
      await db.query('RESET ROLE');
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            stale.operationId,
          ])
        ).rows[0].n,
        2,
        'actors have distinct ledger records',
      );
      await error(db, () => send(db, stale, 'recovery.apply', partner, 'rest'), 'HF402');
      await db.query('RESET ROLE');
      await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner]);
      await error(db, () => send(db, stale, 'recovery.apply', partner, 'rest'), '40001');
      await error(db, () => send(db, stale, 'recovery.apply', partner, 'app', partner), '42501');
      await db.query('RESET ROLE; SAVEPOINT unlink');
      await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await error(db, () => send(db, input), '42501');
      await db.query('ROLLBACK TO SAVEPOINT unlink');
      await db.query('RESET ROLE; SAVEPOINT billing');
      await db.query('DELETE FROM public.perpetual_licences WHERE owner_user_id=$1', [owner]);
      await db.query('UPDATE public.billing_configuration SET enforced=true');
      await error(db, () => send(db, input), '42501');
      await db.query('RESET ROLE; ROLLBACK TO SAVEPOINT billing');
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
async function create(db: Client, count = 0) {
  await db.query('RESET ROLE');
  const id = randomUUID(),
    op = 'synthetic-create-' + id;
  const revision = Number(
    (await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner]))
      .rows[0].inventory_revision,
  );
  await db.query('SELECT collection_audit_private.create_collection_v1($1,$2,$3,$4)', [
    partner,
    owner,
    {
      version: 1,
      operationId: op,
      inventoryRevision: revision,
      collectionId: id,
      name: 'Synthetic recovery workload',
      kind: 'binder',
      defaultPresentation: 'binder',
      location: null,
      grid: null,
      manifest: {
        source: { id: 'synthetic', version: '1' },
        name: 'Synthetic',
        entries: Array.from({ length: count }, (_, n) => ({ id: 'entry-' + n, target: null })),
      },
      slotIds: Array.from({ length: count }, (_, n) => id + '/slot-' + n),
    },
    { actor: { kind: 'user', userId: partner }, ...source, operationId: op, action: 'collection.create' },
  ]);
  await flush(db);
  return {
    id,
    event: (
      await db.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [
        owner,
        op,
      ])
    ).rows[0].id as string,
  };
}
test(
  '092 real v2 replacement, partial inverse/deferred audit rollback, arbitrary errors and billing stay unknown',
  { skip: !enabled, timeout: 60000 },
  async () => {
    const db = new Client(config);
    await db.connect();
    try {
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      await seed(db);
      const original = await create(db),
        replacement = await create(db);
      const root = await db.query(
        'SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1',
        [owner],
      );
      const choice = {
        eventId: original.event,
        planVersion: 2,
        restoreUnassignedItemIds: [],
        replacementDefaultCollectionId: replacement.id,
        inventoryRevision: Number(root.rows[0].inventory_revision),
        collections: [{ collectionId: replacement.id, version: 0, layoutRevision: 0 }],
      };
      const p = (
        await db.query('SELECT collection_audit_private.recovery_preview_v2($1,$2,$3) r', [partner, owner, choice])
      ).rows[0].r;
      assert.match(p.planToken, /^[a-f0-9]{64}$/);
      const input = { ...choice, operationId: 'synthetic-v2-' + randomUUID(), planToken: p.planToken, confirmed: true };
      const accepted = await send(db, input, 'recovery.apply.v2');
      assert.equal(accepted.recoveredEventId, original.event);
      await add(db);
      assert.deepEqual(await send(db, input, 'recovery.apply.v2'), accepted);
      await db.query('RESET ROLE; ROLLBACK');
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      await seed(db);
      const first = await create(db),
        second = await create(db);
      const c = {
        ...choice,
        eventId: first.event,
        replacementDefaultCollectionId: second.id,
        collections: [{ collectionId: second.id, version: 0, layoutRevision: 0 }],
        inventoryRevision: 2,
      };
      const p2 = (
        await db.query('SELECT collection_audit_private.recovery_preview_v2($1,$2,$3) r', [partner, owner, c])
      ).rows[0].r;
      await add(db);
      const terminal = await send(
        db,
        { ...c, operationId: 'synthetic-v2-stale', planToken: p2.planToken, confirmed: true },
        'recovery.apply.v2',
      );
      assert.equal(terminal.outcome, 'rejected');
      assert.equal(terminal.code, 'recovery_plan_conflict');
      await db.query('RESET ROLE');
      const event = await add(db),
        reviewed = await plan(db, event),
        fresh = request(event, reviewed.planToken);
      // An ordinary 40001 with the exact whitelisted message is still NOT proof.
      for (const code of ['40001', '23505', '57014', 'P0001']) {
        await db.query('RESET ROLE; SAVEPOINT injection');
        await db.query(
          `CREATE FUNCTION pg_temp.fail_inverse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery_plan_conflict' USING ERRCODE=TG_ARGV[0]; END $$`,
        );
        await db.query(
          `CREATE TRIGGER synthetic_inverse_failure BEFORE DELETE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_inverse('${code}')`,
        );
        const base = await state(db);
        await error(db, () => send(db, fresh), code);
        assert.deepEqual(await state(db), base);
        assert.equal(
          (
            await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
              fresh.operationId,
            ])
          ).rows[0].n,
          0,
        );
        await db.query('ROLLBACK TO SAVEPOINT injection');
      }
      // Dedicated dependency rejection occurs after inverse deletion, proving subtransaction rollback.
      await db.query('RESET ROLE; SAVEPOINT partial');
      await db.query(
        `CREATE FUNCTION pg_temp.fail_after_inverse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery_dependency_conflict' USING ERRCODE='HF092'; END $$`,
      );
      await db.query(
        'CREATE TRIGGER synthetic_partial AFTER DELETE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_after_inverse()',
      );
      const base = await state(db);
      const proof = await send(db, fresh);
      assert.equal(proof.code, 'recovery_dependency_conflict');
      assert.deepEqual(await state(db), base);
      await db.query('ROLLBACK TO SAVEPOINT partial');
      // Deferred audit error must roll inverse and receipt back, never commit a rejection.
      await db.query(
        `CREATE FUNCTION pg_temp.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$`,
      );
      await db.query(
        'CREATE TRIGGER synthetic_audit BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_audit()',
      );
      const before = await state(db);
      await error(db, () => send(db, fresh), 'P0001');
      assert.deepEqual(await state(db), before);
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            fresh.operationId,
          ])
        ).rows[0].n,
        0,
      );
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
test(
  '092 representative 4096-slot recovery with populated later history retains the 10s deadline',
  { skip: !enabled, timeout: 60000 },
  async () => {
    const db = new Client(config);
    await db.connect();
    try {
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      await seed(db);
      await create(db);
      const large = await create(db, 4096);
      for (let n = 0; n < 512; n++) await add(db);
      const start = performance.now(),
        p = await plan(db, large.event),
        previewMs = performance.now() - start;
      assert.match(p.planToken, /^[a-f0-9]{64}$/);
      const applyStart = performance.now(),
        receipt = await send(db, request(large.event, p.planToken));
      await db.query('RESET ROLE');
      await flush(db);
      const applyMs = performance.now() - applyStart;
      assert.equal(receipt.recoveredEventId, large.event);
      assert.ok(applyMs < 10000);
      console.log(
        JSON.stringify({
          syntheticLocalOnly: true,
          slots: 4096,
          laterEvents: 512,
          previewMs: Math.round(previewMs),
          applyAndFlushMs: Math.round(applyMs),
        }),
      );
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
test(
  '092 two-session accepted/rejected, rollback, cancellation, membership-owner and unlink races',
  { skip: !enabled, timeout: 60000 },
  async () => {
    const a = new Client({ ...config, database: 'recovery092_fresh' }),
      b = new Client({ ...config, database: 'recovery092_fresh' });
    await a.connect();
    await b.connect();
    async function blocked(observer: Client, pid: number) {
      for (let n = 0; n < 200; n++)
        if ((await observer.query('SELECT cardinality(pg_blocking_pids($1))>0 b', [pid])).rows[0].b) return;
      assert.fail('expected real PostgreSQL lock wait');
    }
    try {
      await a.query('BEGIN');
      await seed(a);
      const event = await add(a),
        p = await plan(a, event),
        input = request(event, p.planToken);
      await a.query('COMMIT');
      const pid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await a.query('BEGIN');
      const accepted = await send(a, input);
      await b.query('BEGIN');
      const wait = send(b, input);
      await a.query('RESET ROLE');
      await blocked(a, pid);
      await a.query('COMMIT');
      assert.deepEqual(await wait, accepted);
      await b.query('COMMIT');
      await a.query('BEGIN');
      const e = await add(a),
        preview = await plan(a, e),
        stale = request(e, preview.planToken);
      await add(a);
      await a.query('COMMIT');
      await a.query('BEGIN');
      const terminal = await send(a, stale);
      assert.equal(terminal.outcome, 'rejected');
      await a.query('RESET ROLE');
      const locks = (
        await a.query(
          "SELECT count(*)::int n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted",
        )
      ).rows[0].n;
      assert.ok(locks >= 2, 'both outer management/root locks survive engine subtransaction rollback');
      await b.query('BEGIN');
      const rejectWait = send(b, stale);
      await blocked(a, pid);
      await a.query('COMMIT');
      assert.deepEqual(await rejectWait, terminal);
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
      // Receipt rolled back by its transaction is absent, the next delivery must execute again.
      const rolled = { ...stale, operationId: 'synthetic-rolled-' + randomUUID() };
      await a.query('BEGIN');
      await send(a, rolled);
      await a.query('ROLLBACK');
      assert.equal(
        (
          await a.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            rolled.operationId,
          ])
        ).rows[0].n,
        0,
      );
      // Cancellation while waiting for the retained owner fence is not terminal evidence.
      await a.query('BEGIN');
      await a.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4701))', [owner]);
      await b.query('BEGIN');
      const cancelled = { ...stale, operationId: 'synthetic-cancel-' + randomUUID() };
      const cancelling = assert.rejects(
        send(b, cancelled),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '57014',
      );
      await blocked(a, pid);
      await a.query('SELECT pg_cancel_backend($1)', [pid]);
      await cancelling;
      await b.query('ROLLBACK');
      await a.query('COMMIT');
      assert.equal(
        (
          await a.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            cancelled.operationId,
          ])
        ).rows[0].n,
        0,
      );
      // Cancel inside a real inverse AFTER DELETE, after mutation and audit capture began.
      await a.query('BEGIN');
      const liveEvent = await add(a),
        livePlan = await plan(a, liveEvent),
        live = request(liveEvent, livePlan.planToken);
      await a.query('COMMIT');
      const beforeCancel = await state(a);
      await a.query(
        `CREATE FUNCTION pg_temp.pause_inverse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(30); RETURN OLD; END $$`,
      );
      await a.query(
        'CREATE TRIGGER synthetic_pause AFTER DELETE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION pg_temp.pause_inverse()',
      );
      await a.query('BEGIN');
      const executingPid = (await a.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const inEngine = assert.rejects(
        send(a, live),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '57014',
      );
      let sleeping = false;
      for (let n = 0; n < 200; n++)
        if (
          (await b.query("SELECT wait_event='PgSleep' sleeping FROM pg_stat_activity WHERE pid=$1", [executingPid]))
            .rows[0].sleeping
        ) {
          sleeping = true;
          break;
        }
      assert.equal(sleeping, true);
      await b.query('SELECT pg_cancel_backend($1)', [executingPid]);
      await inEngine;
      await a.query('ROLLBACK');
      await a.query('DROP TRIGGER synthetic_pause ON public.inventory_items');
      assert.deepEqual(await state(a), beforeCancel);
      assert.equal(
        (
          await a.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            live.operationId,
          ])
        ).rows[0].n,
        0,
      );
      await a.query('BEGIN');
      assert.equal((await send(a, live)).recoveredEventId, liveEvent);
      await a.query('COMMIT');
      // Current owner membership is held even on terminal replay, through commit.
      for (const unlink of [false, true]) {
        await a.query('BEGIN');
        assert.deepEqual(await send(a, stale), terminal);
        await a.query('RESET ROLE');
        await b.query('BEGIN');
        const mutation = unlink
          ? b.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner])
          : b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [partner, owner]);
        await blocked(a, pid);
        await a.query('COMMIT');
        await mutation;
        await b.query('ROLLBACK');
      }
      // An owner change committed while helper waits must invalidate even an old receipt.
      await b.query('BEGIN');
      await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [partner, owner]);
      await a.query('BEGIN');
      const aPid = (await a.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      const denied = assert.rejects(
        send(a, stale),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501',
      );
      await blocked(b, aPid);
      await b.query('COMMIT');
      await denied;
      await a.query('ROLLBACK');
      await b.query('UPDATE public.partnerships SET owner_user_id=$1 WHERE owner_user_id=$2', [owner, partner]);
      // Unlink first similarly denies exact accepted replay after current authority is gone.
      await b.query('BEGIN');
      await b.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await a.query('BEGIN');
      const unlinked = assert.rejects(
        send(a, input),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501',
      );
      await blocked(b, aPid);
      await b.query('COMMIT');
      await unlinked;
      await a.query('ROLLBACK');
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      await a.query('RESET ROLE');
      await a.query('DELETE FROM auth.users WHERE id IN ($1,$2)', [owner, partner]);
      await a.end();
      await b.end();
    }
  },
);
