import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { legacySlotId, legacyWorkspaceMapping, readStorageAuthority, loadAllStoredSlots } from "../lib/legacy-binder-transition"

describe("legacy binder transition", () => {
  test("stable species mapping preserves distinct binders and every implicit Dex target", () => {
    const ids = Array.from({ length: 1025 }, (_, i) => legacySlotId("binder-a", i + 1))
    assert.equal(new Set(ids).size, 1025)
    assert.equal(ids[0], "legacy-dex-v1/binder-a/1")
    assert.notEqual(ids[0], legacySlotId("binder-b", 1))
    assert.throws(() => legacySlotId("binder-a", 0))
    assert.throws(() => legacySlotId("binder-a", 1026))
  })
  test("guest mapping retains workspace and source row IDs, never guesses recipient or deduplicates printings", () => {
    const mapping = legacyWorkspaceMapping({ workspaceId: "guest-device-1", collectionId: "local-binder", rowIds: ["copy-a", "copy-b"] })
    assert.deepEqual(mapping, { version: 1, workspaceId: "guest-device-1", collectionId: "local-binder", recipient: null, rowIds: ["copy-a", "copy-b"] })
    assert.throws(() => legacyWorkspaceMapping({ workspaceId: "", collectionId: "local-binder", rowIds: [] }))
    assert.throws(() => legacyWorkspaceMapping({ workspaceId: "guest", collectionId: "binder", rowIds: ["same", "same"] }))
  })
  test("missing schema selects legacy, every other error or malformed state fails closed", () => {
    for (const code of ["42P01", "PGRST205"]) assert.equal(readStorageAuthority(null, { code }), "legacy")
    assert.equal(readStorageAuthority(null, null), "legacy")
    assert.equal(readStorageAuthority({ authority: "legacy", conversion_version: null }, null), "legacy")
    assert.equal(readStorageAuthority({ authority: "slots", conversion_version: 1 }, null), "slots")
    assert.equal(readStorageAuthority({ authority: "slots", conversion_version: null }, null), "slots")
    assert.throws(() => readStorageAuthority(null, { code: "42501" }))
    assert.throws(() => readStorageAuthority({ authority: "slots", conversion_version: 2 }, null))
    assert.throws(() => readStorageAuthority({ authority: "slots" }, null))
  })
  test("loads 1025 slots beyond the PostgREST cap and propagates page failure", async () => {
    const rows = Array.from({ length: 1025 }, (_, position) => ({ id: `slot-${position}`, position }))
    const pages: number[] = []
    const loaded = await loadAllStoredSlots(async (from, to) => { pages.push(from); return { data: rows.slice(from, to + 1), error: null } })
    assert.deepEqual(pages, [0, 1000])
    assert.deepEqual(loaded, rows)
    await assert.rejects(loadAllStoredSlots(async () => ({ data: null, error: { code: "42501" } })))
  })
})

// Explicit opt-in. This can never connect to a hosted database or another worker's local cluster.
const testSocket = process.env.SLOT_STORAGE_TEST_SOCKET

test("isolated restored SQL schema: rerun, rollback/RLS/digests, all legacy binders and racing writers", { skip: !testSocket }, async () => {
  if (!testSocket) return
  assert.equal(testSocket, "/Users/cal/.local/share/holofolder/issue361-local/socket")
  const { Client } = await import("pg")
  const { readFileSync } = await import("node:fs")
  const connect = async () => {
    const client = new Client({ host: testSocket, port: 55461, user: "issue361_test", database: "postgres", application_name: "issue361_isolated_proof" })
    await client.connect()
    return client
  }
  const db = await connect()
  const other = await connect()
  const coreEvidence = async () => (await db.query(`SELECT jsonb_build_object(
    'binders',(SELECT md5(coalesce(string_agg(md5(to_jsonb(b)::text),'' ORDER BY id),'')) FROM public.binders b),
    'legacy',(SELECT md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' ORDER BY id),'')) FROM public.pokemon_collection c),
    'settings',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY user_id),'')) FROM public.user_settings s),
    'shares',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY id),'')) FROM public.binder_shares s),
    'appearances',(SELECT md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' ORDER BY md5(to_jsonb(s)::text)),'')) FROM public.binder_appearances s)) evidence`)).rows[0].evidence
  try {
    await other.query("SET lock_timeout = '150ms'; SET statement_timeout = '5s'")
    const before = await coreEvidence()
    const migration = readFileSync(new URL("../scripts/073_inventory_slot_storage.sql", import.meta.url), "utf8")
    await db.query(migration)
    await db.query(migration)
    assert.deepEqual(await coreEvidence(), before, "DDL/rerun must preserve all legacy data and appearance/share identity")
    assert.equal((await db.query("SELECT count(*)::int n FROM public.storage_collection_state")).rows[0].n, 0, "DDL must never convert a binder")
    const proof = readFileSync(new URL("../scripts/verify-inventory-slot-storage.sql", import.meta.url), "utf8").replace(/^\\set.*$/gm, "")
    await db.query(proof)
    assert.deepEqual(await coreEvidence(), before, "rollback-only synthetic proof changed original data")

    // Convert the actual restored source snapshot locally, then roll it all back.
    await db.query("BEGIN")
    const binders = (await db.query("SELECT id,owner_user_id FROM public.binders ORDER BY id")).rows
    let sourceOwned = 0, convertedOwned = 0
    for (const binder of binders) {
      const evidence = (await db.query("SELECT public.legacy_binder_evidence_v1($1) e", [binder.id])).rows[0].e
      const receipt = (await db.query("SELECT public.convert_legacy_binder_v1($1,$2,$3) r", [binder.id, binder.owner_user_id, evidence.rowsDigest])).rows[0].r
      assert.deepEqual(receipt.source, evidence)
      assert.equal(receipt.mappedRowsDigest, evidence.rowsDigest)
      assert.equal(receipt.mappedOwnedDigest, evidence.ownedDigest)
      assert.equal(receipt.mappedWantedDigest, evidence.wantedDigest)
      assert.equal(receipt.mappedWantedEntries, evidence.wantedEntries)
      assert.equal(receipt.slots, 1025)
      assert.equal(receipt.items, evidence.owned)
      sourceOwned += evidence.owned; convertedOwned += receipt.items
    }
    assert.equal(convertedOwned, sourceOwned)
    // SQL rows adapt to the accepted domain without a competing domain model.
    const { normalizeBinderSnapshot } = await import("../lib/domain/binder-slots")
    const { normalizeInventoryItem } = await import("../lib/domain/inventory")
    for (const b of binders) {
      const state = (await db.query("SELECT * FROM public.storage_collection_state WHERE collection_id=$1", [b.id])).rows[0]
      const slots = (await db.query(`SELECT s.*,p.inventory_item_id FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id
        WHERE s.collection_id=$1 ORDER BY s.position,s.id`, [b.id])).rows
      assert.ok(normalizeBinderSnapshot({ ownerUserId: b.owner_user_id, collectionId: b.id, layoutRevision: Number(state.layout_revision), presetManifest: state.preset_manifest,
        slots: slots.map(s => ({ id: s.id, ownerUserId: s.owner_user_id, collectionId: s.collection_id, target: s.target, status: s.status, wantedCards: s.wanted_cards,
          inventoryItemId: s.inventory_item_id ?? null, version: Number(s.version), presetOrigin: s.preset_origin })) }), "converted snapshot violates #360/#382")
    }
    for (const item of (await db.query("SELECT * FROM public.inventory_items")).rows) {
      assert.ok(normalizeInventoryItem({ id: item.id, ownerUserId: item.owner_user_id, identity: item.identity, grading: item.grading,
        acquiredAt: item.acquired_at?.toISOString() ?? null, version: Number(item.version) }), "converted inventory violates #382")
    }
    await db.query("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK")
    assert.deepEqual(await coreEvidence(), before)

    // Separate sessions prove actual lock ordering and a lost-response retry after commit.
    const owner = "03610000-0000-4000-8000-000000000091", binder = "03610000-0000-4000-8000-000000000092"
    await db.query("INSERT INTO auth.users(id) VALUES ($1)", [owner])
    try {
      await db.query("INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES ($1,$2,'Synthetic race binder',true)", [binder, owner])
      await db.query("BEGIN")
      await db.query("INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name) VALUES ($1,$2,1,'Synthetic racing ownership')", [binder, owner])
      // Other session sees the pre-commit preview, then waits on the legacy writer's binder lock.
      const stale = (await other.query("SELECT public.legacy_binder_evidence_v1($1) e", [binder])).rows[0].e
      const pending = other.query("SELECT public.convert_legacy_binder_v1($1,$2,$3)", [binder, owner, stale.rowsDigest])
      await assert.rejects(pending, (error: unknown) => (error as { code: string }).code === "55P03", "conversion must wait for the actual legacy writer lock")
      await db.query("COMMIT")
      await assert.rejects(other.query("SELECT public.convert_legacy_binder_v1($1,$2,$3)", [binder, owner, stale.rowsDigest]),
        (error: unknown) => (error as { code: string }).code === "40001")
      const fresh = (await db.query("SELECT public.legacy_binder_evidence_v1($1) e", [binder])).rows[0].e
      await db.query("BEGIN")
      const receipt = (await db.query("SELECT public.convert_legacy_binder_v1($1,$2,$3) r", [binder, owner, fresh.rowsDigest])).rows[0].r
      const writer = other.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic stale writer' WHERE binder_id=$1", [binder])
      await assert.rejects(writer, (error: unknown) => (error as { code: string }).code === "55P03", "legacy writer must wait for the actual conversion lock")
      await db.query("COMMIT")
      await assert.rejects(other.query("UPDATE public.pokemon_collection SET pokemon_name='Synthetic stale writer' WHERE binder_id=$1", [binder]),
        (error: unknown) => (error as { code: string }).code === "55000")
      assert.deepEqual((await other.query("SELECT public.convert_legacy_binder_v1($1,$2,$3) r", [binder, owner, fresh.rowsDigest])).rows[0].r, receipt)
    } finally {
      await db.query("ROLLBACK")
      await db.query("DELETE FROM auth.users WHERE id=$1", [owner])
    }
    assert.deepEqual(await coreEvidence(), before)
  } finally {
    await db.query("ROLLBACK")
    await Promise.all([db.end(), other.end()])
  }
})
