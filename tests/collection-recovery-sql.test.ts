import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateRecoveryDatabase } from './private-recovery-db';
import { readFileSync } from 'node:fs';

const socket = process.env.COLLECTION_RECOVERY_TEST_SOCKET;
const owner = '03960000-0000-4000-8000-000000000001';
const partner = '03960000-0000-4000-8000-000000000002';
const binder = '03960000-0000-4000-8000-000000000011';
const source = { source: 'app', clientId: null, batchId: null, clientOccurredAt: null };
// All fixtures below are synthetic, and all fixture writes roll back.
test(
  'private recovery SQL: reviewed inverse, stable copies, conflicts, atomic audit and bounded bulk',
  { skip: !socket, timeout: 60000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const db = new Client(
      privateRecoveryDatabase(socket, {
        socket: '/Users/cal/.local/share/holofolder/issue396-local/socket',
        port: 55496,
        user: 'issue396_test',
      }),
    );
    await db.connect();
    try {
      const migration = readFileSync(new URL('../scripts/077_safe_collection_recovery.sql', import.meta.url), 'utf8');
      await db.query(migration);
      await db.query(migration);
      if (
        ['issue396-perf-local', 'issue396-converted-local', 'issue396-cascade-local'].some((name) =>
          socket.includes(name),
        )
      ) {
        const performanceMigration = readFileSync(
          new URL('../scripts/079_bounded_collection_recovery.sql', import.meta.url),
          'utf8',
        );
        await db.query(performanceMigration);
        await db.query(performanceMigration);
      }
      if (socket.includes('issue396-converted-local') || socket.includes('issue396-cascade-local')) {
        const convertedMigration = readFileSync(
          new URL('../scripts/080_converted_content_recovery.sql', import.meta.url),
          'utf8',
        );
        await db.query(convertedMigration);
        await db.query(convertedMigration);
      }
      if (socket.includes('issue396-cascade-local')) {
        await db.query(readFileSync(new URL('../scripts/081_converted_cascade_recovery.sql', import.meta.url), 'utf8'));
      }
      await db.query("BEGIN; SET LOCAL statement_timeout='30s'");
      const flush = () => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      const rejected = async (run: () => Promise<unknown>, error: RegExp) => {
        await db.query('SAVEPOINT rejected');
        await assert.rejects(run(), error);
        await db.query('ROLLBACK TO SAVEPOINT rejected');
      };
      await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [
        owner,
        partner,
      ]);
      await db.query('UPDATE public.billing_configuration SET enforced=false');
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic recovery',true)",
        [binder, owner],
      );
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [binder, owner],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) SELECT 'synthetic/slot-'||n,$1,$2,n FROM generate_series(0,2) n",
        [binder, owner],
      );
      await db.query(
        "INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES('synthetic/copy-a',$1,$2),('synthetic/copy-b',$1,$2)",
        [owner, { kind: 'pokemon', pokemonId: 1 }],
      );
      await flush();
      const event = async () =>
        (
          await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
            owner,
          ])
        ).rows[0];
      const count = async () =>
        (await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1', [owner]))
          .rows[0].n;
      const preview = async (id: string, unassigned: string[] = [], actor = partner) =>
        (
          await db.query('SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,$4) p', [
            actor,
            owner,
            id,
            unassigned,
          ])
        ).rows[0].p;
      const apply = async (
        id: string,
        token: string,
        operationId: string,
        unassigned: string[] = [],
        actor = partner,
        confirm = true,
      ) =>
        (
          await db.query('SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r', [
            actor,
            owner,
            {
              eventId: id,
              planVersion: 1,
              planToken: token,
              operationId,
              restoreUnassignedItemIds: unassigned,
              confirmed: confirm,
            },
            source,
          ])
        ).rows[0].r;
      const request = async (commands: unknown[], operationId: string) => ({
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
            'SELECT collection_id AS "collectionId",version::int,layout_revision::int AS "layoutRevision" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id',
            [owner],
          )
        ).rows,
        commands,
      });
      const send = async (commands: unknown[], operationId: string) => {
        await db.query('SELECT public.inventory_command_v1($1,$2,$3,$4)', [
          partner,
          owner,
          await request(commands, operationId),
          source,
        ]);
        await flush();
        return event();
      };
      const ref = async (id: string) => {
        const s = (
          await db.query(
            'SELECT s.*,p.inventory_item_id,p.version pv,i.version iv FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.id=$1',
            [id],
          )
        ).rows[0];
        return {
          collectionId: s.collection_id,
          slot: {
            id,
            version: Number(s.version),
            inventoryItemId: s.inventory_item_id ?? null,
            itemVersion: s.iv == null ? null : Number(s.iv),
            placementVersion: s.pv == null ? null : Number(s.pv),
          },
        };
      };
      const item = async (id: string) => {
        const i = (
          await db.query(
            'SELECT i.version,p.slot_id FROM public.inventory_items i LEFT JOIN public.inventory_placements p ON p.inventory_item_id=i.id WHERE i.id=$1',
            [id],
          )
        ).rows[0];
        return { itemId: id, itemVersion: Number(i.version), placement: i.slot_id ? await ref(i.slot_id) : null };
      };
      const assign = async (copy: string, slot: string, op: string) =>
        send(
          [
            {
              kind: 'assign',
              selection: { kind: 'existing', inventoryItemId: copy, itemVersion: (await item(copy)).itemVersion },
              destination: await ref(slot),
              occupied: 'cancel',
              fulfillWant: null,
            },
          ],
          op,
        );
      const first = await assign('synthetic/copy-a', 'synthetic/slot-0', 'synthetic-assign-0001');
      const n = await count();
      const plan = await preview(first.id);
      assert.equal(plan.supported, true);
      assert.deepEqual(plan.conflicts, []);
      assert.match(plan.planToken, /^[a-f0-9]{64}$/);
      assert.equal(await count(), n, 'preview cannot create an event or ledger entry');
      await rejected(
        () => apply(first.id, plan.planToken, 'synthetic-no-confirm', [], partner, false),
        /invalid_recovery_request/,
      );
      await rejected(
        () => apply(first.id, plan.planToken, 'synthetic-wrong-actor', [], owner),
        /recovery_plan_conflict/,
      );
      // An unrelated newer partner row survives recovery of the first copy.
      await assign('synthetic/copy-b', 'synthetic/slot-1', 'synthetic-assign-0002');
      await rejected(() => apply(first.id, plan.planToken, 'synthetic-stale-reviewed-plan'), /recovery_plan_conflict/);
      const fresh = await preview(first.id);
      assert.deepEqual(fresh.conflicts, []);
      await apply(first.id, fresh.planToken, 'synthetic-recover-0001');
      await flush();
      assert.equal((await item('synthetic/copy-a')).placement, null);
      assert.equal((await item('synthetic/copy-b')).placement?.slot.id, 'synthetic/slot-1');
      const recovered = await event();
      assert.equal(recovered.recovery_of_event_id, first.id);
      assert.equal(recovered.actor_user_id, partner);
      assert.equal(recovered.source, 'app');
      assert.equal(recovered.action, 'recovery.apply');
      const unchanged = await count();
      const replay = await apply(first.id, fresh.planToken, 'synthetic-recover-0001');
      await flush();
      assert.equal(await count(), unchanged);
      assert.equal(replay.recoveredEventId, first.id);
      await rejected(() => apply(first.id, 'a'.repeat(64), 'synthetic-recover-0001'), /idempotency_conflict/);
      await rejected(
        () => apply(first.id, fresh.planToken, 'synthetic-recover-0001', [], owner),
        /recovery_plan_conflict/,
      );
      await rejected(
        () => db.query("UPDATE public.collection_activity SET source='mcp' WHERE id=$1", [first.id]),
        /audit_immutable/,
      );
      assert.deepEqual(
        (await db.query('SELECT recovery_state FROM public.collection_activity WHERE id=$1', [first.id])).rows[0]
          .recovery_state,
        first.recovery_state,
      );
      // A newer move of the same copy blocks the old inverse, even if it is moved back later.
      const second = await assign('synthetic/copy-a', 'synthetic/slot-0', 'synthetic-assign-0003');
      await db.query('SAVEPOINT aba');
      const acquisition = (await db.query("SELECT acquired_at FROM public.inventory_items WHERE id='synthetic/copy-a'"))
        .rows[0].acquired_at;
      await db.query("UPDATE public.inventory_items SET acquired_at='2021-01-01' WHERE id='synthetic/copy-a'");
      await flush();
      await db.query("UPDATE public.inventory_items SET acquired_at=$1 WHERE id='synthetic/copy-a'", [acquisition]);
      await flush();
      assert.ok(
        (await preview(second.id)).conflicts.some((c: { reason: string }) => c.reason === 'later_entity_change'),
        'ABA conflicts even when the entire current item state is back to its original value',
      );
      await db.query('ROLLBACK TO SAVEPOINT aba');
      await send(
        [
          {
            kind: 'move',
            item: await item('synthetic/copy-a'),
            destination: await ref('synthetic/slot-2'),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ],
        'synthetic-move-0001',
      );
      const stale = await preview(second.id);
      assert.ok(stale.conflicts.some((c: { entity: string }) => c.entity.includes('synthetic/copy-a')));
      // Removal can restore the same copy to Unassigned, explicitly, without displacing a newer occupant.
      const removed = await send(
        [{ kind: 'removeOwned', item: await item('synthetic/copy-a') }],
        'synthetic-remove-0001',
      );
      await send(
        [
          {
            kind: 'move',
            item: await item('synthetic/copy-b'),
            destination: await ref('synthetic/slot-2'),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ],
        'synthetic-move-0002',
      );
      assert.ok((await preview(removed.id)).conflicts.length > 0);
      const unassigned = await preview(removed.id, ['synthetic/copy-a']);
      assert.equal(unassigned.supported, true);
      assert.deepEqual(unassigned.conflicts, []);
      await apply(removed.id, unassigned.planToken, 'synthetic-recover-0002', ['synthetic/copy-a']);
      await flush();
      assert.equal((await item('synthetic/copy-a')).placement, null);
      assert.equal((await item('synthetic/copy-b')).placement?.slot.id, 'synthetic/slot-2');
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows[0]
          .n,
        2,
      );
      // Current membership is checked before returning even a committed idempotent result.
      await db.query('SAVEPOINT membership');
      await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await rejected(
        () => apply(removed.id, unassigned.planToken, 'synthetic-recover-0002', ['synthetic/copy-a']),
        /recovery_access_denied/,
      );
      await db.query('ROLLBACK TO SAVEPOINT membership');
      // An explicit Unassigned copy restore also survives a subsequently deleted former collection.
      await db.query('SAVEPOINT former_collection');
      const former = '03960000-0000-4000-8000-000000000015';
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic former collection')", [
        former,
        owner,
      ]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [former, owner],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/former-slot',$1,$2,0)",
        [former, owner],
      );
      await flush();
      await assign('synthetic/copy-a', 'synthetic/former-slot', 'synthetic-former-assign');
      const formerRemoval = await send(
        [{ kind: 'removeOwned', item: await item('synthetic/copy-a') }],
        'synthetic-former-remove',
      );
      await db.query('DELETE FROM public.binders WHERE id=$1', [former]);
      await flush();
      assert.ok((await preview(formerRemoval.id)).conflicts.length > 0);
      const formerPlan = await preview(formerRemoval.id, ['synthetic/copy-a']);
      assert.deepEqual(formerPlan.conflicts, []);
      await apply(formerRemoval.id, formerPlan.planToken, 'synthetic-former-recovery', ['synthetic/copy-a']);
      await flush();
      assert.equal((await item('synthetic/copy-a')).placement, null);
      assert.equal((await db.query('SELECT count(*)::int n FROM public.binders WHERE id=$1', [former])).rows[0].n, 0);
      await db.query('ROLLBACK TO SAVEPOINT former_collection');
      // Grade/certificate metadata stays exact in storage and absent from the safe preview.
      await db.query('SAVEPOINT grade_case');
      const grade = {
        provider: { kind: 'known', id: 'psa' },
        grade: '10',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: 'synthetic-private-cert',
        holder: null,
        label: { variant: null, assetIds: [] as string[] },
      };
      await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-recovery-series')");
      await db.query(
        "INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-recovery-set','synthetic-recovery-series')",
      );
      await db.query(
        "INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic-recovery-card','synthetic-recovery-series','synthetic-recovery-set','1')",
      );
      await db.query(
        "UPDATE public.inventory_items SET identity=$1,grading=$2,acquired_at='2020-01-01' WHERE owner_user_id=$3",
        [{ kind: 'card', cardId: 'synthetic-recovery-card' }, grade, owner],
      );
      await flush();
      const edit = await send(
        [
          {
            kind: 'edit',
            item: await item('synthetic/copy-a'),
            grading: { ...grade, grade: '9', certificate: 'synthetic-new-private-cert' },
          },
        ],
        'synthetic-grade-0001',
      );
      const gradePlan = await preview(edit.id);
      assert.equal(gradePlan.supported, true);
      assert.deepEqual(gradePlan.conflicts, []);
      assert.ok(!JSON.stringify(gradePlan).includes('synthetic-private-cert'));
      assert.ok(!JSON.stringify(gradePlan).includes('synthetic-new-private-cert'));
      // Recorder failure aborts restored state, the idempotency ledger, and new history together.
      const gradeCount = await count();
      await db.query('SAVEPOINT recorder');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_recovery_recorder_failure'; END $$",
      );
      await rejected(
        () => apply(edit.id, gradePlan.planToken, 'synthetic-failed-recorder'),
        /synthetic_recovery_recorder_failure/,
      );
      assert.equal(
        (await db.query("SELECT grading->>'grade' g FROM public.inventory_items WHERE id='synthetic/copy-a'")).rows[0]
          .g,
        '9',
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key='synthetic-failed-recorder'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(await count(), gradeCount);
      await db.query('ROLLBACK TO SAVEPOINT recorder');
      await apply(edit.id, gradePlan.planToken, 'synthetic-grade-recovery');
      await flush();
      const restoredGrade = (
        await db.query("SELECT grading,acquired_at FROM public.inventory_items WHERE id='synthetic/copy-a'")
      ).rows[0];
      assert.deepEqual(restoredGrade.grading, grade);
      assert.equal(restoredGrade.acquired_at.toISOString(), '2020-01-01T00:00:00.000Z');
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM public.inventory_items WHERE identity->>'cardId'='synthetic-recovery-card'",
          )
        ).rows[0].n,
        2,
      );
      const newerEdit = await send(
        [{ kind: 'edit', item: await item('synthetic/copy-a'), grading: { ...grade, grade: '8' } }],
        'synthetic-grade-0002',
      );
      const beforeNewer = await preview(newerEdit.id);
      await send(
        [{ kind: 'edit', item: await item('synthetic/copy-a'), grading: { ...grade, grade: '7' } }],
        'synthetic-grade-0003',
      );
      await rejected(
        () => apply(newerEdit.id, beforeNewer.planToken, 'synthetic-stale-grade'),
        /recovery_plan_conflict/,
      );
      assert.ok((await preview(newerEdit.id)).conflicts.length > 0);
      // The label asset registry is not shipped yet. Refuse the entire inverse, do not strip metadata.
      await db.query("UPDATE public.inventory_items SET grading=$1 WHERE id='synthetic/copy-a'", [
        { ...grade, label: { variant: null, assetIds: ['synthetic-private-label'] } },
      ]);
      await flush();
      const assetEdit = await send(
        [{ kind: 'edit', item: await item('synthetic/copy-a'), grading: null }],
        'synthetic-grade-assets',
      );
      const assetPlan = await preview(assetEdit.id);
      assert.equal(assetPlan.supported, false);
      assert.ok(assetPlan.unsupported.includes('private_assets_unverifiable'));
      assert.ok(!JSON.stringify(assetPlan).includes('synthetic-private-label'));
      assert.ok(!JSON.stringify(assetPlan).includes('synthetic-private-cert'));
      await db.query('ROLLBACK TO SAVEPOINT grade_case');
      // A full bulk inverse fails atomically if current allowances cannot admit the restored copies.
      await db.query('SAVEPOINT allowance');
      const bulkRemove = await send(
        [
          { kind: 'removeOwned', item: await item('synthetic/copy-a') },
          { kind: 'removeOwned', item: await item('synthetic/copy-b') },
        ],
        'synthetic-bulk-remove',
      );
      await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=1');
      const bulkPlan = await preview(bulkRemove.id, [], owner);
      assert.equal(bulkPlan.supported, true);
      assert.deepEqual(bulkPlan.conflicts, []);
      const bulkCount = await count();
      await rejected(
        () => apply(bulkRemove.id, bulkPlan.planToken, 'synthetic-bulk-over-limit', [], owner),
        /card_limit_reached/,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows[0]
          .n,
        0,
      );
      assert.equal(await count(), bulkCount);
      await db.query('ROLLBACK TO SAVEPOINT allowance');
      // Actual 076 evidence can represent 1,025 slot removals and collection cascades. The 074/075
      // admission limit is deliberately not changed: these synthetic events model that future path.
      await db.query('SAVEPOINT full_dex');
      const dex = '03960000-0000-4000-8000-000000000012';
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic full Dex')", [
        dex,
        owner,
      ]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [dex, owner],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target) SELECT 'synthetic/dex-'||n,$1,$2,n-1,jsonb_build_object('kind','pokemon','pokemonId',n) FROM generate_series(1,1025) n",
        [dex, owner],
      );
      await flush();
      await db.query('SAVEPOINT missing_layout');
      await db.query("DELETE FROM public.binder_slots WHERE id='synthetic/dex-1'");
      await db.query(
        'UPDATE public.storage_collection_state SET layout_revision=layout_revision+1 WHERE collection_id=$1',
        [binder],
      );
      await flush();
      const missingLayout = await preview((await event()).id);
      assert.equal(missingLayout.supported, false);
      assert.ok(
        missingLayout.unsupported.includes('missing_layout_evidence'),
        "another collection's layout root cannot authorize structural restoration",
      );
      await db.query('ROLLBACK TO SAVEPOINT missing_layout');
      await db.query('DELETE FROM public.binder_slots WHERE collection_id=$1', [dex]);
      await db.query(
        'UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+1 WHERE collection_id=$1',
        [dex],
      );
      await flush();
      const dexRemove = await event();
      assert.equal(dexRemove.recovery_state.filter((d: { table: string }) => d.table === 'binder_slots').length, 1025);
      const dexPlan = await preview(dexRemove.id);
      assert.equal(dexPlan.supported, true);
      assert.deepEqual(dexPlan.conflicts, []);
      const explain = (
        await db.query(
          'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT collection_audit_private.recovery_preview_v1($1,$2,$3)',
          [partner, owner, dexRemove.id],
        )
      ).rows[0]['QUERY PLAN'][0];
      assert.equal(explain.Plan['Actual Rows'], 1);
      console.info(`Synthetic local 1,025-slot recovery preview, rolled back: ${explain['Execution Time']} ms`);
      await db.query('SAVEPOINT changed_layout');
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/new-anchor',$1,$2,0)",
        [dex, owner],
      );
      await db.query(
        'UPDATE public.storage_collection_state SET layout_revision=layout_revision+1,version=version+1 WHERE collection_id=$1',
        [dex],
      );
      await flush();
      assert.ok(
        (await preview(dexRemove.id)).conflicts.some(
          (c: { reason: string }) => c.reason === 'layout_or_authority_changed',
        ),
      );
      await db.query('ROLLBACK TO SAVEPOINT changed_layout');
      await apply(dexRemove.id, dexPlan.planToken, 'synthetic-full-dex-restore');
      await flush();
      const slots = (
        await db.query(
          'SELECT id,position::int,target FROM public.binder_slots WHERE collection_id=$1 ORDER BY position',
          [dex],
        )
      ).rows;
      assert.equal(slots.length, 1025);
      assert.ok(
        slots.every((s, i) => s.id === `synthetic/dex-${i + 1}` && s.position === i && s.target.pokemonId === i + 1),
      );
      // Restore a default deletion only while its recorded replacement is still unchanged.
      await db.query('UPDATE public.binders SET is_default=false WHERE id=$1', [binder]);
      await db.query('UPDATE public.binders SET is_default=true WHERE id=$1', [dex]);
      await flush();
      await db.query('DELETE FROM public.binders WHERE id=$1', [dex]);
      await db.query('UPDATE public.binders SET is_default=true WHERE id=$1', [binder]);
      await flush();
      const deleted = await event();
      const deletedPlan = await preview(deleted.id);
      assert.equal(deletedPlan.supported, true);
      assert.deepEqual(deletedPlan.conflicts, []);
      await db.query('SAVEPOINT renamed_replacement');
      await db.query("UPDATE public.binders SET name='Synthetic renamed replacement' WHERE id=$1", [binder]);
      await flush();
      assert.ok((await preview(deleted.id)).conflicts.length > 0);
      await db.query('ROLLBACK TO SAVEPOINT renamed_replacement');
      await apply(deleted.id, deletedPlan.planToken, 'synthetic-deleted-dex-restore');
      await flush();
      assert.equal(
        (await db.query('SELECT is_default FROM public.binders WHERE id=$1', [dex])).rows[0].is_default,
        true,
      );
      assert.equal(
        (await db.query('SELECT is_default FROM public.binders WHERE id=$1', [binder])).rows[0].is_default,
        false,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1', [dex])).rows[0].n,
        1025,
      );
      assert.equal(
        (await db.query('SELECT name FROM public.binders WHERE id=$1', [dex])).rows[0].name,
        'Synthetic full Dex',
      );
      await db.query('ROLLBACK TO SAVEPOINT full_dex');
      // Legacy/direct auxiliary events are explicit unsupported evidence, never guessed inverses.
      await db.query('SAVEPOINT legacy');
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name) VALUES('03960000-0000-4000-8000-000000000013',$1,'Synthetic legacy')",
        [owner],
      );
      await db.query(
        "INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,'03960000-0000-4000-8000-000000000013',1,'Synthetic legacy','wishlisted')",
        [owner],
      );
      await flush();
      const legacyEvent = await event();
      assert.equal((await preview(legacyEvent.id)).supported, false);
      await db.query('ROLLBACK TO SAVEPOINT legacy');
      // Recovery of ownership neither reenables revoked sharing nor copies old tokens/queues.
      await db.query('SAVEPOINT sharing');
      await db.query(
        "INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($1,$2,'synthetic-private-share-secret')",
        [owner, binder],
      );
      await flush();
      const removedWithShare = await send(
        [{ kind: 'removeOwned', item: await item('synthetic/copy-a') }],
        'synthetic-share-removal',
      );
      await db.query('UPDATE public.binder_shares SET is_enabled=false WHERE binder_id=$1', [binder]);
      await flush();
      const sharingEvent = await event();
      assert.equal((await preview(sharingEvent.id)).supported, false);
      const sharingPlan = await preview(removedWithShare.id);
      assert.deepEqual(sharingPlan.conflicts, []);
      assert.ok(!JSON.stringify(sharingPlan).includes('synthetic-private-share-secret'));
      await apply(removedWithShare.id, sharingPlan.planToken, 'synthetic-share-safe-recovery');
      await flush();
      assert.equal(
        (await db.query('SELECT is_enabled FROM public.binder_shares WHERE binder_id=$1', [binder])).rows[0].is_enabled,
        false,
      );
      await db.query('ROLLBACK TO SAVEPOINT sharing');
      // Version 0 and missing-inverse events stay unsupported, with no historical guessing.
      await db.query('SAVEPOINT old_format');
      const old = (
        await db.query(
          "INSERT INTO public.collection_activity(owner_user_id,before_state,after_state) VALUES($1,'{}','{}') RETURNING id",
          [owner],
        )
      ).rows[0].id;
      assert.deepEqual((await preview(old)).unsupported, ['missing_versioned_inverse']);
      await db.query('ROLLBACK TO SAVEPOINT old_format');
      // Content/target/wants undo uses stable slot identity and current layout dependencies.
      await db.query('SAVEPOINT slot_content');
      const root = (
        await db.query(
          'SELECT version::int,layout_revision::int FROM public.storage_collection_state WHERE collection_id=$1',
          [binder],
        )
      ).rows[0];
      const inv = (
        await db.query('SELECT inventory_revision::int n FROM public.inventory_owner_state WHERE owner_user_id=$1', [
          owner,
        ])
      ).rows[0].n;
      await db.query('SELECT public.slot_command_v1($1,$2,$3,$4)', [
        partner,
        owner,
        {
          operationId: 'synthetic-content-edit',
          collectionId: binder,
          inventoryRevision: inv,
          collectionVersion: root.version,
          layoutRevision: root.layout_revision,
          commands: [
            {
              kind: 'update',
              slot: (await ref('synthetic/slot-0')).slot,
              target: { kind: 'pokemon', pokemonId: 1 },
              wantedCards: [{ card_id: 'synthetic-want', card_name: 'Synthetic want', added_at: '2020-01-01' }],
            },
          ],
        },
        { source: 'rest', clientId: 'synthetic-key' },
      ]);
      await flush();
      const contentEvent = await event();
      const contentPlan = await preview(contentEvent.id);
      assert.equal(contentPlan.supported, true);
      assert.deepEqual(contentPlan.conflicts, []);
      await apply(contentEvent.id, contentPlan.planToken, 'synthetic-content-recovery');
      await flush();
      const content = (
        await db.query("SELECT target,wanted_cards FROM public.binder_slots WHERE id='synthetic/slot-0'")
      ).rows[0];
      assert.equal(content.target, null);
      assert.deepEqual(content.wanted_cards, []);
      await db.query('ROLLBACK TO SAVEPOINT slot_content');
      // Runtime callers cannot invoke the staged boundary with spoofed actor/source.
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        await db.query(`SET LOCAL ROLE ${role}`);
        await rejected(() => preview(first.id), /permission denied/);
        await rejected(() => apply(first.id, plan.planToken, 'synthetic-runtime-spoof'), /permission denied/);
        await db.query('RESET ROLE');
      }
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  'private recovery SQL: two concurrent committed replays produce one inverse and one linked event',
  { skip: !socket, timeout: 30000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const config = privateRecoveryDatabase(socket, {
      socket: '/Users/cal/.local/share/holofolder/issue396-local/socket',
      port: 55496,
      user: 'issue396_test',
    });
    const db = new Client(config),
      other = new Client(config);
    await db.connect();
    await other.connect();
    const account = '03960000-0000-4000-8000-000000000021';
    try {
      await db.query('BEGIN');
      await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01')", [account]);
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [account]);
      await db.query('COMMIT');
      const input = {
        operationId: 'synthetic-concurrent-add',
        inventoryRevision: 0,
        collections: [],
        commands: [
          {
            kind: 'add',
            itemId: 'synthetic/concurrent-copy',
            identity: { kind: 'pokemon', pokemonId: 1 },
            grading: null,
            acquiredAt: null,
          },
        ],
      };
      // Free allowance admits this single synthetic copy; do not alter hosted/global billing policy.
      await db.query('SELECT public.inventory_command_v1($1,$1,$2,$3)', [account, input, source]);
      const original = (
        await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          account,
        ])
      ).rows[0].id;
      const preview = (
        await db.query('SELECT collection_audit_private.recovery_preview_v1($1,$1,$2) p', [account, original])
      ).rows[0].p;
      assert.equal(preview.supported, true);
      assert.deepEqual(preview.conflicts, []);
      const request = {
        eventId: original,
        planVersion: 1,
        planToken: preview.planToken,
        operationId: 'synthetic-concurrent-recovery',
        restoreUnassignedItemIds: [],
        confirmed: true,
      };
      const run = (client: typeof db) =>
        client.query('SELECT collection_audit_private.recovery_apply_v1($1,$1,$2,$3) r', [account, request, source]);
      const results = await Promise.all([run(db), run(other)]);
      assert.deepEqual(results[0].rows[0].r, results[1].rows[0].r);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [account])).rows[0]
          .n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND recovery_of_event_id=$2',
            [account, original],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND operation='recovery_v1'",
            [account],
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await db.query('ROLLBACK');
      await db.query('DELETE FROM auth.users WHERE id=$1', [account]);
      await db.end();
      await other.end();
    }
  },
);

// Synthetic committed accounts are removed through the account privacy cascade.
test(
  'private recovery SQL: owner restoration holds wanted partner membership through commit',
  { skip: !socket, timeout: 30000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const config = privateRecoveryDatabase(socket, {
      socket: '/Users/cal/.local/share/holofolder/issue396-local/socket',
      port: 55496,
      user: 'issue396_test',
    });
    const db = new Client(config),
      unlink = new Client(config);
    await db.connect();
    await unlink.connect();
    const account = '03960000-0000-4000-8000-000000000031';
    const member = '03960000-0000-4000-8000-000000000032';
    const collection = '03960000-0000-4000-8000-000000000033';
    try {
      await db.query('BEGIN');
      await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [
        account,
        member,
      ]);
      await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [account]);
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        account,
        member,
      ]);
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic membership recovery',true)",
        [collection, account],
      );
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [account]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [collection, account],
      );
      const wants = [
        {
          card_id: 'synthetic-wanted-card',
          card_name: 'Synthetic wanted card',
          added_at: '2020-01-01',
          wanted_by: [member],
        },
      ];
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,wanted_cards) VALUES('synthetic/membership-slot',$1,$2,0,$3)",
        [collection, account, JSON.stringify(wants)],
      );
      await db.query('COMMIT');
      await db.query(
        "UPDATE public.binder_slots SET wanted_cards='[]',version=version+1 WHERE id='synthetic/membership-slot'",
      );
      const original = (
        await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          account,
        ])
      ).rows[0].id;
      const preview = async () =>
        (await db.query('SELECT collection_audit_private.recovery_preview_v1($1,$1,$2) p', [account, original])).rows[0]
          .p;
      const plan = await preview();
      assert.equal(plan.supported, true);
      assert.deepEqual(plan.conflicts, []);
      await db.query('BEGIN');
      const request = {
        eventId: original,
        planVersion: 1,
        planToken: plan.planToken,
        operationId: 'synthetic-membership-recovery',
        restoreUnassignedItemIds: [],
        confirmed: true,
      };
      await db.query('SELECT collection_audit_private.recovery_apply_v1($1,$1,$2,$3)', [account, request, source]);
      await unlink.query("SET lock_timeout='150ms'");
      await assert.rejects(unlink.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [account]), {
        code: '55P03',
      });
      assert.deepEqual(
        (await db.query("SELECT wanted_cards FROM public.binder_slots WHERE id='synthetic/membership-slot'")).rows[0]
          .wanted_cards,
        wants,
      );
      await db.query('ROLLBACK');
      await unlink.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [account]);
      assert.ok((await preview()).conflicts.some((c: { reason: string }) => c.reason === 'wanted_member_revoked'));
    } finally {
      await db.query('ROLLBACK');
      await db.query('DELETE FROM auth.users WHERE id IN($1,$2)', [account, member]);
      await db.end();
      await unlink.end();
    }
  },
);
