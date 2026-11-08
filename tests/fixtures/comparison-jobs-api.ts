import assert from "node:assert/strict"
async function run() {
// Synthetic database and authenticated users; no provider/network calls.
// @ts-expect-error Bun mocks stay isolated in this subprocess.
const { mock } = await import("bun:test")
let collectionOwner: string | null = null
let userId: string | null = "00000000-0000-4000-8000-000000000001"
mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } }) }))
mock.module("../../lib/supabase/session-user", () => ({ getFirstPartyUser: async (client: {auth:{getUser:()=>Promise<unknown>}}) => client.auth.getUser(), getSessionUser: async () => userId ? { id: userId } : null }))
mock.module("../../lib/server/collection-owner", () => ({ resolveCollectionOwnerUserId: async (_client: unknown, id: string) => collectionOwner ?? id }))
mock.module("../../lib/server/billing", () => ({ requirePaidAccess: async () => {}, billingErrorResponse: () => new Response(null, { status: 402 }) }))
let schemaReady = true
let starts = 0, cancelled = 0
mock.module("workflow/api", () => ({ start: async () => { starts++; return { runId: "synthetic-run" } }, getRun: () => ({ status: Promise.resolve("running"), cancel: async () => { cancelled++ } }) }))
mock.module("../../workflows/comparison-checks", () => ({ comparisonChecksWorkflow: async () => {} }))
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-key"
const jobs: Record<string, unknown>[] = []
let currentId = 0
const filters: URL[] = []
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith("/card_price_checks")) return Response.json([])
  assert.ok(url.pathname.endsWith("/comparison_jobs"), "only database requests allowed")
  filters.push(url)
  const matching = jobs.filter(job => [...url.searchParams].every(([key, filter]) => {
    if (!["id", "owner_user_id", "scope_key", "status", "run_id"].includes(key)) return true
    if (filter.startsWith("eq.")) return job[key] === filter.slice(3)
    if (filter.startsWith("in.")) return filter.slice(4, -1).split(",").includes(String(job[key]))
    if (filter === "is.null") return job[key] == null
    return true
  }))
  if (init?.method === "POST") {
    if (!schemaReady && JSON.parse(String(init.body)).initiated_by) return Response.json({ code: "PGRST204", message: "initiated_by column is missing" }, { status: 400 })
    const row = { ...JSON.parse(String(init.body)), id: `00000000-0000-4000-8000-${String(++currentId).padStart(12, "0")}`, status: "queued", run_id: null, created_at: new Date().toISOString() }
    jobs.push(row); return Response.json(row)
  }
  if (init?.method === "PATCH") {
    const patch = JSON.parse(String(init.body)); matching.forEach(job => Object.assign(job, patch))
    return new Response(null, { status: 204 })
  }
  const rows = url.searchParams.get("limit") === "1" ? matching.slice(-1) : matching
  return Response.json(rows)
}) as typeof fetch
const { POST, GET } = await import("../../app/api/comparison-jobs/route")
const cards = Array.from({ length: 20 }, (_, i) => ({ cardId: `synthetic-${i}`, finish: "normal" }))
const post = (body: unknown, origin = "https://synthetic.test") => POST(new Request("https://synthetic.test/app/api/comparison-jobs", { method: "POST", headers: { origin }, body: JSON.stringify(body) }))
assert.equal((await post({ action: "start", cards })).status, 409)
assert.equal(starts, 0)
assert.equal((await post({ action: "start", cards, confirmed: true }, "https://untrusted.test")).status, 403)
assert.equal((await post({ action: "start", cards: [{ cardId: null }] })).status, 400)
const first = await post({ action: "start", cards, confirmed: true })
assert.equal(first.status, 202)
const job = (await first.json()).job
assert.equal(jobs[0].initiated_by, userId, "the initiator comes from the authenticated user")
assert.equal(starts, 1)
assert.equal((await (await post({ action: "start", cards, confirmed: true })).json()).job.id, job.id)
assert.equal(starts, 1, "a repeated start reconnects without another workflow")
userId = "00000000-0000-4000-8000-000000000002"
assert.equal((await GET(new Request(`https://synthetic.test/app/api/comparison-jobs?id=${job.id}`))).status, 404)
assert.equal((await post({ action: "stop", id: job.id })).status, 404)
assert.equal(cancelled, 0)
userId = "00000000-0000-4000-8000-000000000001"
assert.equal((await post({ action: "stop", id: job.id })).status, 200)
assert.equal(cancelled, 1)
assert.equal(jobs[0].status, "cancelled")
// A partner starts a different job for the same collection owner.
collectionOwner = "00000000-0000-4000-8000-000000000001"
userId = "00000000-0000-4000-8000-000000000002"
const partner = await post({ action: "start", cards: [{ cardId: "synthetic-partner" }], initiated_by: collectionOwner })
assert.equal(partner.status, 202)
assert.equal(jobs[1].owner_user_id, collectionOwner)
assert.equal(jobs[1].initiated_by, userId, "a partner cannot spoof the notification recipient")
schemaReady = false
assert.equal((await post({ action: "start", cards: [{ cardId: "synthetic-legacy-schema" }] })).status, 202, "checks still start before the additive migration")
assert.equal(jobs[2].initiated_by, undefined)
userId = null
assert.equal((await post({ action: "start", cards, confirmed: true })).status, 401)
assert.ok(filters.filter(url => !url.searchParams.has("scope_key") && url.searchParams.has("id")).every(url => url.searchParams.has("owner_user_id")), "job-id reads and writes are owner scoped")

}
void run().catch(error => { console.error(error); process.exitCode = 1 })
