import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const socket = process.env.INVENTORY_COMMAND_TEST_SOCKET
const owner = "03830000-0000-4000-8000-000000000001", partner = "03830000-0000-4000-8000-000000000002"
const other = "03830000-0000-4000-8000-000000000003"
const binder = "03830000-0000-4000-8000-000000000011", slab = "03830000-0000-4000-8000-000000000012"
const foreign = "03830000-0000-4000-8000-000000000013", legacy = "03830000-0000-4000-8000-000000000014"
const source: { source: string; clientId: string | null; batchId: string | null; clientOccurredAt: string | null } = { source: "app", clientId: null, batchId: null, clientOccurredAt: null }
const identity = { kind: "card", cardId: "synthetic-inventory-card", language: "en", finish: "holo" }
const grading = { provider: { kind: "known", id: "psa" }, grade: "10", scale: null, designation: null, subgrades: [], certificate: "000123", holder: null, label: { variant: null, assetIds: [] } }
const want = { card_id: identity.cardId, card_name: "Synthetic", added_at: "2020-01-01T00:00:00Z", card_language: "en", card_finish: "holo" }

test("private inventory SQL: copies, selection, cross-storage, selected wants, rollback, deletion and replay", { skip: !socket }, async () => {
  if (!socket) return
  assert.equal(socket, "/Users/cal/.local/share/holofolder/issue383-local/socket")
  const { Client } = await import("pg")
  const db = new Client({ host: socket, port: 55483, user: "issue383_test", database: "postgres" })
  await db.connect()
  const migration = readFileSync(new URL("../scripts/075_inventory_commands.sql", import.meta.url), "utf8")
  try {
    await db.query(migration); await db.query(migration)
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, other])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$4,'Synthetic binder',true),($2,$4,'Synthetic slab',false),($3,$5,'Synthetic foreign',true),($6,$4,'Synthetic legacy',false)", [binder, slab, foreign, owner, other, legacy])
    await db.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1),($2)", [owner, other])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$4,'slots'),($2,$4,'slots'),($3,$5,'slots')", [binder, slab, foreign, owner, other])
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-inventory-series')")
    await db.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-inventory-set','synthetic-inventory-series')")
    await db.query("INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,external_ids_json) VALUES($1,'synthetic-inventory-series','synthetic-inventory-set','1','{\"catalog\":{\"canonicalId\":\"synthetic-canonical\",\"aliasIds\":[\"synthetic-alias\"]}}')", [identity.cardId])
    await db.query("INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,wanted_cards) VALUES('inv-a',$1,$3,0,$4),('inv-b',$2,$3,0,$4),('inv-c',$2,$3,1,'[]'),('inv-foreign',$5,$6,0,'[]')", [binder, slab, owner, JSON.stringify([want, want]), foreign, other])
    const rejected = async (action: () => Promise<unknown>, pattern: RegExp) => {
      await db.query("SAVEPOINT rejected")
      await assert.rejects(action(), pattern)
      await db.query("ROLLBACK TO SAVEPOINT rejected")
    }
    const ref = async (id: string) => {
      const s = (await db.query("SELECT s.*,p.inventory_item_id,p.version placement_version,i.version item_version FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id WHERE s.id=$1", [id])).rows[0]
      return { collectionId: s.collection_id, slot: { id, version: Number(s.version), inventoryItemId: s.inventory_item_id ?? null, itemVersion: s.item_version == null ? null : Number(s.item_version), placementVersion: s.placement_version == null ? null : Number(s.placement_version) } }
    }
    const item = async (id: string) => {
      const i = (await db.query("SELECT i.*,p.slot_id FROM public.inventory_items i LEFT JOIN public.inventory_placements p ON p.inventory_item_id=i.id WHERE i.id=$1", [id])).rows[0]
      return { itemId: id, itemVersion: Number(i.version), placement: i.slot_id ? await ref(i.slot_id) : null }
    }
    const request = async (commands: unknown[], operationId: string, ids = [binder, slab]) => ({ operationId,
      inventoryRevision: Number((await db.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [owner])).rows[0].inventory_revision),
      collections: (await db.query("SELECT collection_id AS \"collectionId\",version::int,layout_revision::int AS \"layoutRevision\" FROM public.storage_collection_state WHERE collection_id=ANY($1::uuid[]) ORDER BY collection_id", [ids])).rows,
      commands })
    const execute = async (input: object, actor = owner) => (await db.query("SELECT public.inventory_command_v1($1,$2,$3,$4) r", [actor, owner, input, source])).rows[0].r
    const send = async (commands: unknown[], id: string, actor = owner) => execute(await request(commands, id), actor)
    const add = (id: string, grade: object | null = null) => ({ kind: "add", itemId: id, identity, grading: grade, acquiredAt: "2020-01-01T00:00:00Z" })
    await send([add("copy-a"), add("copy-b")], "synthetic-add-001")
    const plan = (await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT i.id FROM public.inventory_items i WHERE i.owner_user_id=$1 AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=i.id) ORDER BY i.id COLLATE \"C\" LIMIT 1", [owner])).rows[0]["QUERY PLAN"][0]
    assert.equal(plan.Plan["Actual Rows"], 1)
    console.info(`Synthetic local Unassigned lookup, two copies, rolled back: ${plan["Execution Time"]} ms`)
    const select = (destination: unknown, selection: object, occupied = "cancel", fulfillWant: unknown = null) => ({ kind: "assign", destination, selection, occupied, fulfillWant })
    const catalog = { kind: "catalog", identity, newItemId: "must-not-create" }
    const assignInput = await request([select(await ref("inv-a"), catalog, "cancel", { index: 0, expected: want })], "synthetic-assign-001")
    const assigned = await execute(assignInput, partner)
    assert.equal(assigned.selectedItemIds[0], "copy-a", "indistinguishable copies use stable ID")
    assert.deepEqual(assigned.acquiredItemIds, [], "reuse is not acquisition")
    assert.deepEqual(await execute(assignInput, partner), assigned, "replay ignores old revisions")
    await rejected(async () => execute({ ...assignInput, commands: [] }, partner), /invalid_inventory_command/)
    await rejected(async () => execute({ ...assignInput, commands: [select(await ref("inv-b"), catalog)] }, partner), /idempotency_conflict/)
    assert.equal((await db.query("SELECT jsonb_array_length(wanted_cards) n FROM public.binder_slots WHERE id='inv-a'")).rows[0].n, 1)
    assert.equal((await db.query("SELECT jsonb_array_length(wanted_cards) n FROM public.binder_slots WHERE id='inv-b'")).rows[0].n, 2)
    const existing = { kind: "existing", inventoryItemId: "copy-a", itemVersion: 0 }
    await rejected(async () => send([select(await ref("inv-b"), existing)], "synthetic-no-steal"), /placement_conflict/)
    await send([select(await ref("inv-b"), catalog)], "synthetic-assign-002")
    const move = async (occupied: string) => ({ kind: "move", item: await item("copy-a"), destination: await ref("inv-b"), occupied, fulfillWant: null })
    await rejected(async () => send([await move("cancel")], "synthetic-cancel"), /destination_occupied/)
    await db.query("UPDATE public.binder_slots SET target='{\"kind\":\"pokemon\",\"pokemonId\":25}' WHERE id='inv-a'")
    await rejected(async () => send([await move("swap")], "synthetic-bad-swap"), /target_mismatch/)
    await db.query("UPDATE public.binder_slots SET target=NULL WHERE id='inv-a'")
    const swapped = await send([await move("swap")], "synthetic-swap")
    assert.deepEqual(swapped.acquiredItemIds, [])
    assert.equal((await item("copy-a")).placement?.slot.id, "inv-b")
    assert.equal((await item("copy-b")).placement?.slot.id, "inv-a")
    await send([{ kind: "move", item: await item("copy-a"), destination: await ref("inv-a"), occupied: "unassign", fulfillWant: null }], "synthetic-displace")
    assert.equal((await item("copy-b")).placement, null)
    const before = await item("copy-a")
    const stale = { ...before, itemVersion: 42 }
    await rejected(async () => send([{ kind: "unassign", item: stale }], "synthetic-stale-item"), /item_conflict/)
    await rejected(async () => send([{ kind: "unassign", item: { ...before, placement: { ...before.placement, slot: { ...before.placement!.slot, placementVersion: 42 } } } }], "synthetic-stale-place"), /placement_conflict/)
    const foreignRef = await ref("inv-foreign")
    await rejected(async () => execute(await request([{ kind: "unassign", item: before }, select(foreignRef, { kind: "existing", inventoryItemId: "copy-b", itemVersion: 0 })], "synthetic-mixed", [binder, slab, foreign])), /access_denied/)
    assert.deepEqual(await item("copy-a"), before, "mixed owner batch has no partial effects")
    await rejected(async () => send([{ kind: "unassign", item: before }, select(await ref("inv-c"), { kind: "existing", inventoryItemId: "missing", itemVersion: 0 })], "synthetic-rollback"), /item_conflict/)
    assert.deepEqual(await item("copy-a"), before)
    const unassigned = await send([{ kind: "unassign", item: before }], "synthetic-unassign")
    assert.deepEqual(unassigned.acquiredItemIds, [])
    assert.equal((await item("copy-a")).placement, null)
    // Distinct grading groups require a picker choice. Explicit graded selection never clones.
    await send([{ kind: "edit", item: await item("copy-b"), grading }], "synthetic-grade")
    await rejected(async () => send([select(await ref("inv-a"), catalog)], "synthetic-choose-grade"), /copy_choice_required/)
    await send([select(await ref("inv-a"), { kind: "existing", inventoryItemId: "copy-b", itemVersion: 1 })], "synthetic-explicit-grade")
    await rejected(async () => send([select(await ref("inv-b"), { kind: "existing", inventoryItemId: "copy-b", itemVersion: 1 })], "synthetic-grade-assigned"), /placement_conflict/)
    const staleSlot = await ref("inv-c")
    await rejected(async () => send([select({ ...staleSlot, slot: { ...staleSlot.slot, version: 99 } }, { kind: "existing", inventoryItemId: "copy-a", itemVersion: 0 })], "synthetic-slot-stale"), /slot_conflict/)
    const badWant = { index: 0, expected: { ...want, card_name: "Changed" } }
    await rejected(async () => send([select(await ref("inv-b"), { kind: "existing", inventoryItemId: "copy-a", itemVersion: 0 }, "cancel", badWant)], "synthetic-want-stale"), /want_conflict/)
    const staleCollection = await request([{ kind: "unassign", item: await item("copy-b") }], "synthetic-layout-stale")
    staleCollection.collections[0].layoutRevision = 99
    await rejected(async () => execute(staleCollection), /collection_conflict/)
    await send([add("copy-same-cert", grading)], "synthetic-distinct-certificate")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE grading->>'certificate'='000123'")).rows[0].n, 2, "certificate is not copy identity")
    const noOpInput = await request([{ kind: "edit", item: await item("copy-b"), grading }], "synthetic-grade-noop")
    const noOp = await execute(noOpInput)
    assert.equal(noOp.changed, false)
    assert.equal(noOp.inventoryRevision, noOpInput.inventoryRevision)
    assert.deepEqual(noOp.acquiredItemIds, [])
    const removeSlots = await send([{ kind: "removeSlots", slots: [await ref("inv-a")] }], "synthetic-remove-slots")
    assert.deepEqual(removeSlots.acquiredItemIds, [])
    assert.equal((await item("copy-b")).placement, null)
    await send([select(await ref("inv-b"), { kind: "existing", inventoryItemId: "copy-b", itemVersion: 1 })], "synthetic-reassign-for-delete")
    // Free placement tolerates missing persisted catalog. New catalog creation never does.
    await db.query("DELETE FROM public.tcg_cards WHERE id=$1", [identity.cardId])
    await send([{ kind: "move", item: await item("copy-b"), destination: await ref("inv-c"), occupied: "cancel", fulfillWant: null }], "synthetic-no-catalog-free")
    await rejected(async () => send([add("unknown-new")], "synthetic-no-catalog-new"), /catalog_unavailable/)
    // Storage deletion releases ownership and does not touch another collection's wants.
    await send([select(await ref("inv-b"), { kind: "existing", inventoryItemId: "copy-a", itemVersion: 0 })], "synthetic-free-assignment-no-catalog")
    const deleteInput = await request([{ kind: "deleteCollection", collectionId: slab, replacementDefaultCollectionId: null, slots: [(await ref("inv-b")).slot, (await ref("inv-c")).slot] }], "synthetic-delete-storage")
    const remove = await execute(deleteInput)
    assert.deepEqual(await execute(deleteInput), remove, "deleted collection replay remains available after access check")
    assert.equal((await item("copy-b")).placement, null)
    assert.equal(remove.evidence[0].before.items.find((i: { id: string }) => i.id === "copy-b").grading.certificate, "000123")
    assert.equal((await db.query("SELECT acquired_at::text FROM public.inventory_items WHERE id='copy-b'")).rows[0].acquired_at.startsWith("2020-01-01"), true)
    const removeInput = await request([{ kind: "removeOwned", item: await item("copy-b") }], "synthetic-remove-owned", [binder])
    const removal = await execute(removeInput)
    assert.deepEqual(await execute(removeInput), removal, "owned-copy removal replays without recreating identity")
    assert.equal(removal.evidence[0].before.items[0].id, "copy-b")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='copy-b'")).rows[0].n, 0)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='copy-a'")).rows[0].n, 1)
    const replacement = "03830000-0000-4000-8000-000000000015"
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$2,'Synthetic replacement',false)", [replacement, owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [replacement, owner])
    await rejected(async () => execute(await request([{ kind: "deleteCollection", collectionId: binder, replacementDefaultCollectionId: null, slots: [] }], "synthetic-default-denied", [binder, replacement])), /default_replacement_required/)
    await execute(await request([{ kind: "deleteCollection", collectionId: binder, replacementDefaultCollectionId: replacement, slots: [] }], "synthetic-default-replacement", [binder, replacement]))
    assert.equal((await db.query("SELECT is_default FROM public.binders WHERE id=$1", [replacement])).rows[0].is_default, true)
    await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
    await rejected(async () => execute(assignInput, partner), /access_denied/)
    const prototypes = ["inventory_object_v1(jsonb,text[])", "inventory_id_v1(jsonb)", "inventory_revision_v1(jsonb)", "inventory_match_v1(jsonb,jsonb)",
      "inventory_item_ref_v1(uuid,jsonb)", "inventory_evidence_v1(uuid,text[],text[],uuid[])", "inventory_command_v1(uuid,uuid,jsonb,jsonb)",
      "slot_command_v1(uuid,uuid,jsonb,jsonb)", "slot_page_v1(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint)"]
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      for (const prototype of prototypes) assert.equal((await db.query("SELECT has_function_privilege($1,$2,'execute') allowed", [role, `public.${prototype}`])).rows[0].allowed, false)
    }
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK")
  } finally { await db.query("ROLLBACK"); await db.end() }
})

test("private inventory SQL: same-copy races, billing concurrency, unlinked replay and intent", { skip: !socket }, async () => {
  if (!socket) return
  assert.equal(socket, "/Users/cal/.local/share/holofolder/issue383-local/socket")
  const { Client } = await import("pg")
  const connection = { host: socket, port: 55483, user: "issue383_test", database: "postgres" }
  const a = new Client(connection), b = new Client(connection)
  await a.connect(); await b.connect()
  const raceOwner = "03830000-0000-4000-8000-000000000101", racePartner = "03830000-0000-4000-8000-000000000102"
  const first = "03830000-0000-4000-8000-000000000111", second = "03830000-0000-4000-8000-000000000112", old = "03830000-0000-4000-8000-000000000113"
  let config: { enforced: boolean; free_card_limit: number } | undefined
  const request = async (commands: unknown[], id: string) => ({ operationId: id,
    inventoryRevision: Number((await b.query("SELECT inventory_revision FROM public.inventory_owner_state WHERE owner_user_id=$1", [raceOwner])).rows[0].inventory_revision),
    collections: (await b.query("SELECT collection_id AS \"collectionId\",version::int,layout_revision::int AS \"layoutRevision\" FROM public.storage_collection_state WHERE owner_user_id=$1 ORDER BY collection_id", [raceOwner])).rows, commands })
  const exec = async (db: typeof a, input: object, actor = raceOwner, intent = source) => (await db.query("SELECT public.inventory_command_v1($1,$2,$3,$4) r", [actor, raceOwner, input, intent])).rows[0].r
  const destination = (id: string, collectionId: string) => ({ collectionId, slot: { id, version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null } })
  const assign = (id: string, collectionId: string) => ({ kind: "assign", destination: destination(id, collectionId), selection: { kind: "existing", inventoryItemId: "race-copy", itemVersion: 0 }, occupied: "cancel", fulfillWant: null })
  const add = (id: string) => ({ kind: "add", itemId: id, identity, grading: null, acquiredAt: null })
  try {
    config = (await a.query("SELECT enforced,free_card_limit FROM public.billing_configuration WHERE id")).rows[0]
    await a.query("BEGIN; UPDATE public.billing_configuration SET enforced=false")
    await a.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01'),($2,'2020-01-01')", [raceOwner, racePartner])
    await a.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$4,'Synthetic first',true),($2,$4,'Synthetic second',false),($3,$4,'Synthetic old',false)", [first, second, old, raceOwner])
    await a.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)", [raceOwner])
    await a.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$3,'slots'),($2,$3,'slots')", [first, second, raceOwner])
    await a.query("INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES('race-slot-a',$3,$1,0),('race-slot-b',$3,$2,0)", [first, second, raceOwner])
    await a.query("INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES('race-copy',$1,$2)", [raceOwner, identity])
    await a.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [raceOwner, racePartner])
    await a.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-race-series')")
    await a.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-race-set','synthetic-race-series')")
    await a.query("INSERT INTO public.tcg_cards(id,series_id,set_id,local_id) VALUES($1,'synthetic-race-series','synthetic-race-set','1')", [identity.cardId])
    await a.query("COMMIT")
    await b.query("SET lock_timeout='150ms'; SET statement_timeout='5s'")
    const inputA = await request([assign("race-slot-a", first)], "synthetic-copy-race-a")
    const inputB = await request([assign("race-slot-b", second)], "synthetic-copy-race-b")
    const activityBefore = Number((await a.query("SELECT count(*) n FROM public.collection_activity WHERE owner_user_id=$1", [raceOwner])).rows[0].n)
    await a.query("BEGIN")
    const result = await exec(a, inputA, racePartner, { ...source, batchId: "synthetic-offline-batch", clientOccurredAt: "2020-01-01T00:00:00Z" })
    assert.equal(result.context.actor.userId, racePartner)
    assert.equal(result.context.clientOccurredAt, "2020-01-01T00:00:00Z")
    // Use an external statement deadline: the function itself sets lock_timeout=3s.
    await b.query("SET statement_timeout='200ms'")
    await assert.rejects(exec(b, inputB), /statement timeout/)
    await assert.rejects(b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [raceOwner]), /lock timeout/)
    await a.query("COMMIT")
    await b.query("SET statement_timeout='5s'")
    await assert.rejects(exec(b, inputB), /revision_conflict/)
    await assert.rejects(exec(b, await request(inputB.commands, "synthetic-explicit-retry")), /placement_conflict/)
    assert.equal((await a.query("SELECT count(*)::int n FROM public.inventory_items WHERE owner_user_id=$1", [raceOwner])).rows[0].n, 1)
    assert.equal((await a.query("SELECT count(*)::int n FROM public.inventory_placements WHERE inventory_item_id='race-copy'")).rows[0].n, 1)
    assert.equal(Number((await a.query("SELECT count(*) n FROM public.collection_activity WHERE owner_user_id=$1", [raceOwner])).rows[0].n), activityBefore, "staging creates no fake activity")
    await b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [raceOwner])
    await assert.rejects(exec(b, inputA, racePartner, { ...source, batchId: "synthetic-offline-batch", clientOccurredAt: "2020-01-01T00:00:00Z" }), /access_denied/)
    // Generic selection never steals the assigned copy, it creates a genuinely new RAW copy.
    const generic = await request([{ ...assign("race-slot-b", second), selection: { kind: "catalog", identity, newItemId: "race-new-copy" } }], "synthetic-generic-new")
    const created = await exec(b, generic)
    assert.deepEqual(created.acquiredItemIds, ["race-new-copy"])
    assert.equal((await a.query("SELECT grading FROM public.inventory_items WHERE id='race-new-copy'")).rows[0].grading, null)
    assert.deepEqual(await exec(b, generic), created)
    // New ownership and legacy growth share lock 4701 and the aggregate allowance.
    await a.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=3")
    const growth = await request([add("race-third")], "synthetic-billing-inventory")
    await a.query("BEGIN")
    await exec(a, growth)
    await b.query("SET statement_timeout='200ms'")
    await assert.rejects(b.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic','collected')", [raceOwner, old]), /lock timeout|statement timeout/)
    await a.query("COMMIT")
    await b.query("SET statement_timeout='5s'")
    await assert.rejects(b.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic','collected')", [raceOwner, old]), /card_limit_reached/)
    assert.equal(Number((await a.query("SELECT public.slot_saved_count_v1($1) n", [raceOwner])).rows[0].n), 3, "Unassigned ownership still counts")
    await a.query("UPDATE public.billing_configuration SET free_card_limit=4")
    await a.query("BEGIN")
    await a.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic','considering')", [raceOwner, old])
    const reverse = await request([add("race-fourth")], "synthetic-billing-reverse")
    await b.query("SET statement_timeout='200ms'")
    await assert.rejects(exec(b, reverse), /statement timeout/)
    await a.query("COMMIT")
    await b.query("SET statement_timeout='5s'")
    await assert.rejects(exec(b, reverse), /card_limit_reached/)
    assert.equal(Number((await a.query("SELECT public.slot_saved_count_v1($1) n", [raceOwner])).rows[0].n), 4)
  } finally {
    await a.query("ROLLBACK"); await b.query("ROLLBACK")
    await a.query("DELETE FROM auth.users WHERE id=ANY($1::uuid[])", [[raceOwner, racePartner]])
    await a.query("DELETE FROM public.tcg_series WHERE id='synthetic-race-series'")
    if (config) await a.query("UPDATE public.billing_configuration SET enforced=$1,free_card_limit=$2", [config.enforced, config.free_card_limit])
    await a.end(); await b.end()
  }
})
