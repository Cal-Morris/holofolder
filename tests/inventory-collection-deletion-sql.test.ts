import { test } from "node:test"
import assert from "node:assert/strict"
import { privateRecoveryDatabase } from "./private-recovery-db"
import { readFileSync } from "node:fs"
import { parseInventoryCommand } from "../lib/domain/inventory-commands"

const socket = process.env.COLLECTION_DELETE_TEST_SOCKET
const owner = "03837800-0000-4000-8000-000000000001", partner = "03837800-0000-4000-8000-000000000002"
const stranger = "03837800-0000-4000-8000-000000000003"
const collection = "03837800-0000-4000-8000-000000000011", remaining = "03837800-0000-4000-8000-000000000012"
const intent = { source: "app", clientId: "synthetic-delete-client", batchId: null, clientOccurredAt: null }
const grading = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, subgrades: [], certificate: "000123", holder: null, label: { variant: null, assetIds: [] } }
const want = { card_id: "synthetic/delete-card", card_name: "Synthetic", added_at: "2020-01-01T00:00:00Z", wanted_by: [partner] }

// Requires a privately restored, 077-installed local database. Never installs 073-077 or accesses hosted state.
test("private atomic collection deletion: full Dex, capacity, recorder, replay and genuine 077 inverse", { skip: !socket, timeout: 600000 }, async () => {
  if (!socket) return
  const { Client } = await import("pg")
  const db = new Client(privateRecoveryDatabase(socket, { socket: "/Users/cal/.local/share/holofolder/issue383-atomic-local/socket", port: 55583, user: "atomic383_test" }))
  await db.connect()
  const flush = () => db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
  const rejected = async (run: () => Promise<unknown>, pattern: RegExp) => {
    await db.query("SAVEPOINT rejection")
    await assert.rejects(run(), pattern)
    await db.query("ROLLBACK TO SAVEPOINT rejection")
  }
  const execute = async (request: object, actor = partner) => (await db.query("SELECT public.inventory_command_v1($1,$2,$3,$4) r", [actor, owner, request, intent])).rows[0].r
  const snapshot = async () => (await db.query("SELECT public.inventory_evidence_v1($1,ARRAY(SELECT id FROM public.inventory_items WHERE owner_user_id=$1),ARRAY(SELECT id FROM public.binder_slots WHERE owner_user_id=$1),ARRAY[$2,$3]::uuid[]) s", [owner, collection, remaining])).rows[0].s
  try {
    if (socket.includes("issue396-cascade-local")) {
      await db.query(readFileSync(new URL("../scripts/077_safe_collection_recovery.sql", import.meta.url), "utf8"))
    }
    const protectedBodies = async () => (await db.query("SELECT p.oid::regprocedure::text name,md5(pg_get_functiondef(p.oid)) digest FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='collection_audit_private' ORDER BY 1")).rows
    const protectedBefore = await protectedBodies()
    if (!process.env.COLLECTION_DELETE_BASELINE) {
      const migration = readFileSync(new URL("../scripts/078_atomic_collection_deletion.sql", import.meta.url), "utf8")
      await db.query(migration); await db.query(migration)
    }
    assert.deepEqual(await protectedBodies(), protectedBefore, "076 recorder and 077 recovery definitions unchanged")
    const performanceSlice = ["issue396-perf-local", "issue396-converted-local", "issue396-cascade-local"].some(name => socket.includes(name))
    if (performanceSlice) {
      const migration = readFileSync(new URL("../scripts/079_bounded_collection_recovery.sql", import.meta.url), "utf8")
      const protectedDefinitions = await protectedBodies()
      await db.query(migration); await db.query(migration)
      assert.deepEqual((await protectedBodies()).filter(p => !p.name.includes("recovery_plan_v1")), protectedDefinitions.filter(p => !p.name.includes("recovery_plan_v1")), "079 changes only private plan computation, including no recorder or executor replacement")
    }
    if (socket.includes("issue396-converted-local") || socket.includes("issue396-cascade-local")) {
      const convertedMigration = readFileSync(new URL("../scripts/080_converted_content_recovery.sql", import.meta.url), "utf8")
      await db.query(convertedMigration); await db.query(convertedMigration)
    }
    const installed = (await db.query("SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) b")).rows[0].b
    assert.match(installed, /collection_audit_private.command_result/)
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      const permissions = (await db.query("SELECT n.nspname,p.proname,has_function_privilege($1,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='collection_audit_private' OR (n.nspname='public' AND p.proname IN ('inventory_command_v1','inventory_object_v1','inventory_id_v1','inventory_revision_v1','inventory_match_v1','inventory_item_ref_v1','inventory_evidence_v1','slot_command_v1','slot_page_v1','slot_check_ref_v1','slot_check_target_v1','slot_catalog_card_v1','slot_catalog_ids_v1','slot_saved_count_v1'))", [role])).rows
      assert.ok(permissions.length >= 14)
      assert.ok(permissions.every(p => !p.allowed), `${role}: private functions denied`)
    }
    for (const [count, allOwned, isDefault, caller] of [[1025, false, false, partner], [4096, true, true, owner]] as const) {
      const fixtureWant = { ...want, wanted_by: [allOwned ? owner : partner] }
      if (socket.includes("issue396-cascade-local")) {
        await db.query(readFileSync(new URL("../scripts/081_converted_cascade_recovery.sql", import.meta.url), "utf8"))
      }
      await db.query("BEGIN; SET LOCAL statement_timeout='300s'")
      await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, stranger])
      await db.query("UPDATE public.billing_configuration SET enforced=false")
      await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
      await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic deleted',$4),($2,$3,'Synthetic preserved',NOT $4)", [collection, remaining, owner, isDefault])
      await db.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)", [owner])
      await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$3,'slots'),($2,$3,'slots')", [collection, remaining, owner])
      await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic/delete-series'); INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic/delete-set','synthetic/delete-series'); INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES('synthetic/delete-card','synthetic/delete-series','synthetic/delete-set','1'); INSERT INTO public.tcg_card_dex_ids(card_id,dex_id) SELECT 'synthetic/delete-card',n FROM generate_series(1,1025) n")
      await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,wanted_cards,status,preset_origin) SELECT 'synthetic/delete-slot-'||n,$1,$2,n,CASE WHEN n%4=3 THEN NULL ELSE jsonb_build_object('kind','pokemon','pokemonId',n%1025+1) END,CASE WHEN n%4=2 THEN $4::jsonb ELSE '[]'::jsonb END,CASE WHEN $5 OR n%4=0 THEN 'collected' END,jsonb_build_object('synthetic',n) FROM generate_series(0,$3::int-1) n", [collection, owner, count, JSON.stringify([fixtureWant]), allOwned])
      await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,wanted_cards,preset_origin) VALUES('synthetic/remaining-slot',$1,$2,0,'{\"kind\":\"pokemon\",\"pokemonId\":25}',$3,'{\"synthetic\":true}')", [remaining, owner, JSON.stringify([fixtureWant])])
      await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at,legacy_source) SELECT 'synthetic/delete-copy-'||n,$1,'{\"kind\":\"card\",\"cardId\":\"synthetic/delete-card\"}',$3,'2020-01-01',jsonb_build_object('synthetic',n) FROM generate_series(0,$2::int-1) n WHERE $4 OR n%4=0", [owner, count, grading, allOwned])
      await db.query("INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id) SELECT i.id,$1,$2,replace(i.id,'copy','slot') FROM public.inventory_items i WHERE owner_user_id=$1", [owner, collection])
      await flush()
      const before = await snapshot()
      const slots = (await db.query("SELECT s.id,s.version::int,p.inventory_item_id AS \"inventoryItemId\",i.version::int AS \"itemVersion\",p.version::int AS \"placementVersion\" FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.collection_id=$1 ORDER BY s.position", [collection])).rows
      const collections = (await db.query("SELECT collection_id AS \"collectionId\",version::int,layout_revision::int AS \"layoutRevision\" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id", [owner])).rows
      const request = { operationId: `synthetic-delete-${count}`, inventoryRevision: 0, collections,
        commands: [{ kind: "deleteCollection", collectionId: collection, replacementDefaultCollectionId: isDefault ? remaining : null, slots }] }
      // Baseline mode reaches SQL before the parser change, demonstrating the actual 075 gate.
      if (!process.env.COLLECTION_DELETE_BASELINE) assert.deepEqual(parseInventoryCommand(request), request)
      await rejected(() => execute(request, stranger), /access_denied/)
      const partial = structuredClone(request); partial.commands[0].slots.pop()
      await rejected(() => execute(partial, caller), /slot_conflict/)
      const stale = structuredClone(request); stale.commands[0].slots[0].version++
      await rejected(() => execute(stale, caller), /slot_conflict/)
      const staleItem = structuredClone(request); staleItem.commands[0].slots[0].itemVersion!++
      await rejected(() => execute(staleItem, caller), /placement_conflict|item_conflict/)
      const stalePlacement = structuredClone(request); stalePlacement.commands[0].slots[0].placementVersion!++
      await rejected(() => execute(stalePlacement, caller), /placement_conflict/)
      const repeated = structuredClone(request); repeated.commands[0].slots[1] = repeated.commands[0].slots[0]
      await rejected(() => execute(repeated, caller), /repeated_entity/)
      const staleRoot = { ...request, inventoryRevision: 99 }
      await rejected(() => execute(staleRoot, caller), /revision_conflict/)
      const staleLayout = structuredClone(request); staleLayout.collections[0].layoutRevision++
      await rejected(() => execute(staleLayout, caller), /collection_conflict/)
      await rejected(() => execute({ ...request, commands: [{ kind: "removeSlots", slots: slots.slice(0,257).map(slot => ({ collectionId: collection, slot })) }] }, caller), /invalid_inventory_command|batch_too_large/)
      if (isDefault) await rejected(() => execute({ ...request, commands: [{ ...request.commands[0], replacementDefaultCollectionId: null }] }, caller), /default_replacement_required/)
      // Even a valid mutation/ledger must roll back when the real recorder cannot insert its event.
      await db.query("SAVEPOINT recorder_failure")
      await db.query("CREATE FUNCTION collection_audit_private.synthetic_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_audit_failure'; END $$; CREATE TRIGGER synthetic_fail_delete BEFORE INSERT ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION collection_audit_private.synthetic_fail_delete()")
      await assert.rejects((async () => { await execute(request, caller); await flush() })(), /synthetic_audit_failure/)
      await db.query("ROLLBACK TO SAVEPOINT recorder_failure")
      assert.deepEqual(await snapshot(), before)
      assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1", [caller])).rows[0].n, 0)
      const result = await execute(request, caller); await flush()
      assert.deepEqual(await execute(request, caller), result); await flush()
      const after = await snapshot()
      assert.deepEqual(after.items, before.items, "IDs, duplicate certificates, acquisition and provenance unchanged")
      assert.deepEqual(after.placements, [])
      assert.deepEqual(after.slots, before.slots.filter((s: { collection_id: string }) => s.collection_id === remaining))
      assert.equal((await db.query("SELECT count(*)::int n FROM public.binders WHERE id=$1", [collection])).rows[0].n, 0)
      assert.equal((await db.query("SELECT is_default FROM public.binders WHERE id=$1", [remaining])).rows[0].is_default, true)
      const events = (await db.query("SELECT * FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, request.operationId])).rows
      assert.equal(events.length, 1)
      const event = events[0]
      assert.equal(event.actor_user_id, caller); assert.equal(event.source, "app"); assert.equal(event.action, "inventory.deleteCollection")
      assert.equal(event.affected_entities.slotIds.length, count)
      assert.equal(event.affected_entities.inventoryItemIds.length, before.items.length)
      assert.ok(event.recovery_state.length <= 16384)
      await rejected(() => db.query("UPDATE public.collection_activity SET source='mcp' WHERE id=$1", [event.id]), /audit_immutable/)
      await rejected(() => execute({ ...request, commands: [{ ...request.commands[0], slots: slots.slice(1) }] }, caller), /idempotency_conflict/)
      if (allOwned) await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
      if (performanceSlice) {
        // Genuine later history, retained in full. These unrelated edits must coexist with recovery.
        for (let n = 0; n < 512; n++) {
          await db.query("UPDATE public.binder_slots SET version=version+1 WHERE id='synthetic/remaining-slot'")
          await flush()
        }
        if (process.env.COLLECTION_RECOVERY_COMPARE === "1") {
          const rawPlan = () => db.query("SELECT collection_audit_private.recovery_plan_v1($1,$2,$3,'{}') p", [caller, owner, event.id])
          const candidateStarted = performance.now()
          const candidate = (await rawPlan()).rows[0].p
          const candidatePlanMs = performance.now() - candidateStarted
          await db.query("SAVEPOINT compare_plan")
          const original = readFileSync(new URL("../scripts/077_safe_collection_recovery.sql", import.meta.url), "utf8")
          await db.query(original.slice(original.indexOf("CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v1"), original.indexOf("CREATE OR REPLACE FUNCTION collection_audit_private.recovery_preview_v1")))
          const baselineStarted = performance.now()
          const baseline = (await rawPlan()).rows[0].p
          const baselinePlanMs = performance.now() - baselineStarted
          console.info(JSON.stringify({ syntheticSlots: count, laterEvents: 512, candidatePlanMs, baselinePlanMs }))
          assert.deepEqual(candidate, baseline, "exact original inverse, conflict ordering, dependencies and token material")
          await db.query("ROLLBACK TO SAVEPOINT compare_plan")
        }
        // 074/075 already specify a 10s intent budget. Enforce it at invocation, never
        // rely on a function-local setting to cancel a statement or truncate its history scan.
        await db.query("SET LOCAL statement_timeout='10s'")
      }
      const previewStarted = performance.now()
      const preview = (await db.query("SELECT collection_audit_private.recovery_preview_v1($1,$2,$3,'{}') p", [caller, owner, event.id])).rows[0].p
      const previewMs = performance.now() - previewStarted
      assert.equal(preview.supported, true); assert.deepEqual(preview.conflicts, [])
      const recovery = { eventId: event.id, planVersion: 1, planToken: preview.planToken, operationId: `synthetic-recover-${count}`, restoreUnassignedItemIds: [], confirmed: true }
      if (performanceSlice) {
        const beforeDeadline = await snapshot()
        await db.query("SET LOCAL statement_timeout='1ms'")
        await rejected(() => db.query("SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4)", [caller, owner, recovery, intent]), /statement timeout/)
        await db.query("SET LOCAL statement_timeout='10s'")
        assert.deepEqual(await snapshot(), beforeDeadline, "deadline failure leaves the whole intent unapplied")
        assert.equal((await db.query("SELECT count(*)::int n FROM public.developer_idempotency WHERE actor_id=$1 AND request_key=$2", [caller, recovery.operationId])).rows[0].n, 0)
      }
      const recoveryStarted = performance.now()
      const recovered = (await db.query("SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r", [caller, owner, recovery, intent])).rows[0].r
      await flush()
      const recoveryWithFlushMs = performance.now() - recoveryStarted
      if (performanceSlice) await db.query("SET LOCAL statement_timeout='300s'")
      const restored = await snapshot()
      assert.deepEqual(restored.items, before.items)
      assert.equal(restored.slots.length, before.slots.length)
      assert.equal(restored.placements.length, before.placements.length)
      for (const s of restored.slots) {
        const original = before.slots.find((v: { id: string }) => v.id === s.id)
        const { version: _v, created_at: _c, updated_at: _u, ...data } = s
        const { version: _ov, created_at: _oc, updated_at: _ou, ...originalData } = original
        assert.deepEqual(data, originalData)
      }
      if (performanceSlice) {
        await rejected(async () => {
          await db.query("UPDATE public.binder_slots SET status=NULL WHERE id='synthetic/delete-slot-0'")
          await flush()
        }, /Slot ownership requires exactly one placement/)
        await rejected(async () => {
          await db.query("UPDATE public.binder_slots SET status='collected' WHERE id='synthetic/remaining-slot'")
          await flush()
        }, /Slot ownership requires exactly one placement/)
      }
      const inverseEvent = (await db.query("SELECT recovery_of_event_id,actor_user_id FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, recovery.operationId])).rows[0]
      assert.equal(inverseEvent.recovery_of_event_id, event.id); assert.equal(inverseEvent.actor_user_id, caller)
      assert.deepEqual((await db.query("SELECT collection_audit_private.recovery_apply_v1($1,$2,$3,$4) r", [caller, owner, recovery, intent])).rows[0].r, recovered)
      // Bounded, rolled-back mutation plan on the same restored fixture, including genuine recorder flush.
      const updatedRequest = structuredClone(request); updatedRequest.operationId += "-explain"
      updatedRequest.inventoryRevision = Number((await db.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [owner])).rows[0].inventory_revision)
      updatedRequest.collections = (await db.query("SELECT collection_id AS \"collectionId\",version::int,layout_revision::int AS \"layoutRevision\" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id", [owner])).rows
      updatedRequest.commands[0].slots.forEach(s => { s.version++; if (s.inventoryItemId) s.placementVersion!++ })
      await db.query("SAVEPOINT explain_delete")
      const plan = (await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.inventory_command_v1($1,$2,$3,$4)", [caller, owner, updatedRequest, intent])).rows[0]["QUERY PLAN"][0]
      await flush()
      console.info(JSON.stringify({ syntheticSlots: count, owned: before.items.length, requestBytes: JSON.stringify(request).length, resultBytes: JSON.stringify(result).length, recoveryEntities: event.recovery_state.length, previewMs, recoveryWithFlushMs, localRolledBackExplainMs: plan["Execution Time"] }))
      await db.query("ROLLBACK TO SAVEPOINT explain_delete")
      // Oversized *valid* grading is not silently truncated or described as supported.
      if (count === 1025) {
        await db.query("SAVEPOINT oversized_result")
        const largeGrade = { ...grading, subgrades: Array.from({ length: 20 }, () => ({ name: "界".repeat(500), grade: "語".repeat(500) })) }
        await db.query("UPDATE public.inventory_items SET grading=$1 WHERE owner_user_id=$2", [largeGrade, owner])
        await flush()
        // Recovering does not modify item versions; the fresh command still has exact current predicates.
        await rejected(() => execute({ ...updatedRequest, operationId: "synthetic-delete-oversized" }, caller), /result_too_large/)
        await db.query("ROLLBACK TO SAVEPOINT oversized_result")
      }
      await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
      await rejected(() => execute(request, partner), /access_denied/)
      // Account removal uses the actual immutable-history privacy exception, no fixture TRUNCATE.
      await db.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[owner, partner, stranger]])
      assert.equal((await db.query("SELECT count(*)::int n FROM public.collection_activity WHERE owner_user_id=$1", [owner])).rows[0].n, 0)
      await db.query("ROLLBACK")
    }
  } finally { await db.query("ROLLBACK"); await db.end() }
})

test("private full 1025-target Dex and empty native collection deletion, cross-owner and capacity refusal", { skip: !socket, timeout: 30000 }, async () => {
  if (!socket) return
  const { Client } = await import("pg")
  const db = new Client(privateRecoveryDatabase(socket, { socket: "/Users/cal/.local/share/holofolder/issue383-atomic-local/socket", port: 55583, user: "atomic383_test" }))
  await db.connect()
  const owner = "03837800-0000-4000-8000-000000000101", stranger = "03837800-0000-4000-8000-000000000103"
  const collection = "03837800-0000-4000-8000-000000000111", remaining = "03837800-0000-4000-8000-000000000112"
  const foreign = "03837800-0000-4000-8000-000000000113"
  try {
    await db.query("BEGIN; SET LOCAL statement_timeout='20s'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [owner, stranger])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic Dex',false),($2,$3,'Synthetic native default',true),($4,$5,'Synthetic foreign default',true)", [collection, remaining, owner, foreign, stranger])
    await db.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1),($2)", [owner, stranger])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$3,'slots'),($2,$3,'slots'),($4,$5,'slots')", [collection, remaining, owner, foreign, stranger])
    await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target) SELECT 'synthetic/full-dex-'||n,$1,$2,n,jsonb_build_object('kind','pokemon','pokemonId',n) FROM generate_series(1,1025) n", [collection, owner])
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
    const slots = (await db.query("SELECT id,version::int,null AS \"inventoryItemId\",null AS \"itemVersion\",null AS \"placementVersion\" FROM public.binder_slots WHERE collection_id=$1 ORDER BY position", [collection])).rows
    const request = { operationId: "synthetic-full-dex-forward", inventoryRevision: 0, collections: [{ collectionId: collection, version: 0, layoutRevision: 0 }], commands: [{ kind: "deleteCollection", collectionId: collection, slots, replacementDefaultCollectionId: null }] }
    const execute = (value: object) => db.query("SELECT public.inventory_command_v1($1,$1,$2,$3)", [owner, value, intent])
    const rejected = async (value: object, pattern: RegExp) => {
      await db.query("SAVEPOINT rejected")
      await assert.rejects(execute(value), pattern)
      await db.query("ROLLBACK TO SAVEPOINT rejected")
    }
    await rejected({ ...request, collections: [...request.collections, { collectionId: foreign, version: 0, layoutRevision: 0 }] }, /access_denied/)
    await rejected({ ...request, commands: [{ ...request.commands[0], slots: Array.from({ length: 4097 }, (_, n) => slots[n % slots.length]) }] }, /collection_capacity_exceeded/)
    await rejected({ ...request, commands: [request.commands[0], request.commands[0]] }, /batch_too_large/)
    assert.deepEqual(parseInventoryCommand(request), request)
    await execute(request)
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
    const event = (await db.query("SELECT actor_user_id,affected_entities FROM public.collection_activity WHERE owner_user_id=$1 AND operation_id=$2", [owner, request.operationId])).rows[0]
    assert.equal(event.actor_user_id, owner)
    assert.equal(event.affected_entities.slotIds.length, 1025)
    assert.deepEqual(event.affected_entities.inventoryItemIds, [])
    // A genuinely empty, nondefault native collection uses the same intent with zero slot predicates.
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic empty',false)", [collection, owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [collection, owner])
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED")
    await execute({ ...request, operationId: "synthetic-empty-forward", inventoryRevision: 1, commands: [{ ...request.commands[0], slots: [] }] })
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK")
  } finally { await db.query("ROLLBACK"); await db.end() }
})
