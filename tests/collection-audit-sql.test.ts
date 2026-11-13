import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateRecoveryDatabase } from './private-recovery-db';
import { readFileSync } from 'node:fs';

const socket = process.env.COLLECTION_AUDIT_TEST_SOCKET;
const owner = '03940000-0000-4000-8000-000000000001';
const partner = '03940000-0000-4000-8000-000000000002';
const stranger = '03940000-0000-4000-8000-000000000003';
const binder = '03940000-0000-4000-8000-000000000011';

test(
  'private SQL audit: atomicity, provenance, immutability, bulk, retention, pagination and legacy preservation',
  { skip: !socket, timeout: 60000 },
  async () => {
    if (!socket) return;
    const { Client } = await import('pg');
    const db = new Client(
      privateRecoveryDatabase(socket, {
        socket: '/Users/cal/.local/share/holofolder/issue394-local/socket',
        port: 55494,
        user: 'issue394_test',
      }),
    );
    await db.connect();
    try {
      const original = () =>
        db.query(
          `SELECT id,owner_user_id,pokemon_id,pokemon_name,recorded_at,before_state,after_state FROM public.collection_activity ORDER BY id`,
        );
      const before = (await original()).rows;
      const migration = readFileSync(
        new URL('../scripts/076_transactional_collection_audit.sql', import.meta.url),
        'utf8',
      );
      for (let run = 0; run < 2; run++)
        for (const statement of migration.split('-- Apply separately:'))
          await db.query(statement.replace(/^ outside[^\n]*\n/, ''));
      if (socket.includes('issue396-converted-local') || socket.includes('issue396-cascade-local')) {
        for (const file of [
          '077_safe_collection_recovery.sql',
          '079_bounded_collection_recovery.sql',
          '080_converted_content_recovery.sql',
        ]) {
          await db.query(readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8'));
        }
      }
      assert.deepEqual((await original()).rows, before, 'ADD COLUMN must preserve the original event columns exactly');
      if (socket.includes('issue396-cascade-local')) {
        await db.query(readFileSync(new URL('../scripts/081_converted_cascade_recovery.sql', import.meta.url), 'utf8'));
      }
      await db.query("BEGIN; SET LOCAL statement_timeout='30s'");
      const rejected = async (sql: string, values: unknown[] = [], pattern = /permission denied|audit_immutable/) => {
        await db.query('SAVEPOINT rejected');
        await assert.rejects(db.query(sql, values), pattern);
        await db.query('ROLLBACK TO SAVEPOINT rejected');
      };
      await db.query(
        "INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')",
        [owner, partner, stranger],
      );
      await db.query('UPDATE public.billing_configuration SET enforced=false');
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic audit',true)",
        [binder, owner],
      );
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      const flush = () => db.query('SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      await flush();
      const count = async () =>
        Number(
          (await db.query('SELECT count(*) n FROM public.collection_activity WHERE owner_user_id=$1', [owner])).rows[0]
            .n,
        );
      const baseline = await count();
      // Unknown service writes never inherit the owner's identity or caller's spoofed JWT.
      await db.query("SELECT set_config('role','service_role',true)");
      await db.query(
        "INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) SELECT $1,$2,n,'Synthetic','collected' FROM generate_series(1,1025) n",
        [owner, binder],
      );
      await flush();
      await db.query('RESET ROLE');
      assert.equal(await count(), baseline + 1, 'one logical bulk event for 1025 changes');
      let event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.actor_kind, 'unknown');
      assert.equal(event.actor_user_id, null);
      assert.equal(event.changes.length, 1025);
      console.info('Synthetic bulk audit bytes', {
        entities: 1025,
        recovery: Buffer.byteLength(JSON.stringify(event.recovery_state)),
        safeRead: Buffer.byteLength(JSON.stringify(event.changes)),
      });
      assert.ok(JSON.stringify(event.recovery_state).length < 1024 * 1024);
      // Real authenticated partner, spoofed server header and arbitrary GUC ignored.
      await db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true),set_config('holo.audit_actor',$4,true)",
        [
          partner,
          JSON.stringify({ sub: partner, role: 'authenticated' }),
          JSON.stringify({
            'x-holo-audit-context': JSON.stringify({
              actor: { kind: 'user', userId: owner },
              source: 'migration',
              operationId: 'spoofed',
            }),
          }),
          owner,
        ],
      );
      await db.query('SET LOCAL ROLE authenticated');
      await db.query(
        "UPDATE public.pokemon_collection SET status='finalized' WHERE user_id=$1 AND binder_id=$2 AND pokemon_id=1",
        [owner, binder],
      );
      await flush();
      await db.query('RESET ROLE');
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.actor_user_id, partner);
      assert.equal(event.source, 'direct');
      assert.notEqual(event.operation_id, 'spoofed');
      // A server-established REST principal is distinct from owner, credential retained as identifier only.
      await db.query("SELECT set_config('request.headers',$1,true)", [
        JSON.stringify({
          'x-holo-audit-context': JSON.stringify({
            actor: { kind: 'user', userId: partner },
            source: 'rest',
            clientId: 'synthetic-key-id',
            operationId: 'synthetic-api-request',
            batchId: null,
            clientOccurredAt: '2020-01-01T00:00:00Z',
          }),
        }),
      ]);
      await db.query('SET LOCAL ROLE service_role');
      await db.query("UPDATE public.binders SET name='Synthetic renamed' WHERE id=$1", [binder]);
      await flush();
      await db.query('RESET ROLE');
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.actor_user_id, partner);
      assert.equal(event.source, 'rest');
      assert.equal(event.client_id, 'synthetic-key-id');
      const unchanged = await count();
      await db.query('UPDATE public.binders SET name=name WHERE id=$1', [binder]);
      await flush();
      assert.equal(await count(), unchanged, 'timestamp-only update is a no-op');
      await rejected("UPDATE public.collection_activity SET source='app' WHERE id=$1", [event.id]);
      await rejected('DELETE FROM public.collection_activity WHERE id=$1', [event.id]);
      // A failing recorder aborts the mutation, including all trigger/notification effects.
      await db.query('SAVEPOINT failing_recorder');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_recorder_failure'; END $$",
      );
      await db.query("UPDATE public.binders SET name='Must roll back' WHERE id=$1", [binder]);
      await assert.rejects(flush(), /synthetic_recorder_failure/);
      await db.query('ROLLBACK TO SAVEPOINT failing_recorder');
      assert.equal(
        (await db.query('SELECT name FROM public.binders WHERE id=$1', [binder])).rows[0].name,
        'Synthetic renamed',
      );
      // Existing acquisition/outbox semantics remain exactly once, and recorder failure rolls them back too.
      const partnership = (await db.query('SELECT id FROM public.partnerships WHERE owner_user_id=$1', [owner])).rows[0]
        .id;
      let expected = (
        await db.query('SELECT to_jsonb(c) item FROM public.pokemon_collection c WHERE binder_id=$1 AND pokemon_id=2', [
          binder,
        ])
      ).rows[0].item;
      const row = {
        ...expected,
        card_id: 'synthetic-acquired-card',
        card_name: 'Synthetic acquired card',
        card_language: 'en',
        card_finish: 'normal',
        status: 'collected',
      };
      const acquisition = {
        operationId: '03940000-0000-4000-8000-000000000020',
        actorId: partner,
        partnershipId: partnership,
        recipientId: owner,
        printingKey: 'synthetic-acquired-card:en:normal',
      };
      const save = () =>
        db.query("SELECT public.save_collection_with_acquisition($1,$2,$3,2,$4,$5,$6,'Synthetic partner') result", [
          owner,
          binder,
          partner,
          row,
          expected,
          acquisition,
        ]);
      await db.query("SELECT set_config('request.headers','{}',true)");
      await db.query('SAVEPOINT failed_acquisition');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_acquisition_recorder_failure'; END $$",
      );
      await save();
      await assert.rejects(flush(), /synthetic_acquisition_recorder_failure/);
      await db.query('ROLLBACK TO SAVEPOINT failed_acquisition');
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.partner_acquisitions WHERE operation_id=$1', [
            acquisition.operationId,
          ])
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await db.query('SELECT card_id FROM public.pokemon_collection WHERE binder_id=$1 AND pokemon_id=2', [binder]))
          .rows[0].card_id,
        null,
      );
      const firstSave = (await save()).rows[0].result;
      await flush();
      assert.ok(firstSave.event_id);
      expected = firstSave.item;
      const acquisitionAudit = await count();
      await save();
      await flush();
      assert.equal(await count(), acquisitionAudit);
      assert.equal(
        (
          await db.query('SELECT count(*)::int n FROM public.partner_acquisitions WHERE operation_id=$1', [
            acquisition.operationId,
          ])
        ).rows[0].n,
        1,
      );
      // A staged bulk command records its first before state and FINAL root revisions, once on replay.
      await db.query("SELECT set_config('request.headers','{}',true)");
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [binder, owner],
      );
      await flush();
      const inventoryRequest = {
        operationId: 'synthetic-audit-bulk',
        inventoryRevision: 0,
        collections: [],
        commands: [
          {
            kind: 'add',
            itemId: 'synthetic/copy-one',
            identity: { kind: 'pokemon', pokemonId: 1 },
            grading: null,
            acquiredAt: null,
          },
          {
            kind: 'add',
            itemId: 'synthetic/copy-two',
            identity: { kind: 'pokemon', pokemonId: 1 },
            grading: null,
            acquiredAt: null,
          },
        ],
      };
      const intent = {
        source: 'mcp',
        clientId: 'synthetic-grant',
        batchId: 'synthetic-batch',
        clientOccurredAt: '2020-01-01T00:00:00Z',
      };
      const execute = () =>
        db.query('SELECT public.inventory_command_v1($1,$2,$3,$4) result', [partner, owner, inventoryRequest, intent]);
      const result = (await execute()).rows[0].result;
      await flush();
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.action, 'inventory.bulk');
      assert.equal(event.actor_user_id, partner);
      assert.equal(event.source, 'mcp');
      assert.equal(event.operation_id, inventoryRequest.operationId);
      assert.ok(event.affected_entities.inventoryItemIds.includes('synthetic/copy-one'));
      const committed = await count();
      assert.deepEqual((await execute()).rows[0].result, result);
      await flush();
      assert.equal(await count(), committed);
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role']) {
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'public.inventory_command_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'public.slot_command_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      }
      // Slot-only layout commands retain true before/final root versions, not acquisition events.
      const slotRequest = {
        operationId: 'synthetic-slot-audit',
        collectionId: binder,
        inventoryRevision: 1,
        collectionVersion: 0,
        layoutRevision: 0,
        commands: [{ kind: 'create', ids: ['synthetic/slot-one', 'synthetic/slot-two'], beforeSlotId: null }],
      };
      await db.query('SELECT public.slot_command_v1($1,$2,$3,$4)', [
        partner,
        owner,
        slotRequest,
        { source: 'rest', clientId: 'synthetic-key' },
      ]);
      await flush();
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.action, 'slots.create');
      assert.equal(event.pokemon_id, null);
      const root = event.recovery_state.find((d: { table: string }) => d.table === 'storage_collection_state');
      assert.equal(root.before.version, 0);
      assert.equal(root.after.version, 1);
      assert.equal(root.after.layout_revision, 1);
      assert.ok(event.affected_entities.slotIds.includes('synthetic/slot-one'));
      // Reusing trusted operation attribution for a new mutation aborts, rather than hiding the new event.
      await db.query('SAVEPOINT duplicate_operation');
      await db.query("SELECT set_config('request.headers',$1,true)", [
        JSON.stringify({
          'x-holo-audit-context': JSON.stringify({
            actor: { kind: 'user', userId: partner },
            source: 'rest',
            operationId: inventoryRequest.operationId,
          }),
        }),
      ]);
      await db.query('SET LOCAL ROLE service_role');
      await db.query("UPDATE public.binders SET name='Duplicate must abort' WHERE id=$1", [binder]);
      await assert.rejects(flush(), /collection_activity_operation_once/);
      await db.query('ROLLBACK TO SAVEPOINT duplicate_operation');
      await db.query('SET LOCAL ROLE service_role');
      await rejected('TRUNCATE public.pokemon_collection', [], /audit_requires_row_deletion/);
      await db.query('RESET ROLE');
      // Private certificates and label images survive removal only in server recovery evidence.
      const grade = {
        provider: { kind: 'known', id: 'psa' },
        grade: '10',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: 'synthetic-private-cert',
        holder: null,
        label: { variant: null, assetIds: ['synthetic-private-label'] },
      };
      await db.query("UPDATE public.inventory_items SET identity=$1,grading=$2 WHERE id='synthetic/copy-one'", [
        { kind: 'card', cardId: 'synthetic-card' },
        grade,
      ]);
      await flush();
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.ok(JSON.stringify(event.recovery_state).includes('synthetic-private-cert'));
      assert.ok(!JSON.stringify(event.changes).includes('synthetic-private-cert'));
      assert.ok(!JSON.stringify(event.changes).includes('synthetic-private-label'));
      // A rolled-back preview cannot fabricate an event.
      const previewCount = await count();
      await db.query('SAVEPOINT preview');
      await db.query("UPDATE public.binders SET name='preview' WHERE id=$1", [binder]);
      await db.query('ROLLBACK TO SAVEPOINT preview');
      await flush();
      assert.equal(await count(), previewCount);
      // Service jobs must opt in explicitly; raw service writes above remain Unknown.
      await db.query("SELECT set_config('request.headers',$1,true)", [
        JSON.stringify({
          'x-holo-audit-context': JSON.stringify({
            actor: { kind: 'system', job: 'synthetic-job' },
            source: 'system',
            operationId: 'synthetic-system-job',
          }),
        }),
      ]);
      await db.query('SET LOCAL ROLE service_role');
      await db.query("UPDATE public.binders SET color='red' WHERE id=$1", [binder]);
      await flush();
      await db.query('RESET ROLE');
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.actor_kind, 'system');
      assert.equal(event.actor_job, 'synthetic-job');
      assert.equal(event.actor_user_id, null);
      await db.query("SELECT set_config('request.headers','{}',true)");
      // Legacy conversion still runs through its existing allowed primitive and retains one receipt event.
      const conversionBinder = '03940000-0000-4000-8000-000000000012';
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic conversion')", [
        conversionBinder,
        owner,
      ]);
      await db.query(
        "INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic converted','collected')",
        [owner, conversionBinder],
      );
      await flush();
      const digest = (await db.query('SELECT public.legacy_binder_evidence_v1($1) e', [conversionBinder])).rows[0].e
        .rowsDigest;
      const conversionBaseline = await count();
      await db.query('SET LOCAL ROLE service_role');
      const convert = () =>
        db.query('SELECT public.convert_legacy_binder_v1($1,$2,$3) receipt', [conversionBinder, owner, digest]);
      const receipt = (await convert()).rows[0].receipt;
      await flush();
      await db.query('RESET ROLE');
      assert.equal(await count(), conversionBaseline + 1);
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.equal(event.action, 'legacy_conversion');
      assert.equal(event.actor_kind, 'unknown');
      await db.query('SET LOCAL ROLE service_role');
      await convert();
      await flush();
      await db.query('RESET ROLE');
      assert.equal(await count(), conversionBaseline + 1);
      // History survives FK cascades, with safe pre-deletion collection and rows retained.
      await db.query("SELECT set_config('request.headers','{}',true)");
      await db.query('DELETE FROM public.binders WHERE id=$1', [binder]);
      await flush();
      event = (
        await db.query('SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1', [
          owner,
        ])
      ).rows[0];
      assert.ok(
        event.recovery_state.some(
          (d: { table: string; before: unknown; after: unknown }) =>
            d.table === 'binders' && d.before && d.after === null,
        ),
      );
      assert.equal(
        event.recovery_state.filter((d: { table: string }) => d.table === 'pokemon_collection').length,
        1025,
      );
      // Current partner can read safe columns but not private recovery material. Unlink revokes read.
      await db.query(
        'GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON public.partnerships TO authenticated',
      );
      await db.query('SET LOCAL ROLE authenticated');
      assert.ok(
        (await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1', [owner])).rows.length > 0,
      );
      await rejected(
        'SELECT recovery_state FROM public.collection_activity WHERE owner_user_id=$1',
        [owner],
        /permission denied/,
      );
      await db.query('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [
        stranger,
        JSON.stringify({ sub: stranger, role: 'authenticated' }),
      ]);
      await db.query('SET LOCAL ROLE authenticated');
      assert.equal(
        (await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1', [owner])).rows.length,
        0,
      );
      await db.query('RESET ROLE; SET LOCAL ROLE anon');
      await rejected('SELECT id FROM public.collection_activity', [], /permission denied/);
      await db.query('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [
        partner,
        JSON.stringify({ sub: partner, role: 'authenticated' }),
      ]);
      await db.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await db.query('SET LOCAL ROLE authenticated');
      assert.equal(
        (await db.query('SELECT id FROM public.collection_activity WHERE owner_user_id=$1', [owner])).rows.length,
        0,
      );
      await db.query('RESET ROLE');
      await db.query('DELETE FROM auth.users WHERE id=$1', [owner]);
      await flush();
      assert.equal(await count(), 0, 'explicit account deletion removes its own audit evidence');
      assert.equal((await db.query('SELECT count(*)::int n FROM collection_audit_private.pending')).rows[0].n, 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM collection_audit_private.deltas')).rows[0].n, 0);
      await db.query('ROLLBACK');
      assert.deepEqual((await original()).rows, before);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);
