import assert from "node:assert/strict"
async function main() {
  // Synthetic owner/history, no database or hosted request.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-server-key"
  // @ts-expect-error Bun mocks are isolated in this subprocess.
  const { mock } = await import("bun:test")
  let state: "legacy" | "slots" | "mixed" | "unknown" | "unavailable" | "missing" | "late-conversion" | "paged-native" | "retained-unassigned" | "late-retained-unassigned" | "root-unavailable" | "root-malformed" | "late-retained-missing-history" = "legacy"
  let historyReads = 0
  let rootReads = 0
  const owner = "synthetic-owner"
  const client = { from(table: string) {
    let offset = 0
    const query = { select() { return query }, eq(key: string, value: string) { if (table === "storage_collection_state" || table === "inventory_owner_state") { assert.equal(key, "owner_user_id"); assert.equal(value, owner) } return query },
      maybeSingle() { return query }, order() { return query }, range(from: number) { offset = from; return query }, limit() { return query }, lt() { return query }, gte() { return query },
      then(resolve: (v: unknown) => void) {
        if (table === "inventory_owner_state") { rootReads++; resolve({ data: state === "retained-unassigned" ? { owner_user_id: owner } : state === "root-malformed" ? { owner_user_id: "wrong-owner" } : null, error: state === "root-unavailable" ? { code: "42501" } : state === "missing" ? { code: "42P01" } : null }); return }
        if (table === "storage_collection_state") resolve({ data: state === "retained-unassigned" || state === "late-retained-unassigned" || state === "root-unavailable" || state === "root-malformed" || state === "late-retained-missing-history" ? [] : state === "paged-native" ? offset === 0 ? Array.from({ length: 1000 }, () => ({ authority: "legacy", conversion_version: null })) : [{ authority: "slots", conversion_version: 1 }] : state === "late-conversion" ? [{ authority: "legacy", conversion_version: null }] : state === "missing" || state === "unavailable" ? null : state === "mixed" ? [{ authority: "legacy", conversion_version: null }, { authority: "slots", conversion_version: 1 }]
          : [{ authority: state, conversion_version: state === "slots" ? 1 : null }], error: state === "missing" ? { code: "42P01" } : state === "unavailable" ? { code: "42501" } : null })
        else { historyReads++; const missing = state === "late-retained-missing-history"; if (state === "late-conversion") state = "slots"; if (state === "late-retained-unassigned" || missing) state = "retained-unassigned"; resolve({ data: missing ? null : [], error: missing ? { code: "42P01" } : null }) }
      } }
    return query
  } }
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => client }))
  const { readCollectionAnalytics } = await import("../../lib/server/operations/analytics")
  const request = () => readCollectionAnalytics(new Request("https://synthetic.test/app/api/collection-analytics"), { id: owner }, owner)
  for (const kind of ["legacy", "missing"] as const) { state = kind; const r = await request(); assert.equal(r.status, 200); assert.equal((await r.json()).historyAvailable, true) }
  const previousReads = historyReads
  for (const kind of ["slots", "mixed", "unknown", "unavailable", "retained-unassigned", "root-unavailable", "root-malformed"] as const) {
    state = kind
    const response = await request()
    assert.equal(response.status, 503, kind)
    assert.equal(response.headers.get("Cache-Control"), "private, no-store")
    if (kind === "slots" || kind === "mixed" || kind === "retained-unassigned") assert.equal((await response.json()).code, "native_analytics_staged")
    assert.equal(historyReads, previousReads, kind)
  }
  state = "paged-native"
  assert.equal((await request()).status, 503, "native authority after the 1000-row cap is still denied")
  assert.equal(historyReads, previousReads)
  state = "late-conversion"
  const late = await request()
  assert.equal(late.status, 503, "conversion during history read must not release frozen rows")
  assert.equal((await late.json()).code, "native_analytics_staged")
  state = "late-retained-unassigned"
  const retained = await request()
  assert.equal(retained.status, 503, "native root/copies retained after collection deletion cannot release legacy-only history")
  assert.equal((await retained.json()).code, "native_analytics_staged")
  assert.ok(rootReads >= 2, "both authority fences inspect the owner root")
  state = "late-retained-missing-history"
  assert.equal((await request()).status, 503, "missing history does not bypass the final owner-root fence")
}
main().catch(error => { console.error(error); process.exitCode = 1 })
