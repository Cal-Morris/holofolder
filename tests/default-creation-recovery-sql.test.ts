import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract';

const socket = process.env.DEFAULT_RECOVERY_TEST_SOCKET;
const config = {
  host: '/Users/cal/.local/share/holofolder/issue396-default-recovery-local/socket',
  port: 55586,
  user: 'default_recovery_test',
  database: 'postgres',
};
const owner = '00850000-0000-4000-8000-000000000001',
  partner = '00850000-0000-4000-8000-000000000002';
const intent = { source: 'app', clientId: null, batchId: null, clientOccurredAt: null };

async function create(db: Client, count = 0, actor = owner, long = false) {
  const id = randomUUID(),
    op = `synthetic-create-${id}`;
  const revision = Number(
    (await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner]))
      .rows[0]?.inventory_revision ?? 0,
  );
  const input = {
    version: 1,
    operationId: op,
    inventoryRevision: revision,
    collectionId: id,
    name: `Synthetic ${id.slice(0, 8)}`,
    kind: 'binder',
    defaultPresentation: 'binder',
    location: null,
    grid: null,
    manifest: {
      source: { id: 'synthetic', version: '1' },
      name: 'Synthetic species',
      entries: Array.from({ length: count }, (_, n) => ({
        id: `entry-${n}`,
        target: n % 2 ? null : { kind: 'pokemon', pokemonId: (n % 1025) + 1 },
      })),
    },
    slotIds: Array.from({ length: count }, (_, n) => `${id}/slot-${n}`),
  };
  if (long) {
    input.manifest.source = { id: 'synthetic/' + 's'.repeat(190), version: 'v'.repeat(200) };
    input.manifest.entries.forEach((e) => {
      e.id += '/' + 'e'.repeat(150);
    });
    input.slotIds = input.slotIds.map((key) => key + '/' + 's'.repeat(110));
    assert.ok(Buffer.byteLength(JSON.stringify(input)) > 1048576);
  }
  const ctx = { actor: { kind: 'user', userId: actor }, ...intent, operationId: op, action: 'collection.create' };
  const receipt = (
    await db.query('SELECT collection_audit_private.create_collection_v1($1,$2,$3,$4) r', [actor, owner, input, ctx])
  ).rows[0].r;
  await db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
  const event = (
    await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [owner, op])
  ).rows[0];
  return { input, receipt, event, id };
}
const preview = async (db: Client, event: string, actor = owner) =>
  (await db.query("SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,'{}') r", [actor, owner, event]))
    .rows[0].r;
const request = (event: string, token: string, operationId = `synthetic-recovery-${randomUUID()}`) => ({
  eventId: event,
  planVersion: 1,
  planToken: token,
  operationId,
  restoreUnassignedItemIds: [],
  confirmed: true,
});
const apply = async (db: Client, input: object, actor = owner) =>
  (await db.query('SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r', [actor, owner, input, intent]))
    .rows[0].r;
const flush = (db: Client) => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');

const choice = async (db: Client, eventId: string, replacement: string) => {
  const root = (
    await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [owner])
  ).rows[0];
  const state = (
    await db.query('SELECT version,layout_revision FROM public.storage_collection_state WHERE collection_id=$1', [
      replacement,
    ])
  ).rows[0];
  return {
    eventId: String(eventId),
    restoreUnassignedItemIds: [],
    planVersion: 2,
    replacementDefaultCollectionId: replacement,
    inventoryRevision: Number(root.inventory_revision),
    collections: [
      {
        collectionId: replacement,
        version: Number(state?.version ?? 0),
        layoutRevision: Number(state?.layout_revision ?? 0),
      },
    ],
  };
};
const preview2 = async (db: Client, input: object, actor = owner) =>
  (await db.query('SELECT collection_audit_private.recovery_preview_v2($1,$2,$3) r', [actor, owner, input])).rows[0].r;
const request2 = (input: object, token: string) => ({
  ...input,
  operationId: `synthetic-default-${randomUUID()}`,
  planToken: token,
  confirmed: true,
});
const apply2 = async (db: Client, input: object, actor = owner) =>
  (await db.query('SELECT collection_audit_private.recovery_apply_v2($1,$2,$3,$4) r', [actor, owner, input, intent]))
    .rows[0].r;
const begin = async (db: Client) => {
  await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner]);
  await db.query('UPDATE public.billing_configuration SET enforced=false');
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner]);
  await flush(db);
};
const rejected = async (db: Client, work: () => Promise<unknown>, match: RegExp) => {
  await db.query('SAVEPOINT rejected');
  await assert.rejects(work, match);
  await db.query('ROLLBACK TO SAVEPOINT rejected');
};

test(
  '085 installs twice, preserves original functions/ACL/RLS and all private denials',
  { skip: !socket },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    const db = new Client(config);
    await db.connect();
    try {
      const functions = async () =>
        (
          await db.query(`SELECT p.oid::regprocedure::text name,p.proowner,p.proacl::text,
      CASE WHEN p.proname<>'storage_execute_v1' THEN md5(pg_get_functiondef(p.oid)) END digest FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','collection_audit_private') AND p.proname NOT IN ('default_recovery_request_v2','recovery_plan_v2','recovery_preview_v2','recovery_apply_v2') ORDER BY 1`)
        ).rows;
      const access = async () =>
        (
          await db.query(`SELECT n.nspname,c.relname,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)
        ).rows;
      const before = await functions(),
        tables = await access();
      const migration = readFileSync(
        new URL('../scripts/085_explicit_default_creation_recovery.sql', import.meta.url),
        'utf8',
      );
      await db.query(migration);
      await db.query(migration);
      assert.deepEqual(await functions(), before);
      assert.deepEqual(await access(), tables);
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        assert.ok(
          (
            await db.query(
              `SELECT has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='collection_audit_private'`,
              [role],
            )
          ).rows.every((r) => !r.allowed),
        );
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'public.storage_execute_v1(text,uuid,jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          role === 'service_role',
        );
      }
      const body = (
        await db.query(
          "SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v2(uuid,uuid,jsonb,jsonb)'::regprocedure) body",
        )
      ).rows[0].body;
      assert.equal(body.match(/plan:=collection_audit_private.recovery_plan_v2/g)?.length, 2);
      assert.equal(body.match(/reviewed:=collection_audit_private.recovery_preview_v2/g)?.length, 1);
      assert.ok(body.indexOf('FOR SHARE') < body.indexOf('6102') && body.indexOf('6102') < body.indexOf('4701'));
    } finally {
      await db.end();
    }
  },
);

test(
  'first-ever default requires nominated current alternative, atomic service inverse/replay and inverse-of-inverse',
  { skip: !socket },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    const db = new Client(config);
    await db.connect();
    try {
      await begin(db);
      const first = await create(db, 3);
      assert.ok(
        (await preview(db, first.event.id)).conflicts.some(
          (c: { reason: string }) => c.reason === 'creation_default_requires_explicit_replacement',
        ),
      );
      // No replacement, self, other owner, absent or legacy alternatives never manufacture a default.
      const missing = await choice(db, first.event.id, randomUUID());
      assert.ok(
        (await preview2(db, missing)).conflicts.some(
          (c: { reason: string }) => c.reason === 'creation_replacement_unavailable',
        ),
      );
      const self = await choice(db, first.event.id, first.id);
      assert.equal((await preview2(db, self)).planToken, null);
      await db.query('SAVEPOINT invalid_alternative');
      const legacy = randomUUID();
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic legacy alternative')", [
        legacy,
        owner,
      ]);
      await flush(db);
      assert.equal((await preview2(db, await choice(db, first.event.id, legacy))).planToken, null);
      const foreign = randomUUID();
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic foreign alternative')",
        [foreign, partner],
      );
      await flush(db);
      assert.equal((await preview2(db, await choice(db, first.event.id, foreign))).planToken, null);
      await db.query('ROLLBACK TO SAVEPOINT invalid_alternative');
      const replacement = await create(db, 2, partner);
      const nondefault = await preview2(db, await choice(db, replacement.event.id, first.id));
      assert.equal(nondefault.supported, false);
      assert.ok(nondefault.unsupported.includes('explicit_replacement_requires_default_creation'));
      const originalReplacement = (await db.query('SELECT * FROM public.binders WHERE id=$1', [replacement.id]))
        .rows[0];
      await db.query(
        `INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES('synthetic/retained-a',$1,'{"kind":"card","cardId":"synthetic-print"}',NULL,'2020-01-02'),('synthetic/retained-b',$1,'{"kind":"card","cardId":"synthetic-print"}',NULL,'2021-01-02')`,
        [owner],
      );
      await flush(db);
      await db.query(
        `UPDATE public.binder_slots SET wanted_cards='[{"card_id":"synthetic-want","card_name":"Synthetic wanted","added_at":"2020-01-01"}]',version=version+1 WHERE id=$1`,
        [replacement.input.slotIds[0]],
      );
      await flush(db);
      const grade = {
        provider: { kind: 'known', id: 'psa' },
        grade: '10',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: 'synthetic-private-certificate',
        holder: null,
        label: { variant: 'synthetic label', assetIds: [] },
      };
      await db.query('UPDATE public.inventory_items SET grading=$2,version=version+1 WHERE id=$1', [
        'synthetic/retained-a',
        grade,
      ]);
      await flush(db);
      const copies = (
        await db.query('SELECT * FROM public.inventory_items WHERE owner_user_id=$1 ORDER BY id', [owner])
      ).rows;
      const slots = (
        await db.query('SELECT * FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [replacement.id])
      ).rows;
      const input = await choice(db, first.event.id, replacement.id),
        plan = await preview2(db, input, partner);
      assert.deepEqual(plan.conflicts, []);
      assert.ok(plan.planToken);
      assert.equal(normalizeStorageResult('recovery.preview.v2', plan).planToken, plan.planToken);
      assert.ok(
        plan.changes.some(
          (e: { table: string; id: string; after: { is_default: boolean } }) =>
            e.table === 'binders' && e.id === replacement.id && e.after.is_default === true,
        ),
      );
      for (const change of [{ force: true }, { planVersion: 1 }, { actor: owner }, { collections: [] }]) {
        await rejected(db, () => preview2(db, { ...input, ...change }), /invalid_recovery_request/);
      }
      await rejected(
        db,
        () =>
          db.query('SELECT collection_audit_private.recovery_apply_v1($1,$1,$2,$3)', [
            owner,
            request2(input, plan.planToken),
            intent,
          ]),
        /invalid_recovery_request/,
      );
      const recover = request2(input, plan.planToken);
      await db.query("SELECT set_config('request.headers',$1,true)", [
        JSON.stringify({
          'x-holo-audit-context': JSON.stringify({
            actor: { kind: 'user', userId: partner },
            ...intent,
            operationId: recover.operationId,
          }),
        }),
      ]);
      await db.query('SET LOCAL ROLE service_role');
      const gatewayPlan = (
        await db.query("SELECT public.storage_execute_v1('recovery.preview.v2',$1,$2) r", [owner, input])
      ).rows[0].r;
      assert.deepEqual(gatewayPlan, plan);
      const receipt = (
        await db.query("SELECT public.storage_execute_v1('recovery.apply.v2',$1,$2) r", [owner, recover])
      ).rows[0].r;
      await db.query('RESET ROLE');
      assert.equal(normalizeStorageResult('recovery.apply.v2', receipt).eventId, receipt.eventId);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.binders WHERE id=$1', [first.id])).rows[0].n, 0);
      assert.equal(
        (await db.query('SELECT is_default FROM public.binders WHERE id=$1', [replacement.id])).rows[0].is_default,
        true,
      );
      assert.deepEqual(
        (await db.query('SELECT * FROM public.inventory_items WHERE owner_user_id=$1 ORDER BY id', [owner])).rows,
        copies,
      );
      assert.deepEqual(
        (await db.query('SELECT * FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [replacement.id]))
          .rows,
        slots,
      );
      assert.deepEqual(
        (await db.query('SELECT * FROM public.collection_activity WHERE id=$1', [first.event.id])).rows[0],
        first.event,
      );
      const inverse = (await db.query('SELECT * FROM public.collection_activity WHERE id=$1', [receipt.eventId]))
        .rows[0];
      assert.equal(String(inverse.recovery_of_event_id), String(first.event.id));
      assert.ok(
        inverse.recovery_state.some(
          (e: { table: string; id: string; before: { is_default: boolean }; after: { is_default: boolean } }) =>
            e.table === 'binders' && e.id === replacement.id && !e.before.is_default && e.after.is_default,
        ),
      );
      assert.deepEqual(await apply2(db, recover, partner), receipt);
      await rejected(
        db,
        () => apply2(db, { ...recover, inventoryRevision: input.inventoryRevision + 1 }, partner),
        /idempotency_conflict/,
      );
      const changedChoice = {
        ...recover,
        replacementDefaultCollectionId: first.id,
        collections: [{ ...input.collections[0], collectionId: first.id }],
      };
      await rejected(db, () => apply2(db, changedChoice, partner), /idempotency_conflict/);
      const fresh = request2(input, plan.planToken);
      await rejected(db, () => apply2(db, fresh), /recovery_plan_conflict/);
      const ctx = {
        actor: { kind: 'user', userId: owner },
        ...intent,
        operationId: first.input.operationId,
        action: 'collection.create',
      };
      assert.deepEqual(
        (
          await db.query('SELECT collection_audit_private.create_collection_v1($1,$1,$2,$3) r', [
            owner,
            first.input,
            ctx,
          ])
        ).rows[0].r,
        first.receipt,
      );
      const undo = await preview(db, receipt.eventId);
      assert.deepEqual(undo.conflicts, [], JSON.stringify(undo));
      await apply(db, request(receipt.eventId, undo.planToken));
      assert.equal(
        (await db.query('SELECT is_default FROM public.binders WHERE id=$1', [first.id])).rows[0].is_default,
        true,
      );
      assert.deepEqual(
        (await db.query('SELECT * FROM public.binders WHERE id=$1', [replacement.id])).rows[0],
        originalReplacement,
      );
      assert.deepEqual(
        (
          await db.query('SELECT id FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [first.id])
        ).rows.map((r) => r.id),
        first.input.slotIds,
      );
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  'default recovery refuses stale/ABA/dependent/evidence changes and rolls recorder/cancellation back',
  { skip: !socket, timeout: 30000 },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    const db = new Client(config);
    await db.connect();
    try {
      await begin(db);
      const first = await create(db, 2),
        replacement = await create(db, 2);
      const input = await choice(db, first.event.id, replacement.id),
        plan = await preview2(db, input);
      assert.deepEqual(plan.conflicts, []);
      const changed = async (sql: string, params: unknown[], reason?: string) => {
        await db.query('SAVEPOINT changed');
        await db.query(sql, params);
        await flush(db);
        const p = await preview2(db, input);
        if (reason)
          assert.ok(
            p.conflicts.some((c: { reason: string }) => c.reason === reason),
            JSON.stringify(p),
          );
        assert.notEqual(p.planToken, plan.planToken);
        await rejected(db, () => apply2(db, request2(input, plan.planToken)), /recovery_plan_conflict/);
        await db.query('ROLLBACK TO SAVEPOINT changed');
      };
      await changed(
        'UPDATE public.storage_collection_state SET version=version+1 WHERE collection_id=$1',
        [replacement.id],
        'creation_replacement_version_changed',
      );
      await changed("UPDATE public.binders SET name='Synthetic changed replacement' WHERE id=$1", [replacement.id]);
      await changed("UPDATE public.binders SET name='Synthetic ABA' WHERE id=$1;", [replacement.id]);
      await db.query('SAVEPOINT aba');
      await db.query("UPDATE public.binders SET name='Synthetic temporary' WHERE id=$1", [replacement.id]);
      await flush(db);
      await db.query('UPDATE public.binders SET name=$2 WHERE id=$1', [replacement.id, replacement.input.name]);
      await flush(db);
      assert.notEqual((await preview2(db, input)).planToken, plan.planToken);
      await rejected(db, () => apply2(db, request2(input, plan.planToken)), /recovery_plan_conflict/);
      await db.query('ROLLBACK TO SAVEPOINT aba');
      await changed(
        'UPDATE public.binders SET is_default=false WHERE id=$1',
        [first.id],
        'entity_changed_or_identity_occupied',
      );
      await changed(
        "UPDATE public.binders SET name='Synthetic original changed' WHERE id=$1",
        [first.id],
        'creation_later_dependency_change',
      );
      await changed(
        "INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-dependent')",
        [owner, first.id],
        'creation_dependent_rows',
      );
      await changed(
        'INSERT INTO public.binder_history_state(binder_id) VALUES($1)',
        [first.id],
        'creation_dependent_rows',
      );
      await changed(
        'UPDATE public.storage_collection_state SET version=version+1 WHERE collection_id=$1',
        [first.id],
        'creation_state_changed',
      );
      await changed(
        "INSERT INTO public.collection_activity(owner_user_id,before_state,after_state) VALUES($1,'{}','{}')",
        [owner],
        'creation_history_incomplete',
      );
      // Future FK children are checked through the catalog as well.
      await changed(
        "CREATE TABLE public.synthetic_default_dependency(binder_id uuid REFERENCES public.binders(id) ON DELETE CASCADE); INSERT INTO public.synthetic_default_dependency VALUES('" +
          first.id +
          "')",
        [],
        'creation_dependent_rows',
      );
      await db.query('SAVEPOINT failure');
      const rows = async () =>
        (await db.query('SELECT id,is_default FROM public.binders WHERE owner_user_id=$1 ORDER BY id', [owner])).rows;
      const before = await rows();
      await db.query(
        "CREATE FUNCTION pg_temp.fail_default() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_default_recorder_failure'; END $$; CREATE TRIGGER synthetic_default_failure BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_default()",
      );
      await rejected(db, () => apply2(db, request2(input, plan.planToken)), /synthetic_default_recorder_failure/);
      assert.deepEqual(await rows(), before);
      await db.query('ROLLBACK TO SAVEPOINT failure');
      await db.query('SAVEPOINT cancelled');
      await db.query(
        "CREATE FUNCTION pg_temp.pause_default() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER synthetic_default_pause BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.pause_default(); SET LOCAL statement_timeout='100ms'",
      );
      await rejected(db, () => apply2(db, request2(input, plan.planToken)), /statement timeout/);
      await db.query('ROLLBACK TO SAVEPOINT cancelled');
      assert.deepEqual(await rows(), before);
      assert.deepEqual(
        (await db.query('SELECT * FROM public.collection_activity WHERE id=$1', [first.event.id])).rows[0],
        first.event,
      );
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE recovery_of_event_id=$1', [
            first.event.id,
          ])
        ).rows[0].n,
        0,
      );
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  'default inverse maximum 4096 long-metadata slots plus 512 later events under unchanged 10s deadline',
  { skip: !socket, timeout: 60000 },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    const db = new Client(config);
    await db.connect();
    try {
      await begin(db);
      const first = await create(db, 4096, owner, true),
        replacement = await create(db, 2);
      for (let n = 0; n < 512; n++) {
        await db.query(
          'UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=$1',
          [owner],
        );
        await flush(db);
      }
      const input = await choice(db, first.event.id, replacement.id);
      const start = performance.now(),
        plan = await preview2(db, input),
        previewMs = Math.round(performance.now() - start);
      assert.deepEqual(plan.conflicts, []);
      assert.equal(plan.changes.length, 4099);
      assert.equal(normalizeStorageResult('recovery.preview.v2', plan).planToken, plan.planToken);
      const applyStart = performance.now(),
        receipt = await apply2(db, request2(input, plan.planToken)),
        applyMs = Math.round(performance.now() - applyStart);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1', [first.id])).rows[0]
          .n,
        0,
      );
      assert.deepEqual(
        await apply2(db, { ...request2(input, plan.planToken), operationId: 'synthetic-new-receipt' }).then(
          () => 'unexpected',
          () => 'rejected',
        ),
        'rejected',
      );
      await db.query('ROLLBACK');
      console.log(
        'synthetic default recovery',
        JSON.stringify({ count: 4096, laterEvents: 512, previewMs, applyMs, eventId: receipt.eventId }),
      );
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

const raceDatabase = process.env.DEFAULT_RECOVERY_RACE_DATABASE;
test(
  'default SQL races: same receipt once, default/legacy/native management, replacement ABA and unlink',
  { skip: !socket || !raceDatabase, timeout: 30000 },
  async () => {
    if (!socket) return;
    if (!raceDatabase) return;
    assert.equal(socket, config.host);
    assert.equal(raceDatabase, 'holofolder_fresh_default_recovery');
    const a = new Client({ ...config, database: raceDatabase }),
      b = new Client({ ...config, database: raceDatabase });
    await a.connect();
    await b.connect();
    const waiting = async (observer: Client, pid: number) => {
      for (let n = 0; n < 100; n++) {
        if (
          (await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]
            ?.wait_event_type === 'Lock'
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail('expected SQL lock wait');
    };
    const tx = (db: Client) => db.query("BEGIN; SET LOCAL statement_timeout='10s'");
    try {
      await begin(a);
      const first = await create(a, 4),
        replacement = await create(a, 2);
      await a.query('COMMIT');
      const input = await choice(a, first.event.id, replacement.id),
        plan = await preview2(a, input, partner),
        recover = request2(input, plan.planToken);
      const aPid = (await a.query('SELECT pg_backend_pid() pid')).rows[0].pid,
        bPid = (await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await tx(a);
      const receipt = await apply2(a, recover, partner);
      for (const [sql, params] of [
        ['DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]],
        ['UPDATE public.partnerships SET owner_user_id=$2 WHERE owner_user_id=$1', [owner, partner]],
        ['UPDATE public.binders SET is_default=false WHERE id=$1', [replacement.id]],
        [
          "INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-race')",
          [owner, first.id],
        ],
        ['SELECT public.developer_reorder_binders($1,$1,$2)', [owner, [replacement.id]]],
        ['SELECT public.developer_delete_binder($1,$1,$2,true)', [owner, replacement.id]],
        ['SELECT pg_advisory_xact_lock(hashtextextended($1,6102))', [owner]],
        ['SELECT pg_advisory_xact_lock(hashtextextended($1,4701))', [owner]],
      ] as const) {
        await b.query("BEGIN; SET LOCAL lock_timeout='100ms'");
        await assert.rejects(
          b.query(sql, [...params]),
          (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '55P03',
        );
        await b.query('ROLLBACK');
      }
      await b.query("BEGIN; SET LOCAL lock_timeout='100ms'");
      await assert.rejects(
        create(b, 1),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '55P03',
      );
      await b.query('ROLLBACK');
      await tx(b);
      const replay = apply2(b, recover, partner);
      await waiting(a, bPid);
      await a.query('COMMIT');
      assert.deepEqual(await replay, receipt);
      await b.query('COMMIT');
      assert.equal(
        (
          await a.query('SELECT count(*)::int n FROM public.collection_activity WHERE recovery_of_event_id=$1', [
            first.event.id,
          ])
        ).rows[0].n,
        1,
      );
      // Restore through existing deletion recovery, then preview the restored default creation's
      // original inverse-of-inverse is intentionally subject to later-history conflicts.
      await tx(a);
      const undo = await preview(a, receipt.eventId);
      await apply(a, request(receipt.eventId, undo.planToken));
      await a.query('COMMIT');
      // New isolated owner is unnecessary: roll back an actual rename while recovery waits on
      // the same replacement row, then prove its committed ABA history invalidates the token.
      // Use a fresh default event by deleting only these synthetic fixtures via account lifetime.
      await a.query('DELETE FROM auth.users WHERE id IN ($1,$2)', [owner, partner]);
      await begin(a);
      const fresh = await create(a, 2),
        alternative = await create(a, 2);
      await a.query('COMMIT');
      const freshInput = await choice(a, fresh.event.id, alternative.id),
        freshPlan = await preview2(a, freshInput, partner);
      await tx(b);
      await b.query("UPDATE public.binders SET name='Synthetic waiting ABA' WHERE id=$1", [alternative.id]);
      await flush(b);
      await b.query('UPDATE public.binders SET name=$2 WHERE id=$1', [alternative.id, alternative.input.name]);
      await flush(b);
      await tx(a);
      const stale = assert.rejects(
        apply2(a, request2(freshInput, freshPlan.planToken), partner),
        /recovery_plan_conflict/,
      );
      await waiting(b, aPid);
      await b.query('COMMIT');
      await stale;
      await a.query('ROLLBACK');
      // Legacy/native management lock wins first: current root/version is re-read after waiting.
      const current = await preview2(a, freshInput, partner);
      await tx(b);
      await b.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6102))', [owner]);
      await b.query("UPDATE public.binders SET name='Synthetic legacy management' WHERE id=$1", [alternative.id]);
      await flush(b);
      await tx(a);
      const management = assert.rejects(
        apply2(a, request2(freshInput, current.planToken), partner),
        /recovery_plan_conflict/,
      );
      await waiting(b, aPid);
      await b.query('COMMIT');
      await management;
      await a.query('ROLLBACK');
      const revoked = await preview2(a, freshInput, partner);
      await tx(b);
      await b.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await tx(a);
      const denied = assert.rejects(
        apply2(a, request2(freshInput, revoked.planToken), partner),
        /recovery_access_denied/,
      );
      await waiting(b, aPid);
      assert.equal(
        (await b.query("SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND granted", [aPid]))
          .rows[0].n,
        0,
      );
      await b.query('COMMIT');
      await denied;
      await a.query('ROLLBACK');
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      await a.end();
      await b.end();
    }
  },
);
