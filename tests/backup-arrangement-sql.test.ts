import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { normalizeStorageResult } from '@/lib/server/operations/storage-contract';

const socket = process.env.BACKUP_IMPORT_TEST_SOCKET;
const config = {
  host: '/Users/cal/.local/share/holofolder/issue365-atomic-import-local/socket',
  port: Number(process.env.BACKUP_IMPORT_TEST_PORT),
  user: 'import_test',
  database: 'postgres',
};
const owner = '00880000-0000-4000-8000-000000000001',
  partner = '00880000-0000-4000-8000-000000000002';
const dest = '00880000-0000-4000-8000-000000000011',
  source = '00880000-0000-4000-8000-000000000012';

test(
  'atomic arrangement SQL: preserved archive/ACLs, twice application, full Dex, repeats/wants/spacers, moves, exact retries, recovery and rollback',
  { skip: !socket, timeout: 120000 },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    assert.ok(config.port > 1024 && config.port <= 65535);
    const db = new Client(config);
    await db.connect();
    const protection = async () =>
      (
        await db.query(`SELECT n.nspname,p.oid::regprocedure::text name,p.proacl::text,p.proowner,CASE WHEN p.proname<>'storage_execute_v1' THEN md5(pg_get_functiondef(p.oid)) END digest
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','collection_audit_private') AND p.proname<>'import_arrangement_v1' ORDER BY 1,2`)
      ).rows;
    const access = async () =>
      (
        await db.query(
          `SELECT n.nspname,c.relname,c.relacl::text,c.relowner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','collection_audit_private') ORDER BY 1,2`,
        )
      ).rows;
    const policies = async () =>
      (await db.query('SELECT * FROM pg_policies ORDER BY schemaname,tablename,policyname')).rows;
    const archive = '/Users/cal/.local/share/holofolder/backups/2026-11-09T22-55-55Z-before-086/';
    const counts = JSON.parse(readFileSync(archive + 'source-counts.json', 'utf8'));
    const digests = JSON.parse(readFileSync(archive + 'source-critical-digests.json', 'utf8'));
    const preserved = async () => {
      await db.query("SET TIME ZONE 'UTC'");
      for (const [name, expected] of Object.entries(counts)) {
        assert.match(name, /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);
        const r = (
          await db.query(
            `SELECT count(*)::int n${name in digests ? ",md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) digest" : ''} FROM ${name} t`,
          )
        ).rows[0];
        assert.equal(r.n, expected, name + ' count');
        if (name in digests) assert.equal(r.digest, digests[name], name + ' digest');
      }
    };
    try {
      const before = await protection(),
        beforeAccess = await access(),
        beforePolicies = await policies();
      await preserved();
      const migration = readFileSync(new URL('../scripts/088_atomic_arrangement_import.sql', import.meta.url), 'utf8');
      await db.query(migration);
      await db.query(migration);
      assert.deepEqual(await protection(), before);
      assert.deepEqual(await access(), beforeAccess);
      assert.deepEqual(await policies(), beforePolicies);
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role'])
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'collection_audit_private.import_arrangement_v1(uuid,uuid,jsonb,jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      await db.query("BEGIN; SET LOCAL TIME ZONE 'UTC'");
      const flush = () => db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
      const reject = async (run: () => Promise<unknown>, code: string) => {
        await db.query('SAVEPOINT rejected');
        await assert.rejects(run(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === code);
        await db.query('ROLLBACK TO SAVEPOINT rejected');
      };
      await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01');", [
        owner,
        partner,
      ]);
      await db.query('UPDATE public.billing_configuration SET enforced=false');
      await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      await db.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await db.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic destination',true),($2,$3,'Synthetic source',false)",
        [dest, source, owner],
      );
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$3,'slots'),($2,$3,'slots')",
        [dest, source, owner],
      );
      await db.query(
        "INSERT INTO public.tcg_series(id,name_json) VALUES('synthetic-import-series','{}'); INSERT INTO public.tcg_sets(id,series_id,name_json) VALUES('synthetic-import-set','synthetic-import-series','{}')",
      );
      await db.query(
        `INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json,variants_json) VALUES('synthetic-import-trainer','synthetic-import-series','synthetic-import-set','1','{"en":"Synthetic Trainer"}','{"normal":true}'),('synthetic-import-energy','synthetic-import-series','synthetic-import-set','2','{"en":"Synthetic Energy"}','{"normal":true}')`,
      );
      await flush();
      const header = async (op: string, actor = partner, transport = 'app') => {
        await db.query('RESET ROLE');
        await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [
          JSON.stringify({
            'x-holo-audit-context': JSON.stringify({
              actor: { kind: 'user', userId: actor },
              source: transport,
              clientId: null,
              operationId: op,
              batchId: op,
              clientOccurredAt: null,
            }),
          }),
          JSON.stringify({ role: 'service_role' }),
        ]);
        await db.query('SET LOCAL ROLE service_role');
      };
      const call = async (operation: string, value: unknown) =>
        (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, owner, value])).rows[0].r;
      const evidence = async () => {
        await db.query('RESET ROLE');
        return (
          await db.query(
            `SELECT jsonb_build_object('items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$1),
        'slots',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.binder_slots s WHERE owner_user_id=$1),
        'placements',(SELECT jsonb_agg(to_jsonb(p) ORDER BY inventory_item_id) FROM public.inventory_placements p WHERE owner_user_id=$1),
        'roots',(SELECT jsonb_agg(to_jsonb(c) ORDER BY collection_id) FROM public.storage_collection_state c WHERE owner_user_id=$1),
        'owner',(SELECT to_jsonb(r) FROM public.inventory_owner_state r WHERE owner_user_id=$1),
        'events',(SELECT count(*) FROM public.collection_activity WHERE owner_user_id=$1),
        'ledger',(SELECT count(*) FROM public.developer_idempotency WHERE actor_id IN ($1,$2))) e`,
            [owner, partner],
          )
        ).rows[0].e;
      };
      const token = (collectionId: string, version = 0, layoutRevision = 0) => ({
        collectionId,
        version,
        layoutRevision,
      });
      const slot = (id: string, target: object | null = null, inventoryItemId: string | null = null) => ({
        id,
        target,
        inventoryItemId,
        status: inventoryItemId ? 'collected' : null,
        wantedCards: [] as object[],
        presetOrigin: null,
      });
      const item = (id: string, cardId = 'synthetic-import-trainer') => ({
        id,
        identity: { kind: 'card', cardId },
        grading: null as object | null,
        acquiredAt: '2020-01-02T03:04:05Z',
        version: 0,
      });
      const manifest = {
        source: { id: 'synthetic-dex', version: '1' },
        name: 'Synthetic Dex',
        entries: Array.from({ length: 1025 }, (_, n) => ({
          id: `entry-${n}`,
          target: { kind: 'pokemon', pokemonId: n + 1 },
        })),
      };
      await db.query('UPDATE public.storage_collection_state SET preset_manifest=$1 WHERE collection_id=$2', [
        manifest,
        dest,
      ]);
      await flush();
      const command = {
        version: 1,
        operationId: 'synthetic-arrangement-full-dex',
        inventoryRevision: 0,
        destinationCollectionId: dest,
        collections: [token(dest)],
        emptyDestinationSlots: [] as object[],
        manifest,
        slots: Array.from({ length: 1025 }, (_, n) =>
          slot(`synthetic/dex-${n}`, { kind: 'pokemon', pokemonId: n + 1 }),
        ),
        copies: ['trainer-a', 'trainer-b', 'energy-a', 'energy-b'].map((id, n) => ({
          kind: 'add',
          item: item(id, n < 2 ? 'synthetic-import-trainer' : 'synthetic-import-energy'),
          ref: null as object | null,
        })),
      };
      command.copies[1].item.grading = {
        provider: { kind: 'known', id: 'psa' },
        grade: '9',
        scale: null,
        designation: null,
        subgrades: [],
        certificate: 'synthetic-private-001',
        holder: null,
        label: { variant: 'Synthetic', assetIds: [] },
      };
      // A pristine copied preset already has 1,025 empty target slots, as actual 083 creation does.
      await db.query(
        `INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,preset_origin)
      SELECT 'synthetic/empty-'||(n-1),$1,$2,n-1,e->'target',jsonb_build_object('source',$3::jsonb->'source','entryId',e->'id')
      FROM jsonb_array_elements($3::jsonb->'entries') WITH ORDINALITY a(e,n)`,
        [dest, owner, manifest],
      );
      await flush();
      command.emptyDestinationSlots = manifest.entries.map((_, n) => ({
        id: `synthetic/empty-${n}`,
        version: 0,
        inventoryItemId: null,
        itemVersion: null,
        placementVersion: null,
      }));
      command.slots.forEach((s, n) => {
        Object.assign(s, { presetOrigin: { source: manifest.source, entryId: `entry-${n}` } });
      });
      command.slots.push(
        slot('synthetic/spacer'),
        ...command.copies.map((c) =>
          slot('synthetic/slot/' + c.item.id, { kind: 'card', cardId: c.item.identity.cardId }, c.item.id),
        ),
      );
      command.slots[2].wantedCards = [
        {
          card_id: 'synthetic-import-trainer',
          card_name: 'Synthetic Trainer',
          added_at: '2020-01-01',
          wanted_by: [owner, partner],
        },
      ];
      const beforeImport = await evidence();
      for (const change of [{ inventoryRevision: 1 }, { manifest: null }, { collections: [token(dest, 1)] }]) {
        await header(command.operationId);
        await reject(() => call('backup.arrangement', { ...command, ...change }), '40001');
      }
      for (const change of [
        { ownerUserId: owner },
        { copies: [...command.copies, command.copies[0]] },
        { slots: [{ ...command.slots[0], inventoryItemId: 'unknown', status: 'collected' }] },
        { slots: [{ ...command.slots[0], presetOrigin: { source: manifest.source, entryId: 'unknown' } }] },
      ]) {
        await header(command.operationId);
        await reject(() => call('backup.arrangement', { ...command, ...change }), '22023');
      }
      assert.deepEqual(await evidence(), beforeImport);
      // Mid-statement interruption rolls back inserted items and all earlier slots, with no ledger/event.
      await db.query(`CREATE FUNCTION pg_temp.interrupt_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='synthetic/dex-10' THEN RAISE EXCEPTION 'synthetic interruption' USING ERRCODE='57014'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_interrupt BEFORE INSERT ON public.binder_slots FOR EACH ROW EXECUTE FUNCTION pg_temp.interrupt_import()`);
      await header(command.operationId);
      await reject(() => call('backup.arrangement', command), '57014');
      await db.query('RESET ROLE; DROP TRIGGER synthetic_interrupt ON public.binder_slots');
      assert.deepEqual(await evidence(), beforeImport);
      // Recorder failure on deferred flush must roll back the command, receipt and ledger too.
      await db.query(`CREATE FUNCTION pg_temp.reject_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic recorder failure'; END $$;
      CREATE TRIGGER synthetic_recorder BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_import_audit()`);
      await db.query('SAVEPOINT audit_failure');
      await header(command.operationId);
      await call('backup.arrangement', command);
      await assert.rejects(flush(), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'P0001');
      await db.query(
        'ROLLBACK TO SAVEPOINT audit_failure; RESET ROLE; DROP TRIGGER synthetic_recorder ON public.collection_activity',
      );
      assert.deepEqual(await evidence(), beforeImport);
      await header(command.operationId);
      const receipt = await call('backup.arrangement', command);
      await flush();
      assert.equal(receipt.slotIds.length, 1030);
      assert.equal(receipt.addedItemIds.length, 4);
      normalizeStorageResult('backup.arrangement', receipt);
      const after = await evidence();
      assert.deepEqual(
        [...after.slots]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({
            id: s.id,
            target: s.target,
            status: s.status,
            wantedCards: s.wanted_cards,
            presetOrigin: s.preset_origin,
            inventoryItemId:
              after.placements.find((p: { inventory_item_id: string; slot_id: string }) => p.slot_id === s.id)
                ?.inventory_item_id ?? null,
          })),
        command.slots,
      );
      for (const c of command.copies) {
        const stored = after.items.find(
          (i: { id: string; grading: unknown; identity: unknown; acquired_at: string }) => i.id === c.item.id,
        );
        assert.deepEqual(stored.grading, c.item.grading);
        assert.deepEqual(stored.identity, c.item.identity);
        assert.equal(Date.parse(stored.acquired_at), Date.parse(c.item.acquiredAt));
      }
      await header(command.operationId);
      assert.deepEqual(await call('backup.arrangement', command), receipt);
      await flush();
      assert.deepEqual(await evidence(), after);
      await header(command.operationId);
      await reject(() => call('backup.arrangement', { ...command, inventoryRevision: 1 }), '40001');
      await header('synthetic-repeat-import');
      await reject(
        () =>
          call('backup.arrangement', {
            ...command,
            operationId: 'synthetic-repeat-import',
            inventoryRevision: 1,
            collections: [token(dest, 1, 1)],
          }),
        '40001',
      );
      await header(command.operationId, owner);
      await reject(() => call('backup.arrangement', command), '40001');
      await header(command.operationId, partner, 'rest');
      await reject(() => call('backup.arrangement', command), 'HF402');
      await db.query('RESET ROLE');
      const event = (
        await db.query(
          'SELECT id::text,action,actor_user_id,source,recovery_state FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
          [owner, command.operationId],
        )
      ).rows[0];
      assert.equal(event.action, 'backup.arrangement');
      assert.equal(event.actor_user_id, partner);
      assert.equal(event.source, 'app');
      assert.equal(event.recovery_state.filter((d: { table: string }) => d.table === 'inventory_items').length, 4);
      await header('synthetic-import-recovery-preview');
      const recovery = await call('recovery.preview', { eventId: event.id, restoreUnassignedItemIds: [] });
      assert.equal(recovery.supported, true, JSON.stringify(recovery.unsupported));
      assert.deepEqual(recovery.conflicts, []);
      await db.query('RESET ROLE; SAVEPOINT undo');
      await header('synthetic-import-undo');
      await call('recovery.apply', {
        operationId: 'synthetic-import-undo',
        eventId: event.id,
        restoreUnassignedItemIds: [],
        planVersion: 1,
        planToken: recovery.planToken,
        confirmed: true,
      });
      await flush();
      assert.equal((await evidence()).items, null);
      assert.equal((await evidence()).slots.length, 1025, 'inverse restores the exact original empty target layout');
      await db.query('ROLLBACK TO SAVEPOINT undo');
      // Empty native destination, explicit cross-collection move of an existing copy, no ownership duplication.
      const move = {
        version: 1,
        operationId: 'synthetic-import-explicit-move',
        inventoryRevision: 1,
        destinationCollectionId: source,
        collections: [token(dest, 1, 1), token(source)],
        emptyDestinationSlots: [],
        manifest: null,
        slots: [slot('synthetic/moved', { kind: 'card', cardId: 'synthetic-import-trainer' }, 'trainer-a')],
        copies: [
          {
            kind: 'existing',
            item: command.copies[0].item,
            ref: {
              itemId: 'trainer-a',
              itemVersion: 0,
              placement: {
                collectionId: dest,
                slot: {
                  id: 'synthetic/slot/trainer-a',
                  version: 0,
                  inventoryItemId: 'trainer-a',
                  itemVersion: 0,
                  placementVersion: 0,
                },
              },
            },
          },
        ],
      };
      await header(move.operationId);
      await call('backup.arrangement', move);
      await flush();
      const moved = await evidence();
      assert.equal(moved.items.length, 4);
      assert.equal(
        moved.placements.find((p: { inventory_item_id: string }) => p.inventory_item_id === 'trainer-a').slot_id,
        'synthetic/moved',
      );
      await db.query('RESET ROLE');
      const moveEvent = (
        await db.query('SELECT id::text FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2', [
          owner,
          move.operationId,
        ])
      ).rows[0].id;
      await header('synthetic-move-undo-preview');
      const moveRecovery = await call('recovery.preview', { eventId: moveEvent, restoreUnassignedItemIds: [] });
      assert.equal(moveRecovery.supported, true);
      assert.deepEqual(moveRecovery.conflicts, []);
      await db.query('RESET ROLE; SAVEPOINT move_inverse');
      await header('synthetic-move-undo');
      await call('recovery.apply', {
        operationId: 'synthetic-move-undo',
        eventId: moveEvent,
        restoreUnassignedItemIds: [],
        planVersion: 1,
        planToken: moveRecovery.planToken,
        confirmed: true,
      });
      await flush();
      const inverse = await evidence();
      assert.equal(inverse.items.length, 4);
      assert.equal(
        inverse.placements.find(
          (p: { inventory_item_id: string; slot_id: string }) => p.inventory_item_id === 'trainer-a',
        ).slot_id,
        'synthetic/slot/trainer-a',
      );
      await db.query('ROLLBACK TO SAVEPOINT move_inverse');
      await header('synthetic-stale-partner');
      await reject(() => call('backup.arrangement', { ...command, operationId: 'synthetic-stale-partner' }), '40001');
      await header(command.operationId);
      assert.deepEqual(
        await call('backup.arrangement', command),
        receipt,
        'lost outcome replay stays historical after later partner moves',
      );
      // Actual metadata ABA through the shared executor: raw -> recorded grade -> raw still advances item/root revisions.
      const movedRef = {
        itemId: 'trainer-a',
        itemVersion: 0,
        placement: {
          collectionId: source,
          slot: {
            id: 'synthetic/moved',
            version: 0,
            inventoryItemId: 'trainer-a',
            itemVersion: 0,
            placementVersion: 1,
          },
        },
      };
      for (const [n, grading] of [command.copies[1].item.grading, null].entries()) {
        const op = `synthetic-import-aba-${n}`;
        const ref = structuredClone(movedRef);
        ref.itemVersion = n;
        ref.placement.slot.itemVersion = n;
        await header(op);
        await call('inventory', {
          operationId: op,
          inventoryRevision: 2 + n,
          collections: [token(source, 1 + n, 1)],
          commands: [{ kind: 'edit', item: ref, grading }],
        });
        await flush();
      }
      const third = '00880000-0000-4000-8000-000000000013';
      await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic ABA destination')", [
        third,
        owner,
      ]);
      await db.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [third, owner],
      );
      await flush();
      const aba = {
        ...move,
        operationId: 'synthetic-import-aba-rejected',
        inventoryRevision: 4,
        destinationCollectionId: third,
        collections: [token(source, 3, 1), token(third)],
        slots: [{ ...move.slots[0], id: 'synthetic/aba-slot' }],
        copies: [{ ...move.copies[0], ref: movedRef }],
      };
      const beforeAba = await evidence();
      await header(aba.operationId);
      await reject(() => call('backup.arrangement', aba), '40001');
      assert.deepEqual(await evidence(), beforeAba);
      await header('synthetic-stale-recovery');
      const stale = await call('recovery.preview', { eventId: event.id, restoreUnassignedItemIds: [] });
      assert.ok(stale.conflicts.length);
      await db.query('RESET ROLE; SAVEPOINT overlimit');
      // Preserve the workload/timestamps, adjust only actual account entitlement to test allowance rollback.
      await db.query('UPDATE public.billing_configuration SET enforced=true,free_card_limit=4');
      const small = {
        ...command,
        emptyDestinationSlots: [],
        manifest: null,
        operationId: 'synthetic-over-limit',
        inventoryRevision: 4,
        destinationCollectionId: source,
        collections: [token(source, 3, 1)],
        slots: [slot('synthetic/overlimit')],
        copies: [{ kind: 'add', item: item('overlimit-copy'), ref: null }],
      };
      // Empty a synthetic destination under the savepoint without changing the immutable source workload.
      await db.query('DELETE FROM public.binder_slots WHERE collection_id=$1', [source]);
      await flush();
      const beforeLimit = await evidence();
      await header(small.operationId, owner);
      await reject(() => call('backup.arrangement', small), 'P0001');
      await flush();
      assert.deepEqual(await evidence(), beforeLimit);
      await db.query('ROLLBACK TO SAVEPOINT overlimit');
      await db.query('ROLLBACK');
      await preserved();
      assert.deepEqual(await protection(), before);
      assert.deepEqual(await access(), beforeAccess);
      assert.deepEqual(await policies(), beforePolicies);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  'real concurrent sessions serialize exact delivery and partner edits, lock membership, and reject unlink-first',
  { skip: !socket || !process.env.BACKUP_IMPORT_RACE_DATABASE, timeout: 30000 },
  async () => {
    if (!socket) return;
    assert.equal(socket, config.host);
    const database = process.env.BACKUP_IMPORT_RACE_DATABASE!;
    assert.match(database, /^holofolder_fresh_[a-z0-9_]+$/);
    const a = new Client({ ...config, database }),
      b = new Client({ ...config, database }),
      inspect = new Client({ ...config, database });
    await Promise.all([a.connect(), b.connect(), inspect.connect()]);
    const owner = '00880000-0000-4000-8000-000000000101',
      partner = '00880000-0000-4000-8000-000000000102';
    const dest = '00880000-0000-4000-8000-000000000111';
    const header = async (db: Client, operationId: string, actor = partner) => {
      await db.query('BEGIN');
      await db.query("SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims',$2,true)", [
        JSON.stringify({
          'x-holo-audit-context': JSON.stringify({
            actor: { kind: 'user', userId: actor },
            source: 'app',
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
    const blocked = async (pid: number) => {
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if ((await inspect.query('SELECT cardinality(pg_blocking_pids($1)) n', [pid])).rows[0].n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.fail('second session did not wait on the transaction lock');
    };
    try {
      await a.query(readFileSync(new URL('../scripts/088_atomic_arrangement_import.sql', import.meta.url), 'utf8'));
      await a.query('INSERT INTO auth.users(id,created_at) VALUES($1,now()),($2,now())', [owner, partner]);
      await a.query('UPDATE public.billing_configuration SET enforced=false');
      await a.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [
        owner,
        partner,
      ]);
      await a.query('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)', [owner]);
      await a.query(
        "INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic race',true)",
        [dest, owner],
      );
      await a.query(
        "INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')",
        [dest, owner],
      );
      const pid = Number((await b.query('SELECT pg_backend_pid() pid')).rows[0].pid);
      const command = {
        version: 1,
        operationId: 'synthetic-import-race',
        inventoryRevision: 0,
        destinationCollectionId: dest,
        collections: [{ collectionId: dest, version: 0, layoutRevision: 0 }],
        emptyDestinationSlots: [],
        manifest: null,
        slots: [
          {
            id: 'synthetic/race-slot',
            target: null,
            status: null,
            wantedCards: [],
            inventoryItemId: null,
            presetOrigin: null,
          },
        ],
        copies: [],
      };
      const call = async (db: Client, op: string, input: unknown) =>
        (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [op, owner, input])).rows[0].r;
      await header(a, command.operationId);
      const first = await call(a, 'backup.arrangement', command);
      await header(b, command.operationId);
      const retry = call(b, 'backup.arrangement', command);
      await blocked(pid);
      await a.query('COMMIT');
      assert.deepEqual(await retry, first);
      await b.query('COMMIT');
      assert.equal(
        (
          await inspect.query(
            'SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2',
            [owner, command.operationId],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await inspect.query(
            "SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND operation='backup_arrangement_v1'",
            [partner],
          )
        ).rows[0].n,
        1,
      );
      // An exact historical retry still locks membership, so unlink waits for the acceptance transaction.
      await header(a, command.operationId);
      await call(a, 'backup.arrangement', command);
      await b.query('BEGIN');
      const unlink = b.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await blocked(pid);
      await a.query('COMMIT');
      await unlink;
      await b.query('ROLLBACK');
      // A real partner edit wins first. A later import with its old revision cannot create any partial layout.
      await header(a, 'synthetic-partner-edit');
      const edit = {
        operationId: 'synthetic-partner-edit',
        inventoryRevision: 1,
        collections: [],
        commands: [
          {
            kind: 'add',
            itemId: 'synthetic/race-copy',
            identity: { kind: 'pokemon', pokemonId: 1 },
            grading: null,
            acquiredAt: null,
          },
        ],
      };
      await call(a, 'inventory', edit);
      await header(b, 'synthetic-import-after-edit');
      const stale = call(b, 'backup.arrangement', {
        ...command,
        operationId: 'synthetic-import-after-edit',
        inventoryRevision: 1,
      });
      // Attach rejection before releasing the blocker so no rejection escapes the test runner.
      const rejected = assert.rejects(
        stale,
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '40001',
      );
      await blocked(pid);
      await a.query('COMMIT');
      await rejected;
      await b.query('ROLLBACK');
      // Unlink-first rejects even a historical exact retry before returning its receipt.
      await a.query('DELETE FROM public.partnerships WHERE owner_user_id=$1', [owner]);
      await header(b, command.operationId);
      await assert.rejects(
        call(b, 'backup.arrangement', command),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '42501',
      );
      await b.query('ROLLBACK');
    } finally {
      await Promise.all([a.query('ROLLBACK'), b.query('ROLLBACK')]);
      await a.query('DELETE FROM auth.users WHERE id IN ($1,$2)', [owner, partner]);
      await Promise.all([a.end(), b.end(), inspect.end()]);
    }
  },
);
