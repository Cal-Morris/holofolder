import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { isStorageCommandRejection } from '@/lib/collection/storage-command-rejection';
import {
  parseInventoryCommand,
  type InsertAssignCommand,
  type InventoryCommand,
} from '@/lib/domain/inventory-commands';
import { projectSlotIntent } from '@/lib/collection/slot-optimistic';
import type { InventorySnapshot } from '@/lib/domain/inventory';

const socket = process.env.ATOMIC_INSERT_TEST_SOCKET;
const owner = '00910000-0000-4000-8000-000000000001',
  partner = '00910000-0000-4000-8000-000000000002';
const stranger = '00910000-0000-4000-8000-000000000003',
  collectionId = '00910000-0000-4000-8000-000000000011';
const identity = { kind: 'pokemon' as const, pokemonId: 25 };
const grading = {
  provider: { kind: 'known', id: 'psa' },
  grade: '9',
  scale: null,
  designation: null,
  subgrades: [],
  certificate: 'synthetic-certificate',
  holder: null,
  label: { variant: null, assetIds: [] },
};

test(
  '091 private restored SQL: atomic insert/assign, real races, replay, rollback, recovery, RLS and 4095→4096 deadline',
  { skip: !socket, timeout: 120000 },
  async () => {
    assert.equal(socket, '/Users/cal/.local/share/holofolder/issue375-atomic-091/socket');
    assert.match(process.env.ATOMIC_INSERT_TEST_DATABASE ?? '', /^atomic091_[a-z0-9_]+$/);
    const { Client } = await import('pg');
    const config = {
      host: socket,
      port: 55591,
      user: 'atomic_test',
      database: process.env.ATOMIC_INSERT_TEST_DATABASE,
    };
    const db = new Client(config),
      other = new Client(config);
    await db.connect();
    await other.connect();
    const originalBilling = (await db.query('SELECT enforced FROM public.billing_configuration WHERE id')).rows[0]
      .enforced;
    try {
      const definitions = async () =>
        (
          await db.query(`SELECT p.oid::regprocedure::text name,p.proacl::text acl,pg_get_functiondef(p.oid) body FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') ORDER BY 1`)
        ).rows;
      const tables = async () =>
        (
          await db.query(`SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`)
        ).rows;
      const before = await definitions(),
        tableBefore = await tables();
      const migration = readFileSync(new URL('../scripts/091_atomic_insert_assign.sql', import.meta.url), 'utf8');
      await db.query(migration);
      const after = await definitions();
      await db.query(migration);
      assert.deepEqual(await definitions(), after);
      assert.deepEqual(await tables(), tableBefore);
      assert.deepEqual(
        after.filter((p) => !p.name.includes('insert_item_v1') && !p.name.startsWith('inventory_command_v1(')),
        before.filter((p) => !p.name.startsWith('inventory_command_v1(')),
      );
      assert.deepEqual(
        after.filter((p) => !p.name.includes('insert_item_v1')).map((p) => [p.name, p.acl]),
        before.map((p) => [p.name, p.acl]),
      );
      const executor = after.find((p) => p.name.startsWith('inventory_command_v1('))!.body;
      assert.ok(executor.indexOf('RETURN prior.result;') < executor.indexOf('-- atomic_insert_assign_091'));
      assert.match(executor, /private_preserving_intent_090/);
      assert.match(executor, /statement_timeout TO '10s'/);
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        for (const fn of [
          'public.inventory_command_v1(uuid,uuid,jsonb,jsonb)',
          'collection_audit_private.insert_item_v1(uuid,jsonb)',
        ]) {
          assert.equal(
            (await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn])).rows[0].allowed,
            false,
          );
        }
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
      await db.query('BEGIN');
      await db.query(
        "INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')",
        [owner, partner, stranger],
      );
      await db.query('UPDATE public.billing_configuration SET enforced=false');
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic atomic insertion',true)",
        [collectionId, owner],
      );
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [collectionId, owner],
      );
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      await db.query(
        "INSERT INTO public.inventory_items(id,owner_user_id,identity,legacy_source,acquired_at,version) VALUES('synthetic-091-copy',$1,$2,'{\"syntheticImmutable\":true}','2020-01-01',3)",
        [owner, identity],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target) SELECT 'synthetic-091-'||i,$1,$2,i,$3 FROM generate_series(0,1) i",
        [collectionId, owner, identity],
      );
      await db.query('COMMIT');
      const header = async (client: typeof db, operationId: string, actor = partner, source = 'app') => {
        await client.query(
          "SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)",
          [
            JSON.stringify({
              'x-holo-audit-context': JSON.stringify({
                actor: { kind: 'user', userId: actor },
                source,
                clientId: 'synthetic-091-client',
                operationId,
                batchId: operationId,
                clientOccurredAt: null,
              }),
            }),
          ],
        );
        await client.query('SET LOCAL ROLE service_role');
      };
      const run = async (request: object, client = db, actor = partner, operation = 'inventory', source = 'app') => {
        await client.query("BEGIN; SET LOCAL statement_timeout='10s'");
        try {
          await header(
            client,
            (request as { operationId?: string }).operationId ?? 'synthetic-091-preview',
            actor,
            source,
          );
          const receipt = (
            await client.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, owner, request])
          ).rows[0].r;
          await client.query('COMMIT');
          return receipt;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      };
      const ref = async (id: string) => {
        const s = (
          await db.query(
            `SELECT s.id,s.version::int,p.inventory_item_id "inventoryItemId",i.version::int "itemVersion",p.version::int "placementVersion"
        FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.id=$1`,
            [id],
          )
        ).rows[0];
        return s;
      };
      const request = async (commands: InventoryCommand[], operationId: string) =>
        parseInventoryCommand({
          operationId,
          inventoryRevision: Number(
            (
              await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [
                owner,
              ])
            ).rows[0].inventory_revision,
          ),
          collections: (
            await db.query(
              'SELECT collection_id "collectionId",version::int,layout_revision::int "layoutRevision" FROM public.storage_collection_state WHERE collection_id=$1',
              [collectionId],
            )
          ).rows,
          commands,
        });
      const insert = (slotId: string, selection: InsertAssignCommand['selection'] = null): InsertAssignCommand => ({
        kind: 'insertAssign',
        collectionId,
        slotId,
        before: null,
        target: null,
        selection,
      });
      const state = async () =>
        (
          await db.query(
            `SELECT
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY position) FROM public.binder_slots s WHERE owner_user_id=$1) slots,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$1) items,
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY inventory_item_id) FROM public.inventory_placements p WHERE owner_user_id=$1) placements,
      (SELECT to_jsonb(t) FROM public.inventory_owner_state t WHERE owner_user_id=$1) root,
      (SELECT to_jsonb(t) FROM public.storage_collection_state t WHERE collection_id=$2) collection,
      (SELECT count(*)::int FROM public.collection_activity WHERE owner_user_id=$1) events,
      (SELECT count(*)::int FROM public.developer_idempotency WHERE actor_id IN ($1,$3) AND result->>'outcome' IS DISTINCT FROM 'rejected') accepted`,
            [owner, collectionId, partner],
          )
        ).rows[0];
      const event = async (operationId: string) =>
        String(
          (
            await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [
              owner,
              operationId,
            ])
          ).rows[0].id,
        );
      const preview = async (eventId: string) =>
        run({ eventId, restoreUnassignedItemIds: [] } as object, db, partner, 'recovery.preview');
      const recover = async (eventId: string, token: string, operationId: string) =>
        run(
          {
            operationId,
            eventId,
            planVersion: 1,
            planToken: token,
            restoreUnassignedItemIds: [],
            confirmed: true,
          } as object,
          db,
          partner,
          'recovery.apply',
        );
      const existing = { kind: 'existing' as const, inventoryItemId: 'synthetic-091-copy', itemVersion: 3 };
      const original = await request(
        [{ ...insert('synthetic-091-inserted', existing), before: await ref('synthetic-091-0'), target: identity }],
        'synthetic-091-original',
      );
      const pristine = await state(),
        receipt = await run(original);
      assert.deepEqual(receipt.selectedItemIds, [existing.inventoryItemId]);
      assert.deepEqual(receipt.acquiredItemIds, []);
      const committed = await state();
      assert.deepEqual(committed.items, pristine.items);
      assert.deepEqual(
        committed.slots.map((s: { id: string }) => s.id),
        ['synthetic-091-inserted', 'synthetic-091-0', 'synthetic-091-1'],
      );
      assert.equal(committed.root.inventory_revision, pristine.root.inventory_revision + 1);
      assert.equal(committed.collection.version, pristine.collection.version + 1);
      assert.equal(committed.collection.layout_revision, pristine.collection.layout_revision + 1);
      assert.equal(committed.events, pristine.events + 1);
      assert.equal(committed.accepted, pristine.accepted + 1);
      const originalEvent = await event(original.operationId),
        plan = await preview(originalEvent);
      assert.equal(plan.supported, true);
      assert.deepEqual(plan.conflicts, []);
      await recover(originalEvent, plan.planToken, 'synthetic-091-recover-reused');
      const restored = await state();
      assert.deepEqual(restored.items, pristine.items);
      assert.equal(restored.placements, null);
      assert.deepEqual(
        restored.slots.map((s: { id: string }) => s.id),
        pristine.slots.map((s: { id: string }) => s.id),
      );
      assert.deepEqual(
        await run(original),
        receipt,
        'lost reply after inverse returns original result, does not resurrect',
      );
      assert.deepEqual(await state(), restored);
      await assert.rejects(
        run({ ...original, commands: [{ ...original.commands[0], target: null }] }),
        /idempotency_conflict/,
      );
      await assert.rejects(run(original, db, stranger), /access_denied/);
      await assert.rejects(run(original, db, partner, 'inventory', 'rest'), /premium_required/);
      // Same original versions/copy contested over real connections. One terminal rejection, one acquisition-free placement.
      const a = await request([insert('synthetic-091-race-a', existing)], 'synthetic-091-race-a');
      const b = { ...a, operationId: 'synthetic-091-race-b', commands: [insert('synthetic-091-race-b', existing)] };
      const race = await Promise.all([run(a), run(b, other)]);
      assert.equal(race.filter((r) => r.changed === true).length, 1);
      const rejected = race.find((r) => r.outcome === 'rejected');
      assert.ok(isStorageCommandRejection(rejected, rejected.operationId));
      const loser = rejected.operationId === a.operationId ? a : b;
      assert.deepEqual(await run(loser), rejected);
      const ledger = (
        await db.query(
          "SELECT result FROM public.developer_idempotency WHERE actor_id=$1 AND operation='inventory_v1' AND request_key=$2",
          [partner, rejected.operationId],
        )
      ).rows;
      assert.deepEqual(ledger, [{ result: rejected }]);
      assert.equal((await state()).placements.length, 1);
      // Explicit acquisition + insertion is one event; its inverse removes only the proved new copy and slot.
      const created = await request(
        [
          insert('synthetic-091-new-slot', {
            kind: 'new',
            itemId: 'synthetic-091-new-copy',
            identity,
            grading: null,
            acquiredAt: null,
          }),
        ],
        'synthetic-091-new',
      );
      assert.deepEqual((await run(created)).acquiredItemIds, ['synthetic-091-new-copy']);
      const createdEvent = await event(created.operationId),
        newPlan = await preview(createdEvent);
      assert.equal(newPlan.supported, true);
      assert.deepEqual(newPlan.conflicts, []);
      await recover(createdEvent, newPlan.planToken, 'synthetic-091-recover-new');
      assert.equal(
        (await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='synthetic-091-new-copy'")).rows[0]
          .n,
        0,
      );
      const stable = await state();
      await run(created);
      assert.deepEqual(await state(), stable);
      // Target-only free insertion creates no item. Later content edit makes its old inverse stale.
      const targetOnly = await request(
        [{ ...insert('synthetic-091-target'), target: identity }],
        'synthetic-091-target',
      );
      const targetReceipt = await run(targetOnly);
      assert.deepEqual(targetReceipt.selectedItemIds, []);
      assert.deepEqual(targetReceipt.acquiredItemIds, []);
      const targetEvent = await event(targetOnly.operationId),
        targetPlan = await preview(targetEvent);
      const targetSlot = await ref('synthetic-091-target');
      await run(
        await request(
          [
            {
              kind: 'assign',
              destination: { collectionId, slot: targetSlot },
              selection: { kind: 'catalog', identity: { kind: 'card', cardId: 'missing' }, newItemId: 'missing' },
              occupied: 'cancel',
              fulfillWant: null,
            },
          ],
          'synthetic-091-missing-catalog',
        ),
      ).then(
        () => assert.fail('catalog must reject'),
        () => {},
      );
      // Genuine later slot edit through the existing slot executor, not a fake history counter.
      const root = (await state()).root.inventory_revision,
        col = (await state()).collection;
      await run(
        {
          operationId: 'synthetic-091-later-target',
          collectionId,
          inventoryRevision: root,
          collectionVersion: col.version,
          layoutRevision: col.layout_revision,
          commands: [{ kind: 'update', slot: targetSlot, target: null }],
        } as object,
        db,
        owner,
        'slots',
      );
      const staleRecoveryId = 'synthetic-091-stale-inverse';
      await assert.rejects(recover(targetEvent, targetPlan.planToken, staleRecoveryId), /conflict/);
      assert.ok((await preview(targetEvent)).conflicts.length > 0);
      // A late command failure rolls back its earlier insertion/acquisition; terminal receipt is the only extra row.
      const failed = await request(
        [
          insert('synthetic-091-partial', {
            kind: 'new',
            itemId: 'synthetic-091-orphan',
            identity,
            grading: null,
            acquiredAt: null,
          }),
          insert('synthetic-091-partial-2', { ...existing, itemVersion: 99 }),
        ],
        'synthetic-091-late-fail',
      );
      const noPartial = await state(),
        failReceipt = await run(failed);
      assert.equal(failReceipt.outcome, 'rejected');
      assert.equal(failReceipt.code, 'item_conflict');
      assert.deepEqual(await state(), noPartial);
      // Stale anchor/item, occupied copy, global ID collision and capacity never leave a slot or acquisition.
      for (const c of [
        { ...insert('synthetic-091-bad-anchor'), before: { ...(await ref('synthetic-091-0')), version: 99 } },
        insert('synthetic-091-0'),
        insert('synthetic-091-no-steal', existing),
        insert('synthetic-091-item-collision', {
          kind: 'new',
          itemId: existing.inventoryItemId,
          identity,
          grading: null,
          acquiredAt: null,
        }),
        {
          ...insert('synthetic-091-mismatch', {
            kind: 'new' as const,
            itemId: 'synthetic-091-mismatch-copy',
            identity,
            grading: null,
            acquiredAt: null,
          }),
          target: { kind: 'pokemon' as const, pokemonId: 1 },
        },
      ]) {
        const q = await request([c], `synthetic-091-fail-${c.slotId}`),
          beforeFail = await state();
        try {
          const r = await run(q);
          assert.equal(r.outcome, 'rejected');
        } catch (error) {
          assert.match(String(error), /mismatch|conflict/);
        }
        assert.deepEqual(await state(), beforeFail);
      }
      // Deferred recorder failure and external cancellation abort receipt/state/history together.
      const auditFail = await request([insert('synthetic-091-audit-fail')], 'synthetic-091-audit-fail'),
        auditState = await state();
      await db.query('BEGIN');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_091_audit_failure'; END $$",
      );
      await header(db, auditFail.operationId);
      await db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, auditFail]);
      await assert.rejects(db.query('COMMIT'), /synthetic_091_audit_failure/);
      await db.query('ROLLBACK');
      assert.deepEqual(await state(), auditState);
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            auditFail.operationId,
          ])
        ).rows[0].n,
        0,
      );
      // Cancel at deferred flush AFTER the insertion and ledger writes have happened.
      const flushDefinition = after.find((p) => p.name === 'collection_audit_private.flush()')!.body;
      const delayedFlush = flushDefinition.replace('\nBEGIN\n', '\nBEGIN\n PERFORM pg_sleep(0.05);\n');
      assert.notEqual(delayedFlush, flushDefinition);
      await db.query('BEGIN');
      await db.query(delayedFlush);
      await header(db, auditFail.operationId);
      await db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, auditFail]);
      await db.query("SET LOCAL statement_timeout='1ms'");
      await assert.rejects(db.query('SET CONSTRAINTS ALL IMMEDIATE'), /statement timeout/);
      await db.query('ROLLBACK');
      assert.deepEqual(await state(), auditState);
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [
            auditFail.operationId,
          ])
        ).rows[0].n,
        0,
      );
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4701))', [owner]);
      await db.query("BEGIN; SET LOCAL statement_timeout='1ms'");
      await header(db, auditFail.operationId);
      await assert.rejects(
        db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, auditFail]),
        /statement timeout/,
      );
      await db.query('ROLLBACK');
      await other.query('ROLLBACK');
      assert.deepEqual(await state(), auditState);
      assert.equal((await run(auditFail)).changed, true);
      // Billing rollback uses app source, so the developer paid gate cannot mask the saved-card gate.
      const billing = await request(
        [
          insert('synthetic-091-billing', {
            kind: 'new',
            itemId: 'synthetic-091-billing-copy',
            identity,
            grading: null,
            acquiredAt: null,
          }),
        ],
        'synthetic-091-billing',
      );
      const billingState = await state();
      await db.query('BEGIN');
      await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=1');
      await header(db, billing.operationId, owner);
      await assert.rejects(
        db.query('SELECT public.storage_execute_v1($1,$2,$3)', ['inventory', owner, billing]),
        /card_limit_reached/,
      );
      await db.query('ROLLBACK');
      assert.deepEqual(await state(), billingState);
      // RLS/private copy metadata and write denial remain intact.
      for (const actor of [owner, partner, stranger]) {
        await db.query('BEGIN');
        await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ role: 'authenticated', sub: actor }),
        ]);
        await db.query('SET LOCAL ROLE authenticated');
        assert.equal(
          (await db.query('SELECT id FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows.length,
          actor === stranger ? 0 : 1,
        );
        await assert.rejects(
          db.query(
            "INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES('synthetic-forbidden',$1,$2,100)",
            [owner, collectionId],
          ),
          /permission denied/,
        );
        await db.query('ROLLBACK');
      }
      // Actual private asset event stays explicitly unsupported, while public grading/certificate are retained on reuse.
      await db.query('BEGIN');
      await db.query(
        "INSERT INTO public.tcg_series(id) VALUES('synthetic-091-series'); INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-091-set','synthetic-091-series'); INSERT INTO public.tcg_cards(id,set_id,series_id,local_id) VALUES('synthetic-091-card','synthetic-091-set','synthetic-091-series','1')",
      );
      await db.query(
        'INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES(\'synthetic-091-graded\',$1,\'{"kind":"card","cardId":"synthetic-091-card"}\',$2,\'2020-01-01\')',
        [owner, { ...grading, label: { variant: null, assetIds: ['synthetic-private-asset'] } }],
      );
      await db.query('COMMIT');
      const slab = await request(
        [insert('synthetic-091-slab', { kind: 'existing', inventoryItemId: 'synthetic-091-graded', itemVersion: 0 })],
        'synthetic-091-slab',
      );
      const slabBefore = (
        await db.query("SELECT to_jsonb(i) r FROM public.inventory_items i WHERE id='synthetic-091-graded'")
      ).rows[0].r;
      await run(slab);
      assert.deepEqual(
        (await db.query("SELECT to_jsonb(i) r FROM public.inventory_items i WHERE id='synthetic-091-graded'")).rows[0]
          .r,
        slabBefore,
      );
      const slabPlan = await preview(await event(slab.operationId));
      assert.equal(slabPlan.supported, true, 'placement-only inverse does not restore private asset metadata');
      const assetNew = await request(
        [
          insert('synthetic-091-asset-slot', {
            kind: 'new',
            itemId: 'synthetic-091-asset-copy',
            identity: { kind: 'card', cardId: 'synthetic-091-card' },
            grading: {
              ...grading,
              provider: { kind: 'known', id: 'psa' },
              label: { variant: null, assetIds: ['synthetic-new-private-asset'] },
            },
            acquiredAt: null,
          }),
        ],
        'synthetic-091-asset-new',
      );
      await run(assetNew);
      const assetPatch = await request(
        [
          {
            kind: 'patchGrading',
            item: {
              itemId: 'synthetic-091-asset-copy',
              itemVersion: 0,
              placement: { collectionId, slot: await ref('synthetic-091-asset-slot') },
            },
            patch: { holder: 'synthetic changed holder' },
          },
        ],
        'synthetic-091-asset-patch',
      );
      await run(assetPatch);
      const assetPlan = await preview(await event(assetPatch.operationId));
      assert.equal(assetPlan.supported, false);
      assert.ok(assetPlan.unsupported.includes('private_assets_unverifiable'));
      // Worst near-start insertion, full 4095→4096 order, real deferred capture and audit within 10s.
      await db.query('BEGIN');
      const count = Number(
        (await db.query('SELECT count(*) n FROM public.binder_slots WHERE collection_id=$1', [collectionId])).rows[0].n,
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) SELECT 'synthetic-091-large-'||i,$1,$2,i FROM generate_series($3::int,4094) i",
        [collectionId, owner, count],
      );
      await db.query(
        `INSERT INTO public.inventory_items(id,owner_user_id,identity,acquired_at)
      SELECT 'synthetic-091-owned-'||s.id,$1,$3,'2020-01-01' FROM public.binder_slots s
      WHERE s.collection_id=$2 AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.slot_id=s.id)`,
        [owner, collectionId, identity],
      );
      await db.query(
        `INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id)
      SELECT i.id,$1,$2,s.id FROM public.binder_slots s JOIN public.inventory_items i ON i.id='synthetic-091-owned-'||s.id WHERE s.collection_id=$2`,
        [owner, collectionId],
      );
      await db.query(
        "UPDATE public.binder_slots SET status='collected',version=version+1 WHERE collection_id=$1 AND status IS NULL",
        [collectionId],
      );
      await db.query('COMMIT');
      const large = await request(
        [
          {
            ...insert('synthetic-091-4096', {
              kind: 'new',
              itemId: 'synthetic-091-4096-copy',
              identity,
              grading: null,
              acquiredAt: null,
            }),
            before: await ref('synthetic-091-0'),
            target: identity,
          },
        ],
        'synthetic-091-4096',
      );
      const orderBefore = (
        await db.query('SELECT id FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [collectionId])
      ).rows.map((r) => r.id);
      const largeBaseline = await state();
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      await header(db, large.operationId);
      const explain = (
        await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.storage_execute_v1($1,$2,$3)', [
          'inventory',
          owner,
          large,
        ])
      ).rows[0]['QUERY PLAN'][0];
      assert.equal(explain.Plan['Actual Rows'], 1);
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      await db.query('ROLLBACK');
      assert.deepEqual(await state(), largeBaseline);
      console.info(
        `Synthetic rolled-back insertion EXPLAIN: ${explain['Execution Time'].toFixed(1)} ms, ${explain.Plan['Shared Hit Blocks']} shared hits, ${explain.Plan['Temp Read Blocks']} temp blocks read`,
      );
      const start = performance.now();
      const largeReceipt = await run(large);
      const elapsed = performance.now() - start;
      assert.ok(elapsed < 10000);
      assert.equal(largeReceipt.changed, true);
      const orderAfter = (
        await db.query('SELECT id FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [collectionId])
      ).rows.map((r) => r.id);
      const at = orderBefore.indexOf('synthetic-091-0');
      assert.deepEqual(orderAfter, [...orderBefore.slice(0, at), 'synthetic-091-4096', ...orderBefore.slice(at)]);
      assert.equal(orderAfter.length, 4096);
      const measured = (
        await db.query(
          'SELECT jsonb_array_length(recovery_state)::int entities,octet_length(recovery_state::text)::int bytes FROM public.collection_activity WHERE id=$1',
          [await event(large.operationId)],
        )
      ).rows[0];
      assert.ok(measured.entities <= 16384);
      assert.ok(measured.bytes <= 16777216);
      const fullState = await state();
      await assert.rejects(run(await request([insert('synthetic-091-4097')], 'synthetic-091-4097')), /capacity/);
      assert.deepEqual(await state(), fullState);
      assert.deepEqual(await run(large), largeReceipt);
      assert.deepEqual(await state(), fullState);
      const largeEvent = await event(large.operationId),
        recoveryStart = performance.now();
      const largePlan = await preview(largeEvent);
      assert.equal(largePlan.supported, true);
      assert.deepEqual(largePlan.conflicts, []);
      const previewMs = performance.now() - recoveryStart,
        applyStart = performance.now();
      const largeRecoveryId = 'synthetic-091-4096-inverse';
      await recover(largeEvent, largePlan.planToken, largeRecoveryId);
      const applyMs = performance.now() - applyStart;
      assert.ok(previewMs < 10000 && applyMs < 10000);
      assert.deepEqual(
        (
          await db.query('SELECT id FROM public.binder_slots WHERE collection_id=$1 ORDER BY position', [collectionId])
        ).rows.map((r) => r.id),
        orderBefore,
      );
      const afterInverse = await state();
      assert.deepEqual(afterInverse.items, largeBaseline.items);
      assert.deepEqual(afterInverse.placements, largeBaseline.placements);
      await run(large);
      assert.deepEqual(await state(), afterInverse);
      console.info(
        `Synthetic restored-cluster large inverse: ${previewMs.toFixed(1)} ms preview, ${applyMs.toFixed(1)} ms apply/commit`,
      );
      console.info(
        `Synthetic restored-cluster near-start 4095→4096: ${elapsed.toFixed(1)} ms including commit/audit; ${measured.entities} audit entities, ${measured.bytes} bytes`,
      );
      // Real local conversion: insertion must never rewrite frozen legacy rows, mappings or receipt.
      const converted = '00910000-0000-4000-8000-000000000012';
      await db.query('BEGIN');
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic converted',false)",
        [converted, owner],
      );
      await db.query(
        "INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status,collected_at) VALUES($1,$2,25,'Synthetic Pikachu','collected','2020-01-01')",
        [converted, owner],
      );
      await db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      await db.query(
        "SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')",
        [converted, owner],
      );
      await db.query('COMMIT');
      const frozen = async () =>
        (
          await db.query(
            `SELECT
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.pokemon_collection t WHERE binder_id=$1) original,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY legacy_row_id) FROM public.binder_legacy_rows t WHERE collection_id=$1) mappings,
      (SELECT to_jsonb(t)-ARRAY['version','layout_revision'] FROM public.storage_collection_state t WHERE collection_id=$1) conversion`,
            [converted],
          )
        ).rows[0];
      const frozenBefore = await frozen(),
        convertedCommand = {
          ...insert('synthetic-091-converted'),
          collectionId: converted,
          before: await ref(`legacy-dex-v1/${converted}/2`),
        };
      const convertedRequest = {
        ...(await request([insert('unused')], 'synthetic-091-converted')),
        collections: (
          await db.query(
            'SELECT collection_id "collectionId",version::int,layout_revision::int "layoutRevision" FROM public.storage_collection_state WHERE collection_id=$1',
            [converted],
          )
        ).rows,
        commands: [convertedCommand],
      };
      await run(convertedRequest);
      assert.deepEqual(await frozen(), frozenBefore);
      const convertedEvent = await event(convertedRequest.operationId),
        convertedPlan = await preview(convertedEvent);
      assert.equal(convertedPlan.supported, true);
      assert.deepEqual(convertedPlan.conflicts, []);
      await recover(convertedEvent, convertedPlan.planToken, 'synthetic-091-converted-inverse');
      assert.deepEqual(await frozen(), frozenBefore);
      // Complete original intent also agrees with the typed durable projector for an empty acquisition-free insert.
      const snapshot: InventorySnapshot = {
        ownerUserId: owner,
        inventoryRevision: 0,
        items: [],
        placements: [],
        collections: [
          {
            id: collectionId,
            ownerUserId: owner,
            name: 'Synthetic',
            kind: 'binder',
            defaultPresentation: 'binder',
            version: 0,
          },
        ],
        binders: [{ ownerUserId: owner, collectionId, layoutRevision: 0, presetManifest: null, slots: [] }],
      };
      const q = {
        operationId: 'synthetic-091-project',
        inventoryRevision: 0,
        collections: [{ collectionId, version: 0, layoutRevision: 0 }],
        commands: [insert('synthetic-091-project')],
      };
      assert.equal(
        projectSlotIntent(
          snapshot,
          {
            kind: 'inventory',
            request: q,
            context: {
              source: 'app',
              clientId: null,
              operationId: q.operationId,
              batchId: null,
              clientOccurredAt: null,
            },
          },
          () => undefined,
        ).binders[0].slots.length,
        1,
      );
    } finally {
      await db.query('ROLLBACK');
      await other.query('ROLLBACK');
      await db.query('UPDATE public.billing_configuration SET enforced=$1 WHERE id', [originalBilling]);
      await other.end();
      await db.end();
    }
  },
);
