import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateRecoveryDatabase } from './private-recovery-db';
import { readFileSync } from 'node:fs';

const socket = process.env.CONVERTED_RECOVERY_TEST_SOCKET;
const config = socket
  ? privateRecoveryDatabase(socket, {
      socket: '/Users/cal/.local/share/holofolder/issue396-converted-local/socket',
      port: 55580,
      user: 'converted_recovery_test',
    })
  : undefined;
const owner = '03960800-0000-4000-8000-000000000001',
  partner = '03960800-0000-4000-8000-000000000002';
const stranger = '03960800-0000-4000-8000-000000000003';
const converted = '03960800-0000-4000-8000-000000000011',
  native = '03960800-0000-4000-8000-000000000012';
const copies = [
  '03960800-0000-4000-8000-000000000021',
  '03960800-0000-4000-8000-000000000022',
  '03960800-0000-4000-8000-000000000023',
];
const source = { source: 'app', clientId: null, batchId: null, clientOccurredAt: null };
const grade = {
  provider: { kind: 'known', id: 'psa' },
  grade: '10',
  scale: null,
  designation: null,
  subgrades: [],
  certificate: 'synthetic-private-cert',
  holder: null,
  label: { variant: null, assetIds: [] },
};
const slot = (n: number) => `legacy-dex-v1/${converted}/${n}`;

// Explicit opt-in private socket only; every fixture is synthetic and rolls back.
test(
  'converted recovery: actual 073 conversion, 074/075 commands and 076 immutable evidence',
  { skip: !socket, timeout: 120000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const db = new Client(config);
    await db.connect();
    try {
      if (!process.env.COLLECTION_CONVERTED_BASELINE) {
        const migration = readFileSync(
          new URL('../scripts/080_converted_content_recovery.sql', import.meta.url),
          'utf8',
        );
        await db.query(readFileSync(new URL('../scripts/077_safe_collection_recovery.sql', import.meta.url), 'utf8'));
        await assert.rejects(db.query(migration), /converted_recovery_requires_installed_079/);
        await db.query('ROLLBACK');
        await db.query(
          readFileSync(new URL('../scripts/079_bounded_collection_recovery.sql', import.meta.url), 'utf8'),
        );
        const definitions = async () =>
          (
            await db.query(
              "SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='collection_audit_private' AND p.proname NOT IN ('recovery_plan_v1','recovery_apply_v1') ORDER BY 1",
            )
          ).rows;
        const before = await definitions();
        await db.query(migration);
        await db.query(migration);
        assert.deepEqual(
          await definitions(),
          before,
          '080 must preserve the recorder, redactor, capture, immutable guard and preview',
        );
        const body = (
          await db.query(
            "SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) b",
          )
        ).rows[0].b;
        assert.equal(body.match(/plan:=collection_audit_private.recovery_plan_v1/g)?.length, 2);
        assert.equal(body.match(/reviewed:=collection_audit_private.recovery_preview_v1/g)?.length, 1);
        assert.ok(body.indexOf('FROM public.partnerships') < body.indexOf('4701'));
      }
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL TIME ZONE 'UTC'");
      const flush = () => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      const rejected = async (run: () => Promise<unknown>, error: RegExp) => {
        await db.query('SAVEPOINT rejected');
        await assert.rejects(run(), error);
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
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic converted',true),($2,$3,'Synthetic native',false)",
        [converted, native, owner],
      );
      // Two physical copies of the same printing plus one legacy species-only unknown printing.
      await db.query(
        `INSERT INTO public.pokemon_collection(id,binder_id,user_id,pokemon_id,pokemon_name,status,card_id,card_name,collected_at) VALUES
      ($1,$4,$5,1,'Synthetic one','collected','synthetic-converted-print','Synthetic card','2020-01-02'),
      ($2,$4,$5,2,'Synthetic two','finalized','synthetic-converted-print','Synthetic card','2021-01-02'),
      ($3,$4,$5,3,'Synthetic unknown','collected',NULL,NULL,NULL)`,
        [...copies, converted, owner],
      );
      const wants = [
        { card_id: 'synthetic-want', card_name: 'Synthetic want', added_at: '2020-01-01', wanted_by: [partner] },
      ];
      await db.query(
        "INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status,wanted_cards) VALUES($1,$2,4,'Synthetic want','wishlisted',$3)",
        [converted, owner, JSON.stringify(wants)],
      );
      await flush();
      await db.query(
        "SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')",
        [converted, owner],
      );
      await flush();
      const event = async () =>
        (
          await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
            owner,
          ])
        ).rows[0];
      const conversionEvent = await event();
      assert.equal(conversionEvent.action, 'legacy_conversion');
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [native, owner],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/native-a',$1,$2,0),('synthetic/native-b',$1,$2,1)",
        [native, owner],
      );
      await db.query(
        "UPDATE public.binders SET binder_rows=7,binder_cols=3,color='synthetic',sort_order=9 WHERE id=$1",
        [converted],
      );
      await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-converted-series')");
      await db.query(
        "INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-converted-set','synthetic-converted-series')",
      );
      await db.query(
        "INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic-converted-print','synthetic-converted-series','synthetic-converted-set','1')",
      );
      await db.query(
        "INSERT INTO public.tcg_card_dex_ids(card_id,dex_id) VALUES('synthetic-converted-print',1),('synthetic-converted-print',2)",
      );
      await flush();
      const preservation = async () =>
        (
          await db.query(
            `SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.pokemon_collection c WHERE binder_id=$1) originals,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY legacy_row_id) FROM public.binder_legacy_rows m WHERE collection_id=$1) frozen,
      (SELECT to_jsonb(s)-ARRAY['version','layout_revision'] FROM public.storage_collection_state s WHERE collection_id=$1) provenance,
      (SELECT to_jsonb(b) FROM public.binders b WHERE id=$1) metadata`,
            [converted],
          )
        ).rows[0];
      const preserved = await preservation();
      let sequence = 0;
      const op = () => `synthetic-converted-${++sequence}`;
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
      const send = async (commands: unknown[], actor = partner) => {
        const revision = Number(
          (
            await db.query('SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1', [
              owner,
            ])
          ).rows[0].inventory_revision,
        );
        const collections = (
          await db.query(
            'SELECT collection_id AS "collectionId",version::int,layout_revision::int AS "layoutRevision" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id',
            [owner],
          )
        ).rows;
        await db.query('SELECT public.inventory_command_v1($1,$2,$3,$4)', [
          actor,
          owner,
          { operationId: op(), inventoryRevision: revision, collections, commands },
          source,
        ]);
        await flush();
        return event();
      };
      const slots = async (commands: unknown[], actor = owner) => {
        const s = (
          await db.query(
            'SELECT s.*,o.inventory_revision FROM public.storage_collection_state s JOIN public.inventory_owner_state o USING(owner_user_id) WHERE collection_id=$1',
            [converted],
          )
        ).rows[0];
        await db.query('SELECT public.slot_command_v1($1,$2,$3,$4)', [
          actor,
          owner,
          {
            operationId: op(),
            collectionId: converted,
            inventoryRevision: Number(s.inventory_revision),
            collectionVersion: Number(s.version),
            layoutRevision: Number(s.layout_revision),
            commands,
          },
          { source: 'app', clientId: null },
        ]);
        await flush();
        return event();
      };
      const preview = async (id: string, choices: string[] = [], actor = partner) => {
        await db.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
        const p = (
          await db.query('SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,$4) p', [
            actor,
            owner,
            id,
            choices,
          ])
        ).rows[0].p;
        await db.query("SET LOCAL TIME ZONE 'UTC'");
        return p;
      };
      const apply = async (id: string, token: string, operationId = op(), choices: string[] = [], actor = partner) => {
        const r = (
          await db.query('SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r', [
            actor,
            owner,
            {
              eventId: id,
              planVersion: 1,
              planToken: token,
              operationId,
              restoreUnassignedItemIds: choices,
              confirmed: true,
            },
            source,
          ])
        ).rows[0].r;
        await flush();
        return r;
      };
      const state = async () =>
        (
          await db.query(
            `SELECT
      (SELECT jsonb_agg(to_jsonb(i)-ARRAY['version','created_at','updated_at'] ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$1) items,
      (SELECT jsonb_agg(to_jsonb(s)-ARRAY['version','created_at','updated_at'] ORDER BY id) FROM public.binder_slots s WHERE owner_user_id=$1) slots,
      (SELECT jsonb_agg(to_jsonb(p)-ARRAY['version','created_at','updated_at'] ORDER BY inventory_item_id) FROM public.inventory_placements p WHERE owner_user_id=$1) placements`,
            [owner],
          )
        ).rows[0];
      const roundtrip = async (run: () => Promise<{ id: string; recovery_state: unknown }>, actor = partner) => {
        await db.query('SAVEPOINT roundtrip');
        const before = await state(),
          e = await run(),
          p = await preview(e.id, [], actor);
        assert.equal(p.supported, true, JSON.stringify(p.unsupported));
        assert.deepEqual(p.conflicts, []);
        assert.ok(!JSON.stringify(p).includes('synthetic-private-cert'));
        await apply(e.id, p.planToken, op(), [], actor);
        assert.deepEqual(await state(), before);
        assert.deepEqual(await preservation(), preserved);
        assert.deepEqual(
          (await db.query('SELECT recovery_state FROM public.collection_activity WHERE id=$1', [e.id])).rows[0]
            .recovery_state,
          e.recovery_state,
        );
        assert.equal((await event()).recovery_of_event_id, e.id);
        await db.query('ROLLBACK TO SAVEPOINT roundtrip');
      };
      // Record real commands in both timezones, then preview/apply in the other one.
      // Timestamp JSON from history must compare by its typed instant without rewriting history.
      await db.query('SAVEPOINT timezone_roundtrips');
      await send(
        [
          {
            kind: 'add',
            itemId: 'synthetic/timezone-native',
            identity: { kind: 'card', cardId: 'synthetic-converted-print' },
            grading: null,
            acquiredAt: '2020-01-01T00:00:00Z',
          },
        ],
        owner,
      );
      for (const [writerZone, readerZone] of [
        ['Pacific/Auckland', 'UTC'],
        ['UTC', 'Pacific/Auckland'],
      ]) {
        for (const copy of [copies[0], 'synthetic/timezone-native']) {
          await db.query('SAVEPOINT timezone_edit');
          await db.query(`SET LOCAL TIME ZONE '${writerZone}'`);
          const before = await state();
          const e = await send([{ kind: 'edit', item: await item(copy), grading: grade }], owner);
          await db.query(`SET LOCAL TIME ZONE '${readerZone}'`);
          const p = (await db.query('SELECT collection_audit_private.recovery_preview_v1($1,$1,$2) p', [owner, e.id]))
            .rows[0].p;
          assert.equal(p.supported, true);
          assert.deepEqual(p.conflicts, [], `${copy}: ${writerZone} to ${readerZone}`);
          await apply(e.id, p.planToken, op(), [], owner);
          await db.query(`SET LOCAL TIME ZONE '${writerZone}'`);
          assert.deepEqual(await state(), before);
          assert.deepEqual(
            (await db.query('SELECT recovery_state FROM public.collection_activity WHERE id=$1', [e.id])).rows[0]
              .recovery_state,
            e.recovery_state,
          );
          await db.query('ROLLBACK TO SAVEPOINT timezone_edit');
        }
      }
      await db.query('ROLLBACK TO SAVEPOINT timezone_roundtrips');
      // This must fail against installed 079 before 080: same conversion receipt, ordinary clear.
      await roundtrip(async () => slots([{ kind: 'clear', slots: [(await ref(slot(3))).slot] }]), owner);
      await send([{ kind: 'edit', item: await item(copies[0]), grading: grade }]);
      await roundtrip(async () =>
        send([
          {
            kind: 'edit',
            item: await item(copies[0]),
            grading: { ...grade, grade: '9', certificate: 'synthetic-new-cert' },
          },
        ]),
      );
      await roundtrip(async () => send([{ kind: 'removeOwned', item: await item(copies[0]) }]));
      await roundtrip(async () => send([{ kind: 'unassign', item: await item(copies[2]) }]), owner);
      await roundtrip(async () =>
        slots([{ kind: 'update', slot: (await ref(slot(4))).slot, target: null, wantedCards: [] }], partner),
      );
      await roundtrip(async () =>
        slots([
          {
            kind: 'update',
            slot: (await ref(slot(5))).slot,
            target: { kind: 'pokemon', pokemonId: 6 },
            wantedCards: wants,
          },
        ]),
      );
      await roundtrip(async () => slots([{ kind: 'create', ids: ['synthetic/free'], beforeSlotId: slot(2) }]));
      await roundtrip(async () =>
        slots([{ kind: 'move', slots: [(await ref(slot(4))).slot], beforeSlotId: slot(1) }], partner),
      );
      await roundtrip(async () => slots([{ kind: 'remove', slots: [(await ref(slot(100))).slot] }]));
      await db.query('SAVEPOINT new_copy');
      await slots([{ kind: 'create', ids: ['synthetic/new-copy-slot'], beforeSlotId: null }]);
      await roundtrip(async () =>
        send([
          {
            kind: 'assign',
            selection: {
              kind: 'catalog',
              identity: { kind: 'card', cardId: 'synthetic-converted-print', language: 'en', finish: 'normal' },
              newItemId: 'synthetic/new-converted-copy',
            },
            destination: await ref('synthetic/new-copy-slot'),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ]),
      );
      await db.query('ROLLBACK TO SAVEPOINT new_copy');
      await roundtrip(async () =>
        send([
          {
            kind: 'move',
            item: await item(copies[0]),
            destination: await ref('synthetic/native-a'),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ]),
      );
      await db.query('SAVEPOINT native_to_converted');
      await send([
        {
          kind: 'move',
          item: await item(copies[0]),
          destination: await ref('synthetic/native-a'),
          occupied: 'cancel',
          fulfillWant: null,
        },
      ]);
      await roundtrip(async () =>
        send([
          {
            kind: 'move',
            item: await item(copies[0]),
            destination: await ref(slot(1)),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ]),
      );
      await db.query('ROLLBACK TO SAVEPOINT native_to_converted');
      await roundtrip(async () =>
        send([
          {
            kind: 'move',
            item: await item(copies[0]),
            destination: await ref(slot(2)),
            occupied: 'swap',
            fulfillWant: null,
          },
        ]),
      );
      await db.query('SAVEPOINT assign');
      await send([{ kind: 'unassign', item: await item(copies[2]) }]);
      await roundtrip(async () =>
        send([
          {
            kind: 'assign',
            selection: {
              kind: 'existing',
              inventoryItemId: copies[2],
              itemVersion: (await item(copies[2])).itemVersion,
            },
            destination: await ref(slot(3)),
            occupied: 'cancel',
            fulfillWant: null,
          },
        ]),
      );
      await db.query('ROLLBACK TO SAVEPOINT assign');
      // Baseline and transition/frozen-source gates reject whole events with no token.
      const unsupported = async (e: { id: string }, reason: string) => {
        const p = await preview(e.id);
        assert.equal(p.supported, false);
        assert.ok(p.unsupported.includes(reason), JSON.stringify(p.unsupported));
        assert.equal(p.planToken, null);
      };
      await unsupported(conversionEvent, 'authority_or_config_transition');
      await db.query('SAVEPOINT mapped_remove');
      const mapped = await slots([{ kind: 'remove', slots: [(await ref(slot(4))).slot] }]);
      await unsupported(mapped, 'unsupported_table:binder_legacy_rows');
      await db.query('ROLLBACK TO SAVEPOINT mapped_remove');
      await db.query('SAVEPOINT converted_delete');
      const deleteRefs = (
        await db.query('SELECT s.id FROM public.binder_slots s WHERE collection_id=$1 ORDER BY position', [converted])
      ).rows;
      const refs = [];
      for (const r of deleteRefs) refs.push((await ref(r.id)).slot);
      await unsupported(
        await send([
          { kind: 'deleteCollection', collectionId: converted, replacementDefaultCollectionId: native, slots: refs },
        ]),
        'authority_or_config_transition',
      );
      await db.query('ROLLBACK TO SAVEPOINT converted_delete');
      await rejected(
        () =>
          db.query("UPDATE public.storage_collection_state SET conversion_receipt='{}' WHERE collection_id=$1", [
            converted,
          ]),
        /Converted storage requires version-safe recovery/,
      );
      await rejected(
        () =>
          db.query(
            "UPDATE public.storage_collection_state SET authority='legacy',conversion_version=NULL,converted_at=NULL,conversion_receipt=NULL WHERE collection_id=$1",
            [converted],
          ),
        /Converted storage requires version-safe recovery/,
      );
      await db.query('SAVEPOINT frozen_dependency');
      const frozenEdit = await send([{ kind: 'edit', item: await item(copies[0]), grading: { ...grade, grade: '9' } }]);
      await db.query(
        'UPDATE public.binder_legacy_rows SET source_row=source_row||\'{"synthetic":true}\' WHERE legacy_row_id=$1',
        [copies[0]],
      );
      await flush();
      assert.ok(
        (await preview(frozenEdit.id)).conflicts.some(
          (c: { reason: string }) => c.reason === 'conversion_source_changed',
        ),
      );
      await db.query('ROLLBACK TO SAVEPOINT frozen_dependency');
      await db.query('SAVEPOINT provenance_aba');
      const abaEdit = await send([{ kind: 'edit', item: await item(copies[0]), grading: { ...grade, grade: '9' } }]);
      const manifest = preserved.provenance.preset_manifest;
      await db.query("UPDATE public.storage_collection_state SET preset_manifest='{}' WHERE collection_id=$1", [
        converted,
      ]);
      await flush();
      await db.query('UPDATE public.storage_collection_state SET preset_manifest=$2 WHERE collection_id=$1', [
        converted,
        manifest,
      ]);
      await flush();
      assert.ok(
        (await preview(abaEdit.id)).conflicts.some(
          (c: { reason: string }) => c.reason === 'later_conversion_dependency_change',
        ),
      );
      await db.query('ROLLBACK TO SAVEPOINT provenance_aba');
      await db.query('SAVEPOINT allowance');
      const removals = [];
      for (const id of copies) removals.push({ kind: 'removeOwned', item: await item(id) });
      const bulk = await send(removals);
      const bulkPlan = await preview(bulk.id, [], owner);
      await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=1');
      await rejected(() => apply(bulk.id, bulkPlan.planToken, op(), [], owner), /card_limit_reached/);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows[0]
          .n,
        0,
      );
      await db.query('ROLLBACK TO SAVEPOINT allowance');
      await db.query('SAVEPOINT fake_conversion');
      const fake = '03960800-0000-4000-8000-000000000014';
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic fake conversion')", [
        fake,
        owner,
      ]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority,conversion_version,converted_at,conversion_receipt) VALUES($1,$2,'slots',1,now(),'{}')",
        [fake, owner],
      );
      await db.query(
        "INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/fake-slot',$1,$2,0)",
        [fake, owner],
      );
      await flush();
      const fakeMove = await send([
        {
          kind: 'move',
          item: await item(copies[2]),
          destination: await ref('synthetic/fake-slot'),
          occupied: 'cancel',
          fulfillWant: null,
        },
      ]);
      const fakePlan = await preview(fakeMove.id);
      assert.ok(fakePlan.conflicts.some((c: { reason: string }) => c.reason === 'conversion_source_changed'));
      assert.equal(fakePlan.planToken, null);
      await db.query('ROLLBACK TO SAVEPOINT fake_conversion');
      // Stale dependency and ABA evidence cannot be laundered by recovering an ordinary edit.
      for (const change of [
        'UPDATE public.inventory_items SET grading=NULL,version=version+1 WHERE id=$1',
        'UPDATE public.inventory_placements SET version=version+1 WHERE inventory_item_id=$1',
        "UPDATE public.binder_slots SET version=version+1 WHERE id='" + slot(1) + "'",
        "UPDATE public.storage_collection_state SET layout_revision=layout_revision+1 WHERE collection_id='" +
          converted +
          "'",
        "UPDATE public.binders SET name='Synthetic newer name' WHERE id='" + converted + "'",
      ]) {
        await db.query('SAVEPOINT stale');
        const e = await send([{ kind: 'edit', item: await item(copies[0]), grading: { ...grade, grade: '9' } }]);
        const p = await preview(e.id);
        await db.query(change, change.includes('$1') ? [copies[0]] : []);
        await flush();
        await rejected(() => apply(e.id, p.planToken), /recovery_plan_conflict/);
        await db.query('ROLLBACK TO SAVEPOINT stale');
      }
      await db.query('SAVEPOINT newer_partner');
      const older = await send(
        [{ kind: 'edit', item: await item(copies[0]), grading: { ...grade, grade: '9' } }],
        owner,
      );
      const reviewed = await preview(older.id);
      await send([{ kind: 'edit', item: await item(copies[1]), grading: { ...grade, grade: '8' } }], partner);
      await rejected(() => apply(older.id, reviewed.planToken), /recovery_plan_conflict/);
      const fresh = await preview(older.id);
      assert.deepEqual(fresh.conflicts, []);
      await apply(older.id, fresh.planToken);
      assert.equal(
        (await db.query("SELECT grading->>'grade' g FROM public.inventory_items WHERE id=$1", [copies[1]])).rows[0].g,
        '8',
      );
      await db.query('ROLLBACK TO SAVEPOINT newer_partner');
      await db.query('SAVEPOINT removal_alternative');
      const beforeRemoval = (await state()).items;
      const removal = await send([{ kind: 'removeOwned', item: await item(copies[0]) }]);
      await slots([{ kind: 'update', slot: (await ref(slot(1))).slot, target: null }]);
      assert.ok((await preview(removal.id)).conflicts.length);
      const alternative = await preview(removal.id, [copies[0]]);
      assert.equal(alternative.supported, true);
      assert.deepEqual(alternative.conflicts, []);
      await apply(removal.id, alternative.planToken, op(), [copies[0]]);
      assert.equal((await item(copies[0])).placement, null);
      assert.deepEqual((await state()).items, beforeRemoval);
      await db.query('ROLLBACK TO SAVEPOINT removal_alternative');
      // Replay still checks current actor, recorder failure rolls back every effect and key.
      await db.query('SAVEPOINT replay');
      const e = await slots([{ kind: 'update', slot: (await ref(slot(4))).slot, wantedCards: [] }]);
      const p = await preview(e.id, [], owner),
        key = op(),
        before = await state();
      await db.query('SAVEPOINT recorder');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_recorder_failure'; END $$",
      );
      await rejected(() => apply(e.id, p.planToken, key, [], owner), /synthetic_recorder_failure/);
      assert.deepEqual(await state(), before);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1', [key])).rows[0]
          .n,
        0,
      );
      await db.query('ROLLBACK TO SAVEPOINT recorder');
      const result = await apply(e.id, p.planToken, key, [], owner);
      assert.deepEqual(await apply(e.id, p.planToken, key, [], owner), result);
      await rejected(
        () => db.query('SELECT collection_audit_private.recovery_preview_v1($1,$1,$2)', [stranger, e.id]),
        /recovery_event_unavailable/,
      );
      await rejected(() => preview(e.id, [], stranger), /recovery_access_denied/);
      await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await rejected(() => apply(e.id, p.planToken, op()), /recovery_access_denied/);
      assert.ok(
        (await preview(e.id, [], owner)).conflicts.some(
          (c: { reason: string }) => c.reason === 'wanted_member_revoked',
        ),
      );
      await db.query('ROLLBACK TO SAVEPOINT replay');
      await rejected(
        () => db.query("UPDATE public.pokemon_collection SET status='considering' WHERE id=$1", [copies[0]]),
        /binder_converted_requires_slot_commands/,
      );
      assert.deepEqual(await preservation(), preserved);
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  'converted recovery: owner locks partner wants before owner root and blocks concurrent unlink',
  { skip: !socket, timeout: 30000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const db = new Client(config),
      unlink = new Client(config);
    await db.connect();
    await unlink.connect();
    const account = '03960800-0000-4000-8000-000000000031',
      member = '03960800-0000-4000-8000-000000000032';
    const collection = '03960800-0000-4000-8000-000000000033';
    const id = `legacy-dex-v1/${collection}/4`;
    const wants = [
      { card_id: 'synthetic-race-want', card_name: 'Synthetic want', added_at: '2020-01-01', wanted_by: [member] },
    ];
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
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic converted race',true)",
        [collection, account],
      );
      await db.query(
        "INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status,wanted_cards) VALUES($1,$2,4,'Synthetic want','wishlisted',$3)",
        [collection, account, JSON.stringify(wants)],
      );
      await db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      await db.query(
        "SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')",
        [collection, account],
      );
      await db.query('COMMIT');
      const s = (
        await db.query(
          'SELECT s.*,o.inventory_revision FROM public.storage_collection_state s JOIN public.inventory_owner_state o USING(owner_user_id) WHERE collection_id=$1',
          [collection],
        )
      ).rows[0];
      await db.query('SELECT public.slot_command_v1($1,$1,$2,$3)', [
        account,
        {
          collectionId: collection,
          operationId: 'synthetic-converted-race-edit',
          inventoryRevision: Number(s.inventory_revision),
          collectionVersion: Number(s.version),
          layoutRevision: Number(s.layout_revision),
          commands: [
            {
              kind: 'update',
              slot: { id, version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null },
              wantedCards: [],
            },
          ],
        },
        { source: 'app', clientId: null },
      ]);
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
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'");
      const request = {
        eventId: original,
        planVersion: 1,
        planToken: plan.planToken,
        operationId: 'synthetic-converted-race-recovery',
        restoreUnassignedItemIds: [],
        confirmed: true,
      };
      await db.query('SELECT collection_audit_private.recovery_apply_v1($1,$1,$2,$3)', [account, request, source]);
      await unlink.query("SET lock_timeout='150ms'");
      await assert.rejects(unlink.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [account]), {
        code: '55P03',
      });
      assert.deepEqual(
        (await db.query('SELECT wanted_cards FROM public.binder_slots WHERE id=$1', [id])).rows[0].wanted_cards,
        wants,
      );
      await db.query('ROLLBACK');
      await unlink.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [account]);
      assert.ok((await preview()).conflicts.some((c: { reason: string }) => c.reason === 'wanted_member_revoked'));
    } finally {
      await db.query('ROLLBACK');
      await db.query('DELETE FROM auth.users WHERE id IN($1,$2)', [account, member]);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1', [account]))
          .rows[0].n,
        0,
      );
      await db.end();
      await unlink.end();
    }
  },
);
