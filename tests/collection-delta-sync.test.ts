import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  COLLECTION_DELTA_OVERLAP_MS,
  collectionBaselineRows,
  collectionDeltaSince,
  createCollectionBaseline,
  mergeCollectionDelta,
} from "../lib/collection/delta-sync"
import { syncCollectionRows } from "../lib/collection/load"

type Row = { pokemon_id: number; updated_at?: string; card_id?: string }

const row = (pokemon_id: number, updated_at: string | undefined, card_id = `c${pokemon_id}`): Row =>
  updated_at === undefined ? { pokemon_id, card_id } : { pokemon_id, updated_at, card_id }

test("baseline cursor is the newest updated_at, or null without one on every row", () => {
  const baseline = createCollectionBaseline("owner", [
    row(2, "2026-10-22T10:00:00.123456+00:00"),
    row(1, "2026-10-22T11:00:00+00:00"),
  ])
  assert.equal(baseline.cursor, "2026-10-22T11:00:00+00:00")
  assert.deepEqual(collectionBaselineRows(baseline).map((item) => item.pokemon_id), [1, 2])

  assert.equal(createCollectionBaseline("owner", [row(1, "2026-10-22T11:00:00Z"), row(2, undefined)]).cursor, null)
  assert.equal(createCollectionBaseline("owner", []).cursor, null)
})

test("delta reads start before the cursor and only for the same owner", () => {
  const baseline = createCollectionBaseline("owner", [row(1, "2026-10-22T11:00:00.000Z")])
  assert.equal(
    collectionDeltaSince(baseline, "owner"),
    new Date(Date.parse("2026-10-22T11:00:00.000Z") - COLLECTION_DELTA_OVERLAP_MS).toISOString(),
  )
  assert.equal(collectionDeltaSince(baseline, "someone-else"), null)
  assert.equal(collectionDeltaSince(null, "owner"), null)
})

test("merging applies changed and new rows and advances the cursor", () => {
  const baseline = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z"), row(2, "2026-10-22T10:00:00Z")])
  const merged = mergeCollectionDelta(baseline, [row(2, "2026-10-22T12:00:00Z", "new"), row(3, "2026-10-22T12:00:01Z")], 3)
  assert.ok(merged)
  assert.equal(merged.cursor, "2026-10-22T12:00:01Z")
  assert.deepEqual(collectionBaselineRows(merged).map((item) => [item.pokemon_id, item.card_id]), [[1, "c1"], [2, "new"], [3, "c3"]])
  // The baseline itself is untouched.
  assert.equal(baseline.rows.size, 2)
})

test("merging keeps the cursor when nothing (or only overlap) changed", () => {
  const baseline = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z")])
  assert.equal(mergeCollectionDelta(baseline, [], 1)?.cursor, "2026-10-22T10:00:00Z")
  assert.equal(mergeCollectionDelta(baseline, [row(1, "2026-10-22T10:00:00Z")], 1)?.cursor, "2026-10-22T10:00:00Z")
})

test("a server count below the merged rows (a delete) asks for a full fetch", () => {
  const baseline = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z"), row(2, "2026-10-22T10:00:00Z")])
  assert.equal(mergeCollectionDelta(baseline, [], 1), null)
  // Delete plus insert: still one row too many.
  assert.equal(mergeCollectionDelta(baseline, [row(3, "2026-10-22T12:00:00Z")], 2), null)
  // Changed rows without updated_at can't be trusted.
  assert.equal(mergeCollectionDelta(baseline, [row(3, undefined)], 3), null)
})

type Op = [string, unknown[]]

function fakeClient(handler: (ops: Op[]) => { data?: unknown; error?: unknown; count?: number | null }) {
  const requests: Op[][] = []
  const client = {
    from() {
      const ops: Op[] = []
      requests.push(ops)
      const builder: Record<string, unknown> = {}
      for (const method of ["select", "eq", "gt", "order", "range"]) {
        builder[method] = (...args: unknown[]) => {
          ops.push([method, args])
          return builder
        }
      }
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null, count: null, ...handler(ops) }).then(resolve, reject)
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, requests }
}

const isHead = (ops: Op[]) => ops.some(([method, args]) => method === "select" && (args[1] as { head?: boolean })?.head)
const isDelta = (ops: Op[]) => ops.some(([method]) => method === "gt")

test("syncCollectionRows does a full read without a usable baseline", async () => {
  const { client, requests } = fakeClient(() => ({ data: [row(1, "2026-10-22T10:00:00Z")] }))
  const baseline = await syncCollectionRows(client, "owner", null)
  assert.equal(requests.length, 1)
  assert.ok(!isDelta(requests[0]))
  assert.equal(baseline.cursor, "2026-10-22T10:00:00Z")
})

test("syncCollectionRows reads only changes plus a head count when it can", async () => {
  const start = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z"), row(2, "2026-10-22T10:00:00Z")])
  const { client, requests } = fakeClient((ops) =>
    isHead(ops) ? { count: 2 } : isDelta(ops) ? { data: [row(2, "2026-10-22T12:00:00Z", "new")] } : { data: [] },
  )
  const baseline = await syncCollectionRows(client, "owner", start)
  assert.equal(requests.length, 2)
  assert.ok(requests.every((ops) => isHead(ops) || isDelta(ops)))
  const delta = requests.find(isDelta)!
  assert.deepEqual(delta.find(([method]) => method === "gt")?.[1], ["updated_at", collectionDeltaSince(start, "owner")])
  assert.deepEqual(delta.find(([method]) => method === "eq")?.[1], ["user_id", "owner"])
  assert.equal(baseline.rows.get(2)?.card_id, "new")
})

test("syncCollectionRows falls back to a full read after a delete or a delta error", async () => {
  const start = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z"), row(2, "2026-10-22T10:00:00Z")])
  const full = [row(1, "2026-10-22T10:00:00Z")]

  const deleted = fakeClient((ops) => (isHead(ops) ? { count: 1 } : isDelta(ops) ? { data: [] } : { data: full }))
  const afterDelete = await syncCollectionRows(deleted.client, "owner", start)
  assert.deepEqual([...afterDelete.rows.keys()], [1])
  assert.equal(deleted.requests.length, 3)

  // e.g. migration 035 not applied yet: column updated_at does not exist.
  const missingColumn = fakeClient((ops) =>
    isDelta(ops) ? { error: { code: "42703", message: "column pokemon_collection.updated_at does not exist" } } : isHead(ops) ? { count: 2 } : { data: full },
  )
  const afterError = await syncCollectionRows(missingColumn.client, "owner", start)
  assert.deepEqual([...afterError.rows.keys()], [1])
})

test("syncCollectionRows throws when the full read fails", async () => {
  const failure = new Error("offline")
  const { client } = fakeClient(() => ({ error: failure }))
  await assert.rejects(() => syncCollectionRows(client, "owner", null), /offline/)
})

test("migration 035 is idempotent, server-owned and live-safe", () => {
  const sql = readFileSync(new URL("../scripts/035_collection_updated_at.sql", import.meta.url), "utf8").replace(/--.*$/gm, "")
  assert.match(sql, /ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.pokemon_collection/)
  assert.match(sql, /SET search_path = ''/)
  assert.match(sql, /DROP TRIGGER IF EXISTS pokemon_collection_set_updated_at/)
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pokemon_collection_user_updated_at\s+ON public\.pokemon_collection\(user_id, updated_at\)/)
  assert.doesNotMatch(sql, /\bBEGIN;|\bCOMMIT\b/i)
})

test("delta baselines are per binder: another binder needs a full read", () => {
  const baseline = createCollectionBaseline("owner", [row(1, "2026-10-22T11:00:00.000Z")], "binder-a")
  assert.ok(collectionDeltaSince(baseline, "owner", "binder-a"))
  assert.equal(collectionDeltaSince(baseline, "owner", "binder-b"), null)
  assert.equal(collectionDeltaSince(baseline, "owner"), null)
  assert.equal(mergeCollectionDelta(baseline, [row(2, "2026-10-22T12:00:00Z")], 2)?.binderId, "binder-a")
})

test("syncCollectionRows scopes every query to the owner and the binder", async () => {
  const start = createCollectionBaseline("owner", [row(1, "2026-10-22T10:00:00Z")], "binder-a")
  const { client, requests } = fakeClient((ops) => (isHead(ops) ? { count: 1 } : { data: [] }))
  const baseline = await syncCollectionRows(client, "owner", start, "binder-a")
  assert.equal(requests.length, 2)
  for (const ops of requests) {
    const filters = ops.filter(([method]) => method === "eq").map(([, args]) => args)
    assert.deepEqual(filters, [["user_id", "owner"], ["binder_id", "binder-a"]])
  }
  assert.equal(baseline.binderId, "binder-a")

  const full = fakeClient(() => ({ data: [row(1, "2026-10-22T10:00:00Z")] }))
  await syncCollectionRows(full.client, "owner", start, "binder-b")
  assert.equal(full.requests.length, 1)
  assert.ok(!isDelta(full.requests[0]))
  assert.deepEqual(full.requests[0].filter(([method]) => method === "eq").map(([, args]) => args), [["user_id", "owner"], ["binder_id", "binder-b"]])
})
