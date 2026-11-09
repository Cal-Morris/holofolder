import { test } from "node:test"
import assert from "node:assert/strict"
import { privateRecoveryDatabase } from "./private-recovery-db"
import { readFileSync } from "node:fs"

const socket = process.env.CONVERTED_CASCADE_TEST_SOCKET
const config = socket ? privateRecoveryDatabase(socket, { socket: "/Users/cal/.local/share/holofolder/issue396-converted-local/socket", port: 55580, user: "converted_recovery_test" }) : undefined
const owner = "03960800-0000-4000-8000-000000000001", partner = "03960800-0000-4000-8000-000000000002"
const stranger = "03960800-0000-4000-8000-000000000003"
const converted = "03960800-0000-4000-8000-000000000011", native = "03960800-0000-4000-8000-000000000012"
const copies = ["03960800-0000-4000-8000-000000000021", "03960800-0000-4000-8000-000000000022", "03960800-0000-4000-8000-000000000023"]
const source = { source: "app", clientId: null, batchId: null, clientOccurredAt: null }
const grade = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, subgrades: [], certificate: "synthetic-private-cert", holder: null, label: { variant: null, assetIds: [] } }
const slot = (n: number) => `legacy-dex-v1/${converted}/${n}`

// Explicit opt-in private socket only; every fixture is synthetic and rolls back.
test("converted cascades: whole deletion and mapped removal restore frozen source without ownership replay", { skip: !socket, timeout: 120000 }, async () => {
  if (!socket) return

  const { Client } = await import("pg")
  const db = new Client(config)
  await db.connect()
  try {
    if (!process.env.CONVERTED_CASCADE_BASELINE) {
      const migration = readFileSync(new URL("../scripts/081_converted_cascade_recovery.sql", import.meta.url), "utf8")
      await db.query(readFileSync(new URL("../scripts/077_safe_collection_recovery.sql", import.meta.url), "utf8"))
      await assert.rejects(db.query(migration), /converted_cascade_requires_fixed_080/)
      await db.query("ROLLBACK")
      for (const file of ["079_bounded_collection_recovery.sql", "080_converted_content_recovery.sql"]) {
        await db.query(readFileSync(new URL(`../scripts/${file}`, import.meta.url), "utf8"))
      }
      const protectedDefinitions = async () => (await db.query(`SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest,p.proacl::text acl,p.proowner
        FROM pg_proc p WHERE p.oid IN ('collection_audit_private.flush()'::regprocedure,'collection_audit_private.immutable()'::regprocedure,
          'collection_audit_private.redact(jsonb)'::regprocedure,'collection_audit_private.context(uuid)'::regprocedure,
          'public.guard_storage_authority_v1()'::regprocedure,'public.check_slot_placement_v1()'::regprocedure) ORDER BY 1`)).rows
      const before = await protectedDefinitions()
      await db.query(migration); await db.query(migration)
      assert.deepEqual(await protectedDefinitions(),before, "recorder, immutable guard, redactor, attribution, authority and 079 placement rule remain unchanged")
      const executor = (await db.query("SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) b")).rows[0].b
      assert.equal(executor.match(/plan:=collection_audit_private.recovery_plan_v1/g)?.length,2)
      assert.equal(executor.match(/reviewed:=collection_audit_private.recovery_preview_v1/g)?.length,1)
      assert.ok(executor.indexOf('FROM public.partnerships') < executor.indexOf('4701'))
      for (const role of ["anon","authenticated","holo_mcp","service_role"]) {
        const privileges=(await db.query(`SELECT p.proname,has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='collection_audit_private' OR p.proname IN ('inventory_command_v1','inventory_object_v1','inventory_id_v1','inventory_revision_v1','inventory_match_v1','inventory_item_ref_v1','inventory_evidence_v1','slot_command_v1','slot_page_v1','slot_check_ref_v1','slot_check_target_v1','slot_catalog_card_v1','slot_catalog_ids_v1','slot_saved_count_v1')`,[role])).rows
        assert.ok(privileges.every(p=>!p.allowed),role)
      }
    }
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL TIME ZONE 'UTC'")
    const flush = () => db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
    const rejected = async (run: () => Promise<unknown>, error: RegExp) => {
      await db.query("SAVEPOINT rejected"); await assert.rejects(run(), error); await db.query("ROLLBACK TO SAVEPOINT rejected")
    }
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, stranger])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic converted',true),($2,$3,'Synthetic native',false)", [converted, native, owner])
    // Two physical copies of the same printing plus one legacy species-only unknown printing.
    await db.query(`INSERT INTO public.pokemon_collection(id,binder_id,user_id,pokemon_id,pokemon_name,status,card_id,card_name,collected_at) VALUES
      ($1,$4,$5,1,'Synthetic one','collected','synthetic-converted-print','Synthetic card','2020-01-02'),
      ($2,$4,$5,2,'Synthetic two','finalized','synthetic-converted-print','Synthetic card','2021-01-02'),
      ($3,$4,$5,3,'Synthetic unknown','collected',NULL,NULL,NULL)`, [...copies, converted, owner])
    const wants = [{ card_id: "synthetic-want", card_name: "Synthetic want", added_at: "2020-01-01", wanted_by: [partner] }]
    await db.query("INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status,wanted_cards) VALUES($1,$2,4,'Synthetic want','wishlisted',$3)", [converted, owner, JSON.stringify(wants)])
    await db.query(`INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name,status,collected_at)
      SELECT $1,$2,n,'Synthetic legacy '||n,CASE WHEN n%4=0 THEN 'collected' ELSE 'considering' END,'2019-03-04T01:02:03Z'
      FROM generate_series(5,1025) n`, [converted, owner])
    await flush()
    await db.query("SELECT public.convert_legacy_binder_v1($1,$2,public.legacy_binder_evidence_v1($1)->>'rowsDigest')", [converted, owner]); await flush()
    const event = async () => (await db.query("SELECT * FROM public.collection_activity WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1", [owner])).rows[0]
    const conversionEvent = await event()
    assert.equal(conversionEvent.action, "legacy_conversion")
    assert.equal(conversionEvent.recovery_state.filter((e: { table: string }) => e.table === "binder_legacy_rows").length, 1025, "every source mapping has a distinct recorded identity")
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [native, owner])
    await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/native-a',$1,$2,0),('synthetic/native-b',$1,$2,1)", [native, owner])
    await db.query("UPDATE public.binders SET binder_rows=7,binder_cols=3,color='synthetic',sort_order=9 WHERE id=$1", [converted])
    await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-converted-series')")
    await db.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-converted-set','synthetic-converted-series')")
    await db.query("INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic-converted-print','synthetic-converted-series','synthetic-converted-set','1')")
    await db.query("INSERT INTO public.card_prices(card_id,language,gbp_amount,confidence,fetched_at) VALUES('synthetic-converted-print','en',12,'medium','2020-01-01')")
    await db.query("INSERT INTO public.tcg_card_dex_ids(card_id,dex_id) VALUES('synthetic-converted-print',1),('synthetic-converted-print',2)")
    await flush()
    const preservation = async () => (await db.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.pokemon_collection c WHERE binder_id=$1) originals,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY legacy_row_id) FROM public.binder_legacy_rows m WHERE collection_id=$1) frozen,
      (SELECT to_jsonb(s)-ARRAY['version','layout_revision'] FROM public.storage_collection_state s WHERE collection_id=$1) provenance,
      (SELECT to_jsonb(b) FROM public.binders b WHERE id=$1) metadata`, [converted])).rows[0]
    const preserved = await preservation()
    let sequence = 0
    const op = () => `synthetic-converted-${++sequence}`
    const ref = async (id: string) => {
      const s = (await db.query("SELECT s.*,p.inventory_item_id,p.version pv,i.version iv FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.id=$1", [id])).rows[0]
      return { collectionId: s.collection_id, slot: { id, version: Number(s.version), inventoryItemId: s.inventory_item_id ?? null, itemVersion: s.iv == null ? null : Number(s.iv), placementVersion: s.pv == null ? null : Number(s.pv) } }
    }
    const item = async (id: string) => {
      const i = (await db.query("SELECT i.version,p.slot_id FROM public.inventory_items i LEFT JOIN public.inventory_placements p ON p.inventory_item_id=i.id WHERE i.id=$1", [id])).rows[0]
      return { itemId: id, itemVersion: Number(i.version), placement: i.slot_id ? await ref(i.slot_id) : null }
    }
    const send = async (commands: unknown[], actor = partner, flushNow = true) => {
      const revision = Number((await db.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [owner])).rows[0].inventory_revision)
      const collections = (await db.query('SELECT collection_id AS "collectionId",version::int,layout_revision::int AS "layoutRevision" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id', [owner])).rows
      await db.query("SELECT public.inventory_command_v1($1,$2,$3,$4)", [actor, owner, { operationId: op(), inventoryRevision: revision, collections, commands }, source]); if (flushNow) await flush(); return event()
    }
    const slots = async (commands: unknown[], actor = owner) => {
      const s = (await db.query("SELECT s.*,o.inventory_revision FROM public.storage_collection_state s JOIN public.inventory_owner_state o USING(owner_user_id) WHERE collection_id=$1", [converted])).rows[0]
      await db.query("SELECT public.slot_command_v1($1,$2,$3,$4)", [actor, owner, { operationId: op(), collectionId: converted, inventoryRevision: Number(s.inventory_revision), collectionVersion: Number(s.version), layoutRevision: Number(s.layout_revision), commands }, { source: "app", clientId: null }]); await flush(); return event()
    }
    const preview = async (id: string, choices: string[] = [], actor = partner) => {
      await db.query("SET LOCAL TIME ZONE 'Pacific/Auckland'")
      const p = (await db.query("SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,$4) p", [actor, owner, id, choices])).rows[0].p
      await db.query("SET LOCAL TIME ZONE 'UTC'")
      return p
    }
    const apply = async (id: string, token: string, operationId = op(), choices: string[] = [], actor = partner) => {
      const r = (await db.query("SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r", [actor, owner, { eventId: id, planVersion: 1, planToken: token, operationId, restoreUnassignedItemIds: choices, confirmed: true }, source])).rows[0].r
      await flush(); return r
    }
    const state = async () => (await db.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.inventory_items i WHERE owner_user_id=$1) items,
      (SELECT jsonb_agg(to_jsonb(s)-ARRAY['version','created_at','updated_at'] ORDER BY id) FROM public.binder_slots s WHERE owner_user_id=$1) slots,
      (SELECT jsonb_agg(to_jsonb(p)-ARRAY['version','created_at','updated_at'] ORDER BY inventory_item_id) FROM public.inventory_placements p WHERE owner_user_id=$1) placements`, [owner])).rows[0]
    const slotRefs = async () => (await db.query(`SELECT s.id,s.version::int,p.inventory_item_id AS "inventoryItemId",i.version::int AS "itemVersion",p.version::int AS "placementVersion"
      FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id
      WHERE s.collection_id=$1 ORDER BY s.position`, [converted])).rows
    const deleteCollection = async (flushNow = true) => send([{ kind: "deleteCollection", collectionId: converted, replacementDefaultCollectionId: native, slots: await slotRefs() }],partner,flushNow)
    const sideEffects = async () => (await db.query(`SELECT
      (SELECT count(*)::int FROM public.partner_acquisitions WHERE owner_user_id=$1) acquisitions,
      (SELECT count(*)::int FROM public.partner_push_deliveries d JOIN public.partner_acquisitions a ON a.id=d.event_id WHERE a.owner_user_id=$1) deliveries,
      (SELECT count(*)::int FROM public.binder_history_entries WHERE binder_id=$2) searches,
      (SELECT count(*)::int FROM public.card_price_history WHERE card_id='synthetic-converted-print') prices`, [owner, converted])).rows[0]
    const effectsBefore = await sideEffects()
    assert.equal((await preview(conversionEvent.id)).supported, false)
    await send([{ kind: "edit", item: await item(copies[0]), grading: grade }])
    await slots([{ kind: "update", slot: (await ref(slot(4))).slot, target: null, wantedCards: [...wants, ...wants] }])
    await slots([{ kind: "create", ids: ["synthetic/edited-spacer"], beforeSlotId: slot(3) }])
    await slots([{ kind: "move", slots: [(await ref(slot(4))).slot], beforeSlotId: slot(1) }])
    await db.query("SAVEPOINT retained_ownership_billing")
    // Existing copies may already exceed a changed allowance. Restore no new saved work.
    await db.query("UPDATE public.binder_slots s SET status=NULL,wanted_cards='[]',version=version+1 WHERE collection_id=$1 AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.slot_id=s.id)",[converted]); await flush()
    await db.query("UPDATE public.binders SET binder_rows=NULL,binder_cols=NULL WHERE id=$1",[converted]); await flush()
    const noGrowthBefore=await state(), noGrowthEvent=await deleteCollection(), noGrowthPlan=await preview(noGrowthEvent.id,[],owner)
    await db.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=1,free_binder_limit=20")
    const savedBefore=Number((await db.query("SELECT public.slot_saved_count_v1($1) n",[owner])).rows[0].n)
    assert.ok(savedBefore>1)
    await apply(noGrowthEvent.id,noGrowthPlan.planToken,op(),[],owner)
    assert.equal(Number((await db.query("SELECT public.slot_saved_count_v1($1) n",[owner])).rows[0].n),savedBefore)
    assert.deepEqual(await state(),noGrowthBefore)
    await db.query("ROLLBACK TO SAVEPOINT retained_ownership_billing")
    for (const corruption of ['missingMapping','changedItemSource','clearedItemSource']) {
      await db.query("SAVEPOINT prior_source_corruption")
      if (corruption === 'missingMapping') await db.query("DELETE FROM public.binder_legacy_rows WHERE legacy_row_id=$1",[copies[1]])
      else if (corruption === 'clearedItemSource') await db.query("UPDATE public.inventory_items SET legacy_source=NULL,version=version+1 WHERE id=$1",[copies[1]])
      else await db.query("UPDATE public.inventory_items SET legacy_source=legacy_source||'{\"syntheticChanged\":true}',version=version+1 WHERE id=$1",[copies[1]])
      await flush()
      const corruptedEvent=await deleteCollection(),corruptedPlan=await preview(corruptedEvent.id)
      assert.equal(corruptedPlan.planToken,null,corruption)
      assert.ok(corruptedPlan.conflicts.some((c: {reason:string})=>c.reason==='conversion_source_changed'),corruption)
      await db.query("ROLLBACK TO SAVEPOINT prior_source_corruption")
    }
    const workloads = ["mapped", "mapped075", "collection", "auckland-to-utc", "utc-to-auckland", "removed-source-then-collection", "maximum"]
    for (const kind of workloads) {
      await db.query("SAVEPOINT cascade")
      if (kind === "removed-source-then-collection") {
        // A previously removed wanted mapping has no surviving inventory legacy_source.
        // Its FULL row must come from retained authoritative conversion evidence.
        await slots([{ kind: "remove", slots: [(await ref(slot(4))).slot] }])
      }
      if (kind === "maximum") {
        // Remove the edited spacer so the supported maximum remains exactly 4,096 slots.
        await slots([{ kind: "remove", slots: [(await ref("synthetic/edited-spacer")).slot] }])
        await db.query(`INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target)
          SELECT 'synthetic/max-slot/'||n,$1,$2,n,jsonb_build_object('kind','pokemon','pokemonId',1) FROM generate_series(1025,4095) n`, [converted, owner])
        await db.query(`INSERT INTO public.inventory_items(id,owner_user_id,identity,acquired_at)
          SELECT 'synthetic/max-copy/'||s.position,$2,coalesce(s.target,jsonb_build_object('kind','pokemon','pokemonId',1)),'2018-04-05T06:07:08Z' FROM public.binder_slots s
          WHERE s.collection_id=$1 AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.slot_id=s.id)`, [converted, owner])
        await db.query(`INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id)
          SELECT 'synthetic/max-copy/'||s.position,$2,$1,s.id FROM public.binder_slots s WHERE s.collection_id=$1
          AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.slot_id=s.id)`, [converted, owner])
        await db.query("UPDATE public.binder_slots SET status='collected',version=version+1 WHERE collection_id=$1 AND status IS DISTINCT FROM 'collected'", [converted])
        await db.query("UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+1 WHERE collection_id=$1", [converted])
        await flush()
      }
      const before = await state(), frozenBefore = await preservation()
      await db.query(kind === "auckland-to-utc" ? "SET LOCAL TIME ZONE 'Pacific/Auckland'" : "SET LOCAL TIME ZONE 'UTC'")
      const removeRefs = kind.startsWith("mapped") ? [(await ref(slot(4))).slot, (await ref(slot(1))).slot] : []
      const e = kind === "mapped"
        ? await slots([{ kind: "remove", slots: removeRefs }])
        : kind === "mapped075" ? await send([{ kind: "removeSlots", slots: removeRefs.map(slot => ({ collectionId: converted, slot })) }])
        : await deleteCollection()
      if (kind === "maximum") {
        for (let n=0;n<512;n++) {
          await db.query("UPDATE public.binder_slots SET version=version+1 WHERE id='synthetic/native-a'")
          await flush()
        }
      }
      await db.query("SET LOCAL TIME ZONE 'UTC'")
      const started = performance.now()
      const p = await preview(e.id)
      const previewMs = performance.now()-started
      assert.equal(p.supported, true, JSON.stringify(p.unsupported)); assert.deepEqual(p.conflicts, [])
      const itemsAfterDelete = (await state()).items
      assert.deepEqual(await sideEffects(), effectsBefore)
      await rejected(() => preview(e.id, [copies[0]]), /invalid_unassigned_recovery/)
      const operationId = op()
      if (kind === "collection" || kind === "maximum") {
        const beforeFailure = await state()
        await db.query("SET LOCAL statement_timeout='1ms'")
        await rejected(() => apply(e.id, p.planToken, operationId), /statement timeout/)
        await db.query("SET LOCAL statement_timeout='10s'")
        assert.deepEqual(await state(), beforeFailure)
        assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1", [operationId])).rows[0].n, 0)
      }
      if (kind === "collection") {
        await db.query("SAVEPOINT recorder_failure")
        await db.query("CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_cascade_recorder_failure'; END $$")
        await rejected(() => apply(e.id, p.planToken, operationId), /synthetic_cascade_recorder_failure/)
        assert.equal((await db.query("SELECT count(*)::int n FROM collection_audit_private.pending WHERE owner_id=$1", [owner])).rows[0].n, 0)
        await db.query("ROLLBACK TO SAVEPOINT recorder_failure")
      }
      if (kind === "utc-to-auckland") await db.query("SET LOCAL TIME ZONE 'Pacific/Auckland'")
      const applyStarted = performance.now()
      const result = await apply(e.id, p.planToken, operationId)
      assert.deepEqual(await apply(e.id, p.planToken, operationId), result)
      await db.query("SET LOCAL TIME ZONE 'UTC'")
      assert.deepEqual(await sideEffects(), effectsBefore)
      assert.equal((await db.query("SELECT count(*)::int n FROM collection_audit_private.pending WHERE owner_id=$1", [owner])).rows[0].n, 0)
      console.log(JSON.stringify({ syntheticWorkload: kind, previewMs: Math.round(previewMs), applyMs: Math.round(performance.now()-applyStarted) }))
      assert.deepEqual((await state()).items, itemsAfterDelete, "retained copies are never acquired again")
      assert.deepEqual(await state(), before)
      // Binder and slot timestamps are ordinary audit projections, frozen compatibility rows are exact.
      const restored = await preservation()
      assert.deepEqual(restored.originals, frozenBefore.originals)
      assert.deepEqual(restored.frozen, frozenBefore.frozen)
      assert.deepEqual(restored.provenance, frozenBefore.provenance)
      const {created_at:_created,updated_at:_updated,...metadata}=restored.metadata
      const {created_at:_oldCreated,updated_at:_oldUpdated,...originalMetadata}=frozenBefore.metadata
      assert.deepEqual(metadata,originalMetadata)
      assert.deepEqual((await db.query("SELECT recovery_state FROM public.collection_activity WHERE id=$1", [e.id])).rows[0].recovery_state, e.recovery_state)
      assert.equal((await event()).recovery_of_event_id, e.id)
      await db.query("ROLLBACK TO SAVEPOINT cascade")
    }
    // Each adversarial change rejects the whole event, and stale attempts preserve every row.
    for (const adversary of ["grade", "missingCopy", "copyABA", "name", "default", "rootId", "slotId", "source", "receipt", "member", "allowance", "layoutEntitlement"]) {
      await db.query("SAVEPOINT adversary")
      if (["allowance","layoutEntitlement"].includes(adversary)) {
        await db.query("UPDATE public.binder_slots SET wanted_cards=$2,version=version+1 WHERE id=$1",[slot(4),JSON.stringify([...wants,...wants].map(w=>({...w,wanted_by:[owner]})))])
        if (adversary === "allowance") await db.query("UPDATE public.binders SET binder_rows=NULL,binder_cols=NULL WHERE id=$1",[converted])
        await flush()
      }
      const e = await deleteCollection(), p = await preview(e.id,[],owner), key = op()
      assert.deepEqual(p.conflicts, [])
      if (adversary === "grade" || adversary === "copyABA") {
        await db.query("UPDATE public.inventory_items SET grading=NULL,version=version+1 WHERE id=$1", [copies[0]]); await flush()
        if (adversary === "copyABA") { await db.query("UPDATE public.inventory_items SET grading=$2,version=version-1 WHERE id=$1", [copies[0],grade]); await flush() }
      } else if (adversary === "missingCopy") {
        await send([{ kind: "removeOwned", item: await item(copies[0]) }])
      } else if (adversary === "name") {
        await db.query("INSERT INTO public.binders(owner_user_id,name) VALUES($1,'Synthetic converted')", [owner]); await flush()
      } else if (adversary === "default") {
        await db.query("UPDATE public.binders SET name='Synthetic replacement renamed' WHERE id=$1", [native]); await flush()
      } else if (["rootId","receipt","source"].includes(adversary)) {
        await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic recreated root')", [converted,owner])
        if (adversary === "receipt") await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority,conversion_version,converted_at,conversion_receipt) VALUES($1,$2,'slots',1,now(),'{}')", [converted,owner])
        if (adversary === "source") await db.query("INSERT INTO public.pokemon_collection(id,binder_id,user_id,pokemon_id,pokemon_name) VALUES($1,$2,$3,1,'Synthetic changed source')", [copies[0],converted,owner])
        await flush()
      } else if (adversary === "slotId") {
        await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES($1,$2,$3,99)", [slot(1),native,owner]); await flush()
      } else if (adversary === "member") {
        await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner]); await flush()
      } else if (adversary === "allowance") {
        await db.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=1,free_binder_limit=20")
      } else if (adversary === "layoutEntitlement") {
        await db.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=10000,free_binder_limit=20")
      }
      const beforeAttempt = await state()
      const denial = adversary === 'allowance' ? /card_limit_reached/ : adversary === 'layoutEntitlement' ? /upgrade_required/ : /recovery_plan_conflict/
      await rejected(() => apply(e.id,p.planToken,key,[],owner), denial)
      assert.deepEqual(await state(),beforeAttempt)
      assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE request_key=$1", [key])).rows[0].n,0)
      if (!["allowance","layoutEntitlement"].includes(adversary)) {
        const fresh = await preview(e.id,[],owner)
        assert.equal(fresh.planToken,null,adversary)
        assert.ok(fresh.conflicts.length,adversary)
      }
      await db.query("ROLLBACK TO SAVEPOINT adversary")
    }
    // Auxiliary cascades are a whole-event gate even though their rows are intentionally not retained.
    for (const [setup, reason] of [
      ["INSERT INTO public.partner_acquisitions(operation_id,actor_id,recipient_id,owner_user_id,partnership_id,binder_id,pokemon_id,card_id,card_name,actor_name) SELECT gen_random_uuid(),$2,p.user2_id,$2,p.id,$1,1,'synthetic-converted-print','Synthetic','Synthetic' FROM public.partnerships p WHERE p.owner_user_id=$2", "push_delivery_cascade"],
      ["INSERT INTO public.binder_history_state(binder_id) VALUES($1)", "search_history_cascade"],
      ["INSERT INTO public.binder_public_slugs(owner_user_id,slug,binder_id) VALUES($2,'synthetic-cascade',$1)", "public_slug_cascade"],
      ["INSERT INTO public.binder_shares(owner_user_id,binder_id,token) VALUES($2,$1,'synthetic-never-republish-token')", "unsupported_table:binder_shares"],
    ]) {
      await db.query("SAVEPOINT auxiliary")
      await db.query(setup, setup.includes('$2') ? [converted,owner] : [converted]); await flush()
      const e=await deleteCollection(),p=await preview(e.id)
      assert.equal(p.supported,false); assert.ok(p.unsupported.includes(reason), JSON.stringify(p.unsupported)); assert.equal(p.planToken,null)
      await db.query("ROLLBACK TO SAVEPOINT auxiliary")
    }
    await db.query("SAVEPOINT appearance_auxiliary")
    await db.query("INSERT INTO public.binder_appearances(owner_user_id,design) VALUES($1,'{\"version\":1}')",[owner]); await flush()
    await deleteCollection(false)
    await db.query("UPDATE public.binder_appearances SET revision=revision+1,design=design||'{\"synthetic\":true}' WHERE owner_user_id=$1",[owner]); await flush()
    const appearancePlan=await preview((await event()).id)
    assert.equal(appearancePlan.supported,false); assert.ok(appearancePlan.unsupported.includes('unsupported_table:binder_appearances')); assert.equal(appearancePlan.planToken,null)
    await db.query("ROLLBACK TO SAVEPOINT appearance_auxiliary")
    await db.query("SAVEPOINT native_auxiliary")
    await db.query("INSERT INTO public.binder_history_state(binder_id) VALUES($1)",[native]); await flush()
    const nativeRefs=[]
    for (const id of ['synthetic/native-a','synthetic/native-b']) nativeRefs.push((await ref(id)).slot)
    const nativeDelete=await send([{kind:'deleteCollection',collectionId:native,replacementDefaultCollectionId:null,slots:nativeRefs}])
    const nativeUnsupported=await preview(nativeDelete.id)
    assert.equal(nativeUnsupported.supported,false); assert.ok(nativeUnsupported.unsupported.includes('search_history_cascade'))
    await db.query("ROLLBACK TO SAVEPOINT native_auxiliary")
    await db.query("SAVEPOINT occupied_position")
    const removed = await slots([{ kind: "remove", slots: [(await ref(slot(1))).slot] }])
    const oldPosition = removed.recovery_state.find((e: { table: string; id: string }) => e.table === 'binder_slots' && e.id === slot(1)).before.position
    await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position) VALUES('synthetic/occupied-position',$1,$2,$3)",[converted,owner,oldPosition])
    const occupied=await preview(removed.id)
    assert.equal(occupied.planToken,null); assert.ok(occupied.conflicts.some((c: { reason: string }) => c.reason==='previous_position_occupied'))
    await db.query("ROLLBACK TO SAVEPOINT occupied_position")
    await db.query("SAVEPOINT newer_partner")
    const deleted = await deleteCollection(), stale=await preview(deleted.id)
    await send([{ kind:'add',itemId:'synthetic/newer-partner-copy',identity:{kind:'card',cardId:'synthetic-converted-print'},grading:{...grade,grade:'8'},acquiredAt:null }],partner)
    await rejected(() => apply(deleted.id,stale.planToken), /recovery_plan_conflict/)
    const laterCopy=(await db.query("SELECT to_jsonb(i) r FROM public.inventory_items i WHERE id='synthetic/newer-partner-copy'")).rows[0].r
    const fresh=await preview(deleted.id)
    assert.deepEqual(fresh.conflicts,[])
    await apply(deleted.id,fresh.planToken)
    assert.deepEqual((await db.query("SELECT to_jsonb(i) r FROM public.inventory_items i WHERE id='synthetic/newer-partner-copy'")).rows[0].r,laterCopy)
    await db.query("ROLLBACK TO SAVEPOINT newer_partner")
    await db.query("SAVEPOINT private_asset")
    await db.query("UPDATE public.inventory_items SET grading=$2,version=version+1 WHERE id=$1",[copies[0],{...grade,label:{variant:null,assetIds:['synthetic-private-asset']}}]); await flush()
    const assetEvent=await deleteCollection(),assetPlan=await preview(assetEvent.id)
    assert.equal(assetPlan.supported,false); assert.ok(assetPlan.unsupported.includes('private_assets_unverifiable')); assert.equal(assetPlan.planToken,null)
    await db.query("ROLLBACK TO SAVEPOINT private_asset")
    // Runtime contexts and exact frozen JSON are insufficient without the protected current transaction.
    await db.query("SAVEPOINT forged_context")
    await deleteCollection()
    await db.query("INSERT INTO public.binders(id,owner_user_id,name) VALUES($1,$2,'Synthetic forged root')",[converted,owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority,conversion_version,converted_at,conversion_receipt) SELECT $1,$2,'slots',1,$3,$4",[converted,owner,preserved.provenance.converted_at,preserved.provenance.conversion_receipt]); await flush()
    for (const role of ["authenticated","service_role","holo_mcp","anon"]) {
      await db.query("SAVEPOINT role_spoof")
      await db.query(`SET LOCAL ROLE ${role}`)
      await db.query("SELECT set_config('request.jwt.claims',$1,true),set_config('holofolder.recovery','true',true),set_config('request.headers',$2,true)", [JSON.stringify({sub:owner,role}),JSON.stringify({'x-holo-audit-context':JSON.stringify({actor:{kind:'user',userId:owner},source:'app',operationId:'synthetic-forged',action:'recovery.apply'})})])
      await rejected(() => db.query("INSERT INTO public.pokemon_collection SELECT * FROM jsonb_populate_record(NULL::public.pokemon_collection,$1)",[preserved.originals[0]]), /binder_converted_requires_slot_commands|permission denied/)
      await rejected(() => db.query("UPDATE collection_audit_private.pending SET frozen_restore_rows=$1",[{[copies[0]]:preserved.originals[0]}]), /permission denied/)
      await rejected(() => db.query("SELECT collection_audit_private.recovery_preview_v1($1,$1,$2)",[owner,conversionEvent.id]), /permission denied/)
      await db.query("ROLLBACK TO SAVEPOINT role_spoof")
    }
    await db.query("ROLLBACK TO SAVEPOINT forged_context")
    assert.deepEqual(await sideEffects(),effectsBefore)
    await db.query("ROLLBACK")
  } finally { await db.query("ROLLBACK"); await db.end() }
})
