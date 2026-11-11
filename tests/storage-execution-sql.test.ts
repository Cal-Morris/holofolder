import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract';

const socket = process.env.STORAGE_BRIDGE_TEST_SOCKET;
const owner = '00820000-0000-4000-8000-000000000001',
  partner = '00820000-0000-4000-8000-000000000002';
const stranger = '00820000-0000-4000-8000-000000000003',
  binder = '00820000-0000-4000-8000-000000000011';
test(
  'trusted storage SQL: service-only wrapper, immutable helpers, real command/recovery receipts and authorization',
  { skip: !socket, timeout: 60000 },
  async () => {
    if (!socket) return;
    assert.equal(socket, '/Users/cal/.local/share/holofolder/issue396-bridge-local/socket');
    const { Client } = await import('pg');
    const db = new Client({ host: socket, port: 55582, user: 'bridge_test', database: 'postgres' });
    await db.connect();
    try {
      const definitions = async () =>
        (
          await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text acl,p.proowner,md5(pg_get_functiondef(p.oid)) digest FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') AND p.proname<>'storage_execute_v1' ORDER BY 1`)
        ).rows;
      const tableAcls = async () =>
        (
          await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)
        ).rows;
      const beforeTables = await tableAcls();
      const before = await definitions();
      const migration = readFileSync(new URL('../scripts/082_trusted_storage_execution.sql', import.meta.url), 'utf8');
      await db.query(migration);
      await db.query(migration);
      assert.deepEqual(await tableAcls(), beforeTables, 'existing table/schema access and RLS remain unchanged');
      assert.deepEqual(await definitions(), before, 'all existing function bodies and ACLs preserved');
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        const helpers = (
          await db.query(
            `SELECT p.proname,has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='collection_audit_private' OR p.proname IN ('inventory_command_v1','inventory_object_v1','inventory_id_v1','inventory_revision_v1','inventory_match_v1','inventory_item_ref_v1','inventory_evidence_v1','slot_command_v1','slot_page_v1','slot_check_ref_v1','slot_check_target_v1','slot_catalog_card_v1','slot_catalog_ids_v1','slot_saved_count_v1')`,
            [role],
          )
        ).rows;
        assert.ok(
          helpers.every((p) => !p.allowed),
          role,
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
      const recovery = (
        await db.query(
          "SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) body",
        )
      ).rows[0].body;
      assert.equal(recovery.match(/plan:=collection_audit_private.recovery_plan_v1/g)?.length, 2);
      assert.equal(recovery.match(/reviewed:=collection_audit_private.recovery_preview_v1/g)?.length, 1);
      assert.ok(recovery.indexOf('FROM public.partnerships') < recovery.indexOf('4701'));
      assert.ok(recovery.includes('frozen_restore_rows'));
      await db.query("BEGIN; SET LOCAL TIME ZONE 'UTC'; SET LOCAL statement_timeout='10s'");
      const flush = () => db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      const rejected = async (run: () => Promise<unknown>, code: string) => {
        await db.query('SAVEPOINT rejected');
        await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code);
        await db.query('ROLLBACK TO SAVEPOINT rejected');
      };
      await db.query(
        "INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')",
        [owner, partner, stranger],
      );
      await db.query('UPDATE public.billing_configuration SET enforced=false');
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic bridge',true)",
        [binder, owner],
      );
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [binder, owner],
      );
      await flush();
      const header = async (actor = partner, source = 'app', operationId = 'synthetic-bridge-1') => {
        await db.query('RESET ROLE');
        await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [
          JSON.stringify({
            'x-holo-audit-context': JSON.stringify({
              actor: { kind: 'user', userId: actor },
              source,
              clientId: null,
              operationId,
              batchId: operationId,
              clientOccurredAt: null,
            }),
          }),
          JSON.stringify({ role: 'service_role' }),
        ]);
        await db.query('SET LOCAL ROLE service_role');
      };
      const call = async (operation: string, request: unknown, target = owner) =>
        (await db.query('SELECT public.storage_execute_v1($1,$2,$3) result', [operation, target, request])).rows[0]
          .result;
      const revisions = async () => {
        await db.query('RESET ROLE');
        const r = (
          await db.query(
            'SELECT inventory_revision,version,layout_revision FROM public.inventory_owner_state i JOIN public.storage_collection_state s USING(owner_user_id) WHERE s.collection_id=$1',
            [binder],
          )
        ).rows[0];
        return {
          inventoryRevision: Number(r.inventory_revision),
          collectionVersion: Number(r.version),
          layoutRevision: Number(r.layout_revision),
        };
      };
      const request = {
        collectionId: binder,
        operationId: 'synthetic-bridge-slots',
        ...(await revisions()),
        commands: [{ kind: 'create', ids: ['synthetic/bridge-slot'], beforeSlotId: null }],
      };
      await header(partner, 'app', request.operationId);
      const created = await call('slots', request);
      assert.equal(normalizeStorageResult('slots', created).changed, true);
      await flush();
      await header(partner, 'app', request.operationId);
      assert.deepEqual(await call('slots', request), created, 'stale original request replays exact receipt');
      await rejected(() => call('slots', { ...request, inventoryRevision: request.inventoryRevision + 1 }), '40001');
      await flush();
      const state = await revisions();
      const add = {
        operationId: 'synthetic-bridge-add',
        inventoryRevision: state.inventoryRevision,
        collections: [],
        commands: [
          {
            kind: 'add',
            itemId: 'synthetic/bridge-copy',
            identity: { kind: 'pokemon', pokemonId: 1 },
            grading: null,
            acquiredAt: null,
          },
        ],
      };
      await header(partner, 'app', add.operationId);
      const added = await call('inventory', add);
      assert.equal(normalizeStorageResult('inventory', added).changed, true);
      assert.equal('evidence' in added, false);
      await flush();
      const event = (
        await db.query(
          'SELECT id::text,actor_user_id,source,operation_id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
          [owner, add.operationId],
        )
      ).rows[0];
      assert.equal(event.actor_user_id, partner);
      assert.equal(event.source, 'app');
      await header(partner, 'app', add.operationId);
      assert.deepEqual(await call('inventory', add), added);
      await rejected(() => call('inventory', { ...add, inventoryRevision: add.inventoryRevision + 1 }), '40001');
      await rejected(() => call('inventory', { ...add, operationId: 'synthetic-other-id' }), '42501');
      const previewRequest = { eventId: event.id, restoreUnassignedItemIds: [] };
      const preview = await call('recovery.preview', previewRequest);
      assert.ok(normalizeStorageResult('recovery.preview', preview).planToken);
      await rejected(() => call('recovery.preview', { ...previewRequest, source: 'app' }), '22023');
      await flush();
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1', [owner]))
          .rows[0].n,
        3,
        'preview and replay append no event',
      );
      const apply = {
        ...previewRequest,
        operationId: 'synthetic-bridge-recover',
        planVersion: 1,
        planToken: preview.planToken,
        confirmed: true,
      };
      await header(partner, 'app', apply.operationId);
      await rejected(() => call('recovery.apply', { ...apply, confirmed: false }), '22023');
      await rejected(() => call('recovery.apply', { ...apply, planToken: '0'.repeat(64) }), '40001');
      await header(owner, 'app', apply.operationId);
      await rejected(() => call('recovery.apply', apply), '40001');
      await header(partner, 'app', apply.operationId);
      const recovered = await call('recovery.apply', apply);
      assert.equal(normalizeStorageResult('recovery.apply', recovered).recoveredEventId, event.id);
      await flush();
      await header(partner, 'app', apply.operationId);
      assert.deepEqual(await call('recovery.apply', apply), recovered);
      await flush();
      const link = (
        await db.query(
          'SELECT recovery_of_event_id::text,actor_user_id,source FROM public.collection_activity WHERE id=$1',
          [recovered.eventId],
        )
      ).rows[0];
      assert.equal(link.recovery_of_event_id, event.id);
      assert.equal(link.actor_user_id, partner);
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='synthetic/bridge-copy'")).rows[0]
          .n,
        0,
      );
      const evidence = async () => {
        await db.query('RESET ROLE');
        return (
          await db.query(
            `SELECT
        (SELECT count(*)::int FROM public.inventory_items WHERE owner_user_id=$1) items,
        (SELECT count(*)::int FROM public.collection_activity WHERE owner_user_id=$1) events,
        (SELECT count(*)::int FROM public.developer_idempotency WHERE actor_id IN ($1,$2)) ledger,
        (SELECT inventory_revision::text FROM public.inventory_owner_state WHERE owner_user_id=$1) revision`,
            [owner, partner],
          )
        ).rows[0];
      };
      const unchanged = await evidence();
      const stale = { ...add, operationId: 'synthetic-bridge-stale' };
      await header(partner, 'app', stale.operationId);
      await rejected(() => call('inventory', stale), '40001');
      assert.deepEqual(await evidence(), unchanged);
      const timed = {
        ...add,
        operationId: 'synthetic-bridge-deadline',
        inventoryRevision: (await revisions()).inventoryRevision,
        commands: Array.from({ length: 100 }, (_, n) => ({ ...add.commands[0], itemId: `synthetic/deadline-${n}` })),
      };
      await header(partner, 'app', timed.operationId);
      await db.query("SET LOCAL statement_timeout='1ms'");
      await rejected(() => call('inventory', timed), '57014');
      await db.query("SET LOCAL statement_timeout='10s'");
      assert.deepEqual(await evidence(), unchanged, 'outer statement cancellation rolls the whole intent back');
      // Recorder failure must roll the command, root version and ledger back with its audit.
      await db.query('SAVEPOINT recorder');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_bridge_recorder_failure'; END $$",
      );
      const failed = {
        ...add,
        operationId: 'synthetic-bridge-recorder',
        inventoryRevision: (await revisions()).inventoryRevision,
      };
      await header(partner, 'app', failed.operationId);
      await assert.rejects(async () => {
        await call('inventory', failed);
        await flush();
      }, /synthetic_bridge_recorder_failure/);
      await db.query('ROLLBACK TO SAVEPOINT recorder');
      assert.deepEqual(await evidence(), unchanged);
      await db.query('SAVEPOINT allowance; UPDATE public.billing_configuration SET enforced=true,free_card_limit=10');
      await db.query(
        `INSERT INTO public.inventory_items(id,owner_user_id,identity)
      SELECT 'synthetic/allowance-'||n,$1,'{"kind":"pokemon","pokemonId":1}' FROM generate_series(1,10) n`,
        [owner],
      );
      await flush();
      const full = await evidence();
      const over = {
        ...add,
        operationId: 'synthetic-bridge-allowance',
        inventoryRevision: (await revisions()).inventoryRevision,
      };
      await header(owner, 'app', over.operationId);
      await rejected(() => call('inventory', over), 'P0001');
      assert.deepEqual(await evidence(), full, 'failed allowance leaves data, audit, revision and ledger unchanged');
      await db.query('ROLLBACK TO SAVEPOINT allowance');
      assert.deepEqual(await evidence(), unchanged);
      // Service-key authority cannot bypass the authenticated actor's current membership or paid developer requirement.
      await header(stranger);
      await rejected(() => call('recovery.preview', previewRequest), '42501');
      await header(partner, 'rest');
      await rejected(() => call('recovery.preview', previewRequest), 'HF402');
      await db.query(
        "RESET ROLE; INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES('" + owner + "','manual')",
      );
      await header(partner, 'mcp');
      assert.equal((await call('recovery.preview', previewRequest)).eventId, event.id);
      for (const source of ['rest', 'mcp']) {
        const actor = source === 'rest' ? owner : partner;
        const mutation = {
          ...add,
          operationId: `synthetic-bridge-${source}`,
          inventoryRevision: (await revisions()).inventoryRevision,
          commands: [{ ...add.commands[0], itemId: `synthetic/source-${source}` }],
        };
        await header(actor, source, mutation.operationId);
        await call('inventory', mutation);
        await flush();
        const attribution = (
          await db.query(
            'SELECT actor_user_id,source,operation_id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
            [owner, mutation.operationId],
          )
        ).rows[0];
        assert.deepEqual(attribution, { actor_user_id: actor, source, operation_id: mutation.operationId });
        await header(actor, source === 'rest' ? 'mcp' : 'rest', mutation.operationId);
        await rejected(() => call('inventory', mutation), '40001');
      }
      await db.query("RESET ROLE; DELETE FROM public.partnerships WHERE owner_user_id='" + owner + "'");
      await header(partner, 'app', apply.operationId);
      await rejected(() => call('recovery.apply', apply), '42501');
      // Hostile user-supplied headers and arbitrary GUCs never create the service role.
      for (const role of ['anon', 'authenticated', 'holo_mcp']) {
        await db.query('RESET ROLE; SET LOCAL ROLE ' + role);
        await rejected(() => call('recovery.preview', previewRequest), '42501');
        await rejected(
          () => db.query("SELECT collection_audit_private.recovery_preview_v1($1,$1,1,'{}')", [owner]),
          '42501',
        );
        await rejected(() => db.query("SELECT public.inventory_command_v1($1,$1,'{}','{}')", [owner]), '42501');
      }
      // Remove the test superuser's effective session authority before testing role escalation.
      for (const role of ['anon', 'authenticated', 'holo_mcp']) {
        await db.query('RESET ROLE; SET SESSION AUTHORIZATION ' + role);
        await rejected(() => db.query("SELECT set_config('role','service_role',true)"), '42501');
        await rejected(() => call('recovery.preview', previewRequest), '42501');
        await db.query('RESET SESSION AUTHORIZATION');
      }
      await db.query("RESET ROLE; SELECT set_config('request.headers','{}',true); SET LOCAL ROLE service_role");
      await rejected(() => call('recovery.preview', previewRequest), '42501');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
