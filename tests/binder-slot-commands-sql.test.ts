import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const socket = process.env.SLOT_COMMAND_TEST_SOCKET
const owner = "03620000-0000-4000-8000-000000000001"
const partner = "03620000-0000-4000-8000-000000000002"
const stranger = "03620000-0000-4000-8000-000000000003"
const binder = "03620000-0000-4000-8000-000000000011"
const legacy = "03620000-0000-4000-8000-000000000012"
const want = { card_id: "synthetic-card", card_name: "Synthetic", added_at: "2020-01-01T00:00:00Z" }

test("private SQL: atomic slot commands, permissions, revisions, replay, rollback and billing", { skip: !socket }, async () => {
  if (!socket) return
  assert.equal(socket, "/Users/cal/.local/share/holofolder/issue362-local/socket")
  const { Client } = await import("pg")
  const db = new Client({ host: socket, port: 55462, user: "issue362_test", database: "postgres" })
  await db.connect()
  const migration = readFileSync(new URL("../scripts/074_atomic_slot_commands.sql", import.meta.url), "utf8")
  try {
    await db.query(migration); await db.query(migration)
    await db.query("BEGIN; SET LOCAL statement_timeout='10s'")
    await db.query("INSERT INTO auth.users(id,created_at) VALUES ($1,'2020-01-01'),($2,'2020-01-01'),($3,'2020-01-01')", [owner, partner, stranger])
    await db.query("UPDATE public.billing_configuration SET enforced=false")
    await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES ($1,$2,'Synthetic slots',true),($3,$2,'Synthetic legacy',false)", [binder, owner, legacy])
    await db.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)", [owner])
    await db.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [binder, owner])
    await db.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [owner, partner])
    const send = async (commands: unknown[], id: string, actor = owner, revisions?: object) => {
      const state = (await db.query("SELECT s.*,o.inventory_revision FROM public.storage_collection_state s JOIN public.inventory_owner_state o USING(owner_user_id) WHERE collection_id=$1", [binder])).rows[0]
      const input = { collectionId: binder, operationId: id, inventoryRevision: Number(state.inventory_revision), collectionVersion: Number(state.version), layoutRevision: Number(state.layout_revision), commands, ...revisions }
      return (await db.query("SELECT public.slot_command_v1($1,$2,$3,$4) r", [actor, owner, input, { source: "app", clientId: null }])).rows[0].r
    }
    const rejected = async (action: () => Promise<unknown>, pattern: RegExp) => {
      await db.query("SAVEPOINT rejected")
      await assert.rejects(action(), pattern)
      await db.query("ROLLBACK TO SAVEPOINT rejected")
    }
    const read = async (after: number | null = null, revision: number | null = null) => (await db.query("SELECT public.slot_page_v1($1,$2,$3,$4,$5,$6,$7,$8) r", [owner, owner, binder, 500, after, revision, revision, revision])).rows[0].r
    const create = [{ kind: "create", ids: Array.from({ length: 256 }, (_, i) => `synthetic-${i}`), beforeSlotId: null }]
    const before = { inventoryRevision: 0, collectionVersion: 0, layoutRevision: 0 }
    const result = await send(create, "synthetic-create-1")
    assert.equal(result.slots.length, 256)
    assert.equal(result.acquisition, false)
    assert.deepEqual(await send(create, "synthetic-create-1", owner, before), result)
    await rejected(() => send([{ kind: "create", ids: ["changed"], beforeSlotId: null }], "synthetic-create-1"), /idempotency_conflict/)
    await rejected(() => send(create, "synthetic-stranger", stranger), /access_denied/)
    await rejected(() => send(create, "synthetic-stale", owner, before), /revision_conflict/)
    const emptyRef = (id: string, version = 0) => ({ id, version, inventoryItemId: null, itemVersion: null, placementVersion: null })
    await rejected(() => send([{ kind: "update", slot: emptyRef("synthetic-0"), target: { kind: "card", cardId: "missing" } }], "synthetic-no-catalog"), /catalog/)
    await db.query("INSERT INTO public.tcg_series(id) VALUES('synthetic-slot-series')")
    await db.query("INSERT INTO public.tcg_sets(id,series_id) VALUES('synthetic-slot-set','synthetic-slot-series')")
    await db.query(`INSERT INTO public.tcg_cards(id,series_id,set_id,local_id,external_ids_json) VALUES
      ('synthetic-card','synthetic-slot-series','synthetic-slot-set','1','{"catalog":{"canonicalId":"synthetic-canonical","aliasIds":["synthetic-alias"]}}')`)
    await send([{ kind: "update", slot: emptyRef("synthetic-2"), target: { kind: "card", cardId: "synthetic-alias" } }], "synthetic-alias-target")
    await send([{ kind: "update", slot: emptyRef("synthetic-0"), target: { kind: "pokemon", pokemonId: 25 }, wantedCards: [want] }], "synthetic-update")
    assert.equal((await read()).slots[0].target.pokemonId, 25)
    await rejected(() => send([{ kind: "clear", slots: [emptyRef("synthetic-0")] }], "synthetic-stale-slot"), /slot_conflict/)
    // Invalid second command rolls back the first and does not consume an idempotency key/revision.
    const oldPage = await read()
    await rejected(() => send([{ kind: "create", ids: ["rollback"], beforeSlotId: null }, { kind: "remove", slots: [emptyRef("missing")] }], "synthetic-rollback"), /slot_conflict/)
    assert.deepEqual(await read(), oldPage)
    await rejected(() => send(Array.from({ length: 101 }, () => create[0]), "synthetic-too-big"), /invalid_slot_command/)
    await rejected(() => send([{ kind: "create", ids: ["a"], beforeSlotId: null, collectionId: legacy }], "synthetic-mixed"), /invalid_slot_command/)
    // A restored owned copy with no catalog evidence can be cleared into Unassigned.
    await db.query("INSERT INTO public.inventory_items(id,owner_user_id,identity) VALUES('synthetic-copy',$1,'{\"kind\":\"card\",\"cardId\":\"unavailable\"}')", [owner])
    await db.query("INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id) VALUES('synthetic-copy',$1,$2,'synthetic-0')", [owner, binder])
    await db.query("UPDATE public.binder_slots SET status='collected' WHERE id='synthetic-0'")
    const ownedRef = { id: "synthetic-0", version: 1, inventoryItemId: "synthetic-copy", itemVersion: 0, placementVersion: 0 }
    await rejected(() => send([{ kind: "clear", slots: [{ ...ownedRef, placementVersion: 1 }] }], "synthetic-placement-stale"), /placement_conflict/)
    await rejected(() => send([{ kind: "clear", slots: [{ ...ownedRef, itemVersion: 1 }] }], "synthetic-item-stale"), /item_conflict/)
    const cleared = await send([{ kind: "clear", slots: [ownedRef] }], "synthetic-clear", partner)
    assert.equal(cleared.acquisition, false)
    const kept = (await read()).slots[0]
    assert.equal(kept.target.pokemonId, 25); assert.deepEqual(kept.wanted_cards, [want]); assert.equal(kept.status, null)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='synthetic-copy'")).rows[0].n, 1)
    await send([{ kind: "move", slots: [emptyRef("synthetic-0", 2)], beforeSlotId: null }], "synthetic-move")
    await send([{ kind: "remove", slots: [emptyRef("synthetic-0", 2)] }], "synthetic-remove")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.inventory_items WHERE id='synthetic-copy'")).rows[0].n, 1)
    await db.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic','collected')", [owner, legacy])
    assert.equal(Number((await db.query("SELECT public.slot_saved_count_v1($1) n", [owner])).rows[0].n), 2)
    await db.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=2")
    await rejected(() => send([{ kind: "update", slot: emptyRef("synthetic-1"), wantedCards: [want] }], "synthetic-over-limit"), /card_limit_reached/)
    await rejected(() => send([{ kind: "create", ids: ["partner-free"], beforeSlotId: null }], "synthetic-partner-free", partner), /access_denied/)
    // Current trusted signup trial restores paid partner access, no policy recreation.
    await db.query("UPDATE auth.users SET created_at=now()-interval '1 hour' WHERE id=$1", [owner])
    await send([{ kind: "update", slot: emptyRef("synthetic-1"), wantedCards: [want] }], "synthetic-trial", partner)
    // Subscription and lifetime paths use the existing entitlement primitives too.
    await db.query("UPDATE auth.users SET created_at='2020-01-01' WHERE id=$1", [owner])
    await db.query("INSERT INTO public.billing_accounts(owner_user_id,status,paid_through) VALUES($1,'active',now()+interval '1 day')", [owner])
    await send([{ kind: "create", ids: ["synthetic-paid"], beforeSlotId: null }], "synthetic-paid", partner)
    await db.query("DELETE FROM public.billing_accounts WHERE owner_user_id=$1", [owner])
    await db.query("INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES($1,'manual')", [owner])
    await send([{ kind: "create", ids: ["synthetic-perpetual"], beforeSlotId: null }], "synthetic-perpetual", partner)
    // Local restores omit original ACLs. Restore only required platform READ grants inside rollback.
    await db.query("GRANT USAGE ON SCHEMA auth,public TO authenticated; GRANT SELECT ON public.partnerships TO authenticated")
    for (const [actor, expected] of [[owner, 257], [partner, 257], [stranger, 0]] as const) {
      await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: "authenticated" })])
      await db.query("SET LOCAL ROLE authenticated")
      assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1", [binder])).rows[0].n, expected)
      await rejected(() => db.query("UPDATE public.binder_slots SET target=NULL WHERE collection_id=$1", [binder]), /permission denied/)
      await db.query("RESET ROLE")
    }
    await db.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [owner])
    await rejected(() => send([{ kind: "create", ids: ["unlinked"], beforeSlotId: null }], "synthetic-unlinked", partner), /access_denied/)
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: partner, role: "authenticated" })])
    await db.query("SET LOCAL ROLE authenticated")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.binder_slots WHERE collection_id=$1", [binder])).rows[0].n, 0)
    await db.query("RESET ROLE")
    await rejected(() => read(0, 0), /revision_conflict/)
    // Isolate stale content/layout tokens even when the owner revision is current.
    await rejected(() => send([{ kind: "clear", slots: [emptyRef("synthetic-3")] }], "synthetic-layout-only", owner, { layoutRevision: 0 }), /revision_conflict/)
    await rejected(() => send([{ kind: "clear", slots: [emptyRef("synthetic-3")] }], "synthetic-content-only", owner, { collectionVersion: 0 }), /revision_conflict/)
    await db.query("SAVEPOINT capacity")
    await db.query("INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) SELECT 'synthetic-capacity-'||n,$1,$2,n FROM generate_series(257,4095) n", [owner, binder])
    await rejected(() => send([{ kind: "create", ids: ["synthetic-over-capacity"], beforeSlotId: null }], "synthetic-capacity"), /slot_capacity_exceeded/)
    await db.query("ROLLBACK TO SAVEPOINT capacity")
    // RLS and RPC cannot be used to bypass the staged runtime gate.
    for (const role of ["anon", "authenticated", "holo_mcp", "service_role"]) {
      assert.equal((await db.query("SELECT has_function_privilege($1,'public.slot_command_v1(uuid,uuid,jsonb,jsonb)','execute') allowed", [role])).rows[0].allowed, false)
    }
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK")
  } finally { await db.query("ROLLBACK"); await db.end() }
})

test("private SQL: stable 1025-slot pagination and concurrent legacy/new allowance growth", { skip: !socket }, async () => {
  if (!socket) return
  assert.equal(socket, "/Users/cal/.local/share/holofolder/issue362-local/socket")
  const { Client } = await import("pg")
  const connection = { host: socket, port: 55462, user: "issue362_test", database: "postgres" }
  const a = new Client(connection), b = new Client(connection)
  await a.connect(); await b.connect()
  const raceOwner = "03620000-0000-4000-8000-000000000101", slotsBinder = "03620000-0000-4000-8000-000000000111", oldBinder = "03620000-0000-4000-8000-000000000112"
  let config: unknown
  let created = false
  let partnerCreated = false
  const racePartner = "03620000-0000-4000-8000-000000000102"
  const request = async (db: typeof a, commands: unknown[], id: string) => {
    const s = (await db.query("SELECT s.*,o.inventory_revision FROM public.storage_collection_state s JOIN public.inventory_owner_state o USING(owner_user_id) WHERE collection_id=$1", [slotsBinder])).rows[0]
    return { collectionId: slotsBinder, operationId: id, inventoryRevision: Number(s.inventory_revision), collectionVersion: Number(s.version), layoutRevision: Number(s.layout_revision), commands }
  }
  const execute = async (db: typeof a, input: object) => (await db.query("SELECT public.slot_command_v1($1,$1,$2,$3) r", [raceOwner, input, { source: "app", clientId: null }])).rows[0].r
  const empty = (id: string) => ({ id, version: 0, inventoryItemId: null, itemVersion: null, placementVersion: null })
  try {
    config = (await a.query("SELECT enforced,free_card_limit FROM public.billing_configuration WHERE id")).rows[0]
    await a.query("BEGIN")
    await a.query("UPDATE public.billing_configuration SET enforced=false")
    await a.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01')", [raceOwner]); created = true
    await a.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES($1,$3,'Synthetic paging',true),($2,$3,'Synthetic race legacy',false)", [slotsBinder, oldBinder, raceOwner])
    await a.query("INSERT INTO public.inventory_owner_state(owner_user_id) VALUES($1)", [raceOwner])
    await a.query("INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES($1,$2,'slots')", [slotsBinder, raceOwner])
    for (let start = 0; start < 1025; start += 256) {
      await execute(a, await request(a, [{ kind: "create", ids: Array.from({ length: Math.min(256, 1025 - start) }, (_, i) => `synthetic-page-${start + i}`), beforeSlotId: null }], `synthetic-page-insert-${start}`))
    }
    assert.equal(Number((await a.query("SELECT public.slot_saved_count_v1($1) n", [raceOwner])).rows[0].n), 0, "empty 1025-target capacity has no saved-entry cost")
    let after: number | null = null, revision: number | null = null
    let total = 0
    const seen = new Set<string>()
    do {
      const page: { slots: Array<{ id: string }>; nextPosition: number | null; inventoryRevision: number } = (await a.query("SELECT public.slot_page_v1($1,$1,$2,500,$3,$4,$4,$4) r", [raceOwner, slotsBinder, after, revision])).rows[0].r
      for (const s of page.slots) { assert.ok(!seen.has(s.id)); seen.add(s.id) }
      total += page.slots.length; after = page.nextPosition; revision = page.inventoryRevision
    } while (after !== null)
    assert.equal(total, 1025)
    const plan = (await a.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,position FROM public.binder_slots WHERE owner_user_id=$1 AND collection_id=$2 ORDER BY position,id LIMIT 500", [raceOwner, slotsBinder])).rows[0]["QUERY PLAN"][0]
    assert.equal(plan.Plan["Actual Rows"], 500)
    console.info(`Synthetic local slot page: ${plan["Execution Time"]} ms, ${plan.Plan["Node Type"]}`)
    await a.query("UPDATE public.billing_configuration SET enforced=true,free_card_limit=1")
    await a.query("COMMIT")
    // A new slot want holds the same allowance lock as the legacy AFTER trigger.
    await a.query("BEGIN")
    const first = await request(a, [{ kind: "update", slot: empty("synthetic-page-0"), wantedCards: [want] }], "synthetic-race-want")
    const firstResult = await execute(a, first)
    await b.query("SET lock_timeout='150ms'; SET statement_timeout='5s'")
    await assert.rejects(b.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic race','collected')", [raceOwner, oldBinder]), /lock timeout/)
    await a.query("COMMIT")
    await assert.rejects(b.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic race','collected')", [raceOwner, oldBinder]), /card_limit_reached/)
    assert.deepEqual(await execute(b, first), firstResult, "committed response loss replays exactly")
    // A stale partner/layout edit cannot overwrite the winner.
    await assert.rejects(execute(b, { ...first, operationId: "synthetic-stale-racer" }), /revision_conflict/)
    // Reversed lock direction: committed legacy growth prevents a slot want from exceeding allowance.
    await a.query("BEGIN")
    await execute(a, await request(a, [{ kind: "update", slot: { ...empty("synthetic-page-0"), version: 1 }, wantedCards: [] }], "synthetic-reset-want"))
    await a.query("INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,status) VALUES($1,$2,1,'Synthetic race','collected')", [raceOwner, oldBinder])
    const second = await request(b, [{ kind: "update", slot: empty("synthetic-page-1"), wantedCards: [want] }], "synthetic-race-second")
    await assert.rejects(execute(b, second), /lock timeout/)
    await a.query("COMMIT")
    const freshSecond = await request(b, second.commands, "synthetic-race-second")
    await assert.rejects(execute(b, freshSecond), /card_limit_reached/)
    assert.equal(Number((await a.query("SELECT public.slot_saved_count_v1($1) n", [raceOwner])).rows[0].n), 1)
    // Partnership row locks hold current access until the accepted transaction commits.
    await a.query("UPDATE public.billing_configuration SET enforced=false")
    await a.query("INSERT INTO auth.users(id,created_at) VALUES($1,'2020-01-01')", [racePartner]); partnerCreated = true
    await a.query("INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES($1,$2,$1)", [raceOwner, racePartner])
    const partnerInput = await request(a, [{ kind: "clear", slots: [empty("synthetic-page-5")] }], "synthetic-unlink-race")
    await a.query("BEGIN")
    await a.query("SELECT public.slot_command_v1($1,$2,$3,$4)", [racePartner, raceOwner, partnerInput, { source: "app", clientId: null }])
    await assert.rejects(b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [raceOwner]), /lock timeout/)
    await a.query("COMMIT")
    await b.query("DELETE FROM public.partnerships WHERE owner_user_id=$1", [raceOwner])
    await assert.rejects(b.query("SELECT public.slot_command_v1($1,$2,$3,$4)", [racePartner, raceOwner, partnerInput, { source: "app", clientId: null }]), /access_denied/)

  } finally {
    await a.query("ROLLBACK"); await b.query("ROLLBACK")
    if (partnerCreated) await a.query("DELETE FROM auth.users WHERE id=$1", [racePartner])
    if (created) await a.query("DELETE FROM auth.users WHERE id=$1", [raceOwner])
    if (config) await a.query("UPDATE public.billing_configuration SET enforced=$1,free_card_limit=$2", [(config as { enforced: boolean }).enforced, (config as { free_card_limit: number }).free_card_limit])
    await a.end(); await b.end()
  }
})
