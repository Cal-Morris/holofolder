import assert from "node:assert/strict"
import { collectionFingerprint } from "../../lib/collection/sync"
async function main() {
  // Synthetic adapters expose only read queries and existing atomic kernels, never direct writes.
  // @ts-expect-error Bun module mocks are confined to subprocesses.
  const { mock } = await import("bun:test")
  mock.module("server-only", () => ({}))
  const binder = "00000000-0000-4000-8000-000000000003", owner = "00000000-0000-4000-8000-000000000002", actor = "00000000-0000-4000-8000-000000000001"
  const row = { id: "synthetic", user_id: owner, binder_id: binder, pokemon_id: 25, pokemon_name: "Synthetic", status: "collected" as const, wanted_cards: [], collected_at: "2026-11-10" }
  let unavailable = false, saves = 0, deletes = 0, conflict = false, accessDenied = false
  mock.module("../../lib/server/partner-push", () => ({ saveCollectionWithAcquisition: async (input: { ownerId: string; binderId: string; actorId: string; expected: unknown; row: Record<string, unknown> }) => {
    assert.equal(input.ownerId, owner); assert.equal(input.binderId, binder); assert.equal(input.actorId, actor); assert.deepEqual(input.expected, row); saves++
    if (accessDenied) throw new Error("write failed", { cause: { message: "Collection access denied" } })
    return unavailable ? null : { item: { ...row, ...input.row } }
  }, startPendingPartnerPush: async () => 0 }))
  mock.module("../../lib/server/collector-funnel", () => ({ scheduleCollectorTracking() {}, recordCollectorSave() {} }))
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
    const q = { select() { return q }, eq() { return q }, or() { return q }, limit() { return q }, async maybeSingle() {
      return { data: table === "binders" ? { id: binder } : table === "pokemon_collection" ? row : null, error: null }
    } }
    return q
  }, async rpc(name: string, input: Record<string, unknown>) {
    assert.equal(name, "developer_delete_collection"); assert.equal(input.actor, actor); assert.equal(input.owner_id, owner); assert.equal(input.binder, binder); assert.deepEqual(input.expected, row); deletes++
    if (accessDenied) return { data: null, error: { message: "Collection access denied", code: "P0001" } }
    return { data: conflict ? { conflict: true } : { deleted: true }, error: null }
  } }) }))
  const { NextRequest } = await import("next/server")
  const { saveCollectionItem, updateCollectionStatus, deleteCollectionItem } = await import("../../lib/server/operations/collection")
  const user = { id: actor, user_metadata: {} } as Parameters<typeof saveCollectionItem>[1]
  const request = (method: string, fingerprint: string | null = collectionFingerprint(row)) => new NextRequest(`https://synthetic.test/app/api/collection?pokemonId=25&binderId=${binder}`, { method, ...(method === "DELETE" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pokemonId: 25, pokemonName: "Synthetic", status: "finalized", binderId: binder, wantedCards: [], ...(fingerprint !== null ? { baseFingerprint: fingerprint } : {}) }) }) })
  assert.equal((await updateCollectionStatus(request("PATCH", "synthetic-stale-fingerprint"), user, owner)).status, 409)
  const missing = await updateCollectionStatus(request("PATCH", null), user, owner)
  assert.equal(missing.status, 503); assert.equal((await missing.json()).code, "collection_precondition_required")
  assert.equal(saves, 0, "stale and missing client evidence must not call the write kernel")
  assert.equal((await saveCollectionItem(request("POST"), user, false, { ownerUserId: owner, memberIds: [owner, actor] })).status, 200)
  assert.equal((await updateCollectionStatus(request("PATCH"), user, owner)).status, 200)
  assert.equal((await deleteCollectionItem(request("DELETE"), user, true, owner, true)).status, 200)
  unavailable = true
  assert.equal((await saveCollectionItem(request("POST"), user, false, { ownerUserId: owner, memberIds: [owner, actor] })).status, 503)
  assert.equal((await updateCollectionStatus(request("PATCH"), user, owner)).status, 503)
  conflict = true
  const response = await deleteCollectionItem(request("DELETE"), user, true, owner, true)
  assert.equal(response.status, 409); assert.equal((await response.json()).item.id, row.id)
  unavailable = false; accessDenied = true
  for (const response of [await saveCollectionItem(request("POST"), user, false, { ownerUserId: owner, memberIds: [owner, actor] }), await updateCollectionStatus(request("PATCH"), user, owner), await deleteCollectionItem(request("DELETE"), user, true, owner, true)]) {
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "collection_recipient_inaccessible")
  }
  assert.equal(saves, 6); assert.equal(deletes, 3)
}
void main()
