import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { generateSetChecklist } from '@/lib/set-preset';
import { syntheticPresetCards, syntheticPresetSet, syntheticPresetPromo } from './fixtures/set-preset';

// Opt-in only to this worker's isolated Unix socket. Never read credential URLs.
const socket = '/Users/cal/.local/share/holofolder/checklist101-local/socket';
const enabled = process.env.SET_CHECKLIST_TEST_SOCKET;
const config = { host: socket, port: 55601, user: 'checklist101', database: 'postgres' };
const migration = readFileSync(new URL('../scripts/101_copied_set_checklist_creation.sql', import.meta.url), 'utf8');
const owner = '01010000-0000-4000-8000-000000000001',
  partner = '01010000-0000-4000-8000-000000000002';
function checklist() {
  return generateSetChecklist({
    set: syntheticPresetSet,
    cards: syntheticPresetCards,
    promos: [syntheticPresetPromo],
    language: 'en',
    finishes: ['normal', 'reverse_holo'],
    excludedCardIds: ['synthetic-set-2'],
    capturedAt: '2026-11-10T12:00:00.000Z',
  });
}
function command() {
  const c = checklist();
  return {
    version: 1,
    operationId: 'synthetic-' + randomUUID(),
    inventoryRevision: 0,
    collectionId: randomUUID(),
    name: 'Synthetic copied checklist',
    kind: 'binder',
    defaultPresentation: 'binder',
    location: null,
    grid: null,
    manifest: { ...c.manifest, setScope: c.scope },
    slotIds: c.manifest.entries.map(() => randomUUID()),
  };
}
async function seed(db: Client) {
  await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, partner]);
  await db.query(
    'INSERT INTO public.billing_configuration(id,enforced) VALUES(true,false) ON CONFLICT(id) DO UPDATE SET enforced=false',
  );
  await db.query('INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)', [owner, partner]);
  await db.query("INSERT INTO public.tcg_series(id,name_en) VALUES('synthetic-series-101','Synthetic series')");
  for (const set of [syntheticPresetSet, syntheticPresetPromo.set])
    await db.query('INSERT INTO public.tcg_sets(id,series_id,name_en,official_card_count) VALUES($1,$2,$3,$4)', [
      set.id,
      'synthetic-series-101',
      set.name,
      'officialCardCount' in set ? set.officialCardCount : null,
    ]);
  for (const card of [...syntheticPresetCards, syntheticPresetPromo])
    await db.query(
      'INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,name_json,variants_json) VALUES($1,$2,$3,$4,$5,$6)',
      [card.id, 'synthetic-series-101', card.set.id, card.localId, { en: card.name }, card.variants],
    );
}
async function send(db: Client, input: Record<string, unknown>, actor = owner, operation = 'collection.create') {
  await db.query('RESET ROLE');
  await db.query(
    "SELECT set_config('request.headers',$1,true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)",
    [
      JSON.stringify({
        'x-holo-audit-context': JSON.stringify({
          actor: { kind: 'user', userId: actor },
          source: 'app',
          clientId: null,
          batchId: null,
          clientOccurredAt: null,
          operationId: input.operationId,
        }),
      }),
    ],
  );
  await db.query('SET LOCAL ROLE service_role');
  return (await db.query('SELECT public.storage_execute_v1($1,$2,$3) r', [operation, owner, input])).rows[0].r;
}
async function flush(db: Client) {
  await db.query('RESET ROLE; SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED');
}
async function rejected(db: Client, input: Record<string, unknown>) {
  await db.query('RESET ROLE; SAVEPOINT invalid');
  await assert.rejects(
    send(db, input),
    (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === '22023',
  );
  await db.query('ROLLBACK TO SAVEPOINT invalid; RESET ROLE');
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1', [owner])).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id IN ($1,$2)', [
        owner,
        partner,
      ])
    ).rows[0].n,
    0,
  );
}
test(
  '101 is repeatable, changes only creation validation, rejects fabricated scope and saves exact independent initial goals',
  { skip: !enabled, timeout: 60000 },
  async () => {
    assert.equal(enabled, socket);
    const db = new Client(config);
    await db.connect();
    try {
      const gateway = (
        await db.query("SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) body")
      ).rows[0].body;
      await db.query(migration);
      const body = (
        await db.query(
          "SELECT pg_get_functiondef('collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) body",
        )
      ).rows[0].body;
      await db.query(migration);
      assert.equal(
        (
          await db.query(
            "SELECT pg_get_functiondef('collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) body",
          )
        ).rows[0].body,
        body,
      );
      assert.equal(
        (await db.query("SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) body"))
          .rows[0].body,
        gateway,
      );
      for (const role of ['anon', 'authenticated', 'holo_mcp', 'service_role'])
        assert.equal(
          (
            await db.query(
              "SELECT has_function_privilege($1,'collection_audit_private.validate_set_creation_v1(jsonb)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
      await db.query('BEGIN');
      await seed(db);
      await flush(db);
      await db.query('SAVEPOINT legacy_manifest');
      const plain = {
        ...command(),
        manifest: { source: { id: 'blank', version: '1' }, name: 'Blank', entries: [] },
        slotIds: [],
      };
      await send(db, plain);
      await flush(db);
      assert.deepEqual(
        (
          await db.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
            plain.collectionId,
          ])
        ).rows[0].preset_manifest,
        plain.manifest,
      );
      await db.query('ROLLBACK TO SAVEPOINT legacy_manifest');
      for (const mutate of [
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.language = 'fr';
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.warnings = ['Invented completeness claim'];
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.capturedAt = 'now';
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.cards[0].verifiedFinishes.push('holo');
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.excludedCardIds = [];
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.promoCardIds = [];
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.entries[0].target = { kind: 'card', cardId: 'invented-card', language: 'en' };
        },
        (c: ReturnType<typeof command>) => {
          c.manifest.setScope.cards[0].languageConfirmed = false;
        },
      ]) {
        const input = structuredClone(command());
        mutate(input);
        await rejected(db, input);
      }
      await db.query('SAVEPOINT failed_recorder');
      await db.query(
        "CREATE OR REPLACE FUNCTION collection_audit_private.command_result(owner_id uuid,result jsonb,action text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic recorder failure'; END $$",
      );
      await assert.rejects(
        send(db, command()),
        (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'P0001',
      );
      await db.query('ROLLBACK TO SAVEPOINT failed_recorder; RESET ROLE');
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.binders WHERE owner_user_id=$1', [owner])).rows[0].n,
        0,
      );
      const first = command(),
        result = await send(db, first, partner);
      await flush(db);
      assert.equal(result.inventoryRevision, 1);
      assert.deepEqual(await send(db, first, partner), result);
      await flush(db);
      const saved = (
        await db.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
          first.collectionId,
        ])
      ).rows[0].preset_manifest;
      assert.deepEqual(saved, first.manifest);
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1', [owner])).rows[0]
          .n,
        0,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1', [owner]))
          .rows[0].n,
        1,
      );
      // A second creation copies the same evidence with independent IDs and no shared membership.
      const second = { ...command(), inventoryRevision: 1 };
      await send(db, second);
      await flush(db);
      assert.deepEqual(
        (
          await db.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
            second.collectionId,
          ])
        ).rows[0].preset_manifest,
        first.manifest,
      );
      const append = {
        operationId: 'synthetic-' + randomUUID(),
        inventoryRevision: 2,
        collectionId: first.collectionId,
        collectionVersion: 0,
        layoutRevision: 0,
        commands: [{ kind: 'create', ids: ['synthetic-free-extra-101'], beforeSlotId: null }],
      };
      await send(db, append, owner, 'slots');
      await flush(db);
      const extra = (
        await db.query("SELECT target,preset_origin FROM public.binder_slots WHERE id='synthetic-free-extra-101'")
      ).rows[0];
      assert.equal(extra.target, null);
      assert.equal(extra.preset_origin, null);
      assert.deepEqual(
        (
          await db.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
            first.collectionId,
          ])
        ).rows[0].preset_manifest,
        saved,
      );
      const ref = {
        id: first.slotIds[0],
        version: 0,
        inventoryItemId: null,
        itemVersion: null,
        placementVersion: null,
      };
      await send(
        db,
        {
          operationId: 'synthetic-' + randomUUID(),
          inventoryRevision: 3,
          collectionId: first.collectionId,
          collectionVersion: 1,
          layoutRevision: 1,
          commands: [{ kind: 'update', slot: ref, target: null }],
        },
        owner,
        'slots',
      );
      await flush(db);
      assert.equal(
        (await db.query('SELECT target FROM public.binder_slots WHERE id=$1', [ref.id])).rows[0].target,
        null,
      );
      assert.deepEqual(
        (
          await db.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
            first.collectionId,
          ])
        ).rows[0].preset_manifest,
        saved,
      );
      const any = generateSetChecklist({
        set: syntheticPresetSet,
        cards: syntheticPresetCards,
        promos: [],
        language: 'en',
        finishes: [],
        excludedCardIds: [],
        capturedAt: '2026-11-10T12:00:00.000Z',
      });
      await send(db, {
        ...command(),
        inventoryRevision: 4,
        manifest: { ...any.manifest, setScope: any.scope },
        slotIds: any.manifest.entries.map(() => randomUUID()),
      });
      await flush(db);
      // Snapshot reads do not revalidate historical evidence against later catalog updates.
      await db.query("UPDATE public.tcg_cards SET variants_json='{}' WHERE id=$1", [syntheticPresetCards[0].id]);
      assert.deepEqual(
        await send(db, first, partner),
        result,
        'exact accepted replay precedes mutable catalog validation',
      );
      await flush(db);
      await db.query('ROLLBACK');
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  },
);

test(
  '101 committed scope reopens on a separate connection without catalog refresh',
  { skip: !enabled, timeout: 60000 },
  async () => {
    assert.equal(enabled, socket);
    const admin = new Client(config);
    await admin.connect();
    const database = 'synthetic_checklist101_' + randomUUID().replaceAll('-', '');
    const writer = new Client({ ...config, database }),
      reader = new Client({ ...config, database });
    try {
      await admin.query(`CREATE DATABASE ${database} TEMPLATE postgres`);
      await writer.connect();
      await reader.connect();
      await writer.query('BEGIN');
      await seed(writer);
      const input = command();
      await send(writer, input);
      await flush(writer);
      await writer.query('COMMIT');
      assert.deepEqual(
        (
          await reader.query('SELECT preset_manifest FROM public.storage_collection_state WHERE collection_id=$1', [
            input.collectionId,
          ])
        ).rows[0].preset_manifest,
        input.manifest,
      );
      assert.equal(
        (
          await reader.query('SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1', [
            input.collectionId,
          ])
        ).rows[0].n,
        input.slotIds.length,
      );
    } finally {
      await writer.end();
      await reader.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.end();
    }
  },
);
