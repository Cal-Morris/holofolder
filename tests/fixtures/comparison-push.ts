import assert from "node:assert/strict"

async function run() {
  // Synthetic users, job and subscription; nothing reaches a provider or push service.
  const initiator = "00000000-0000-4000-8000-000000000001"
  const owner = "00000000-0000-4000-8000-000000000002"
  const id = "00000000-0000-4000-8000-000000000003"
  const deviceId = "00000000-0000-4000-8000-000000000004"
  let viewer: string | null = initiator
  let subscriptionUser = initiator
  let rejection = 0
  let sent = 0
  let deleted = false
  const job = { id, owner_user_id: owner, initiated_by: initiator as string | null, status: "completed", progress: { total: 65, done: 65, fresh: 5, checked: 59, failed: 1, stopped: {} } }
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.supabase.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic"
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "synthetic"
  process.env.VAPID_PRIVATE_KEY = "synthetic"
  process.env.VAPID_SUBJECT = "https://synthetic.test"
  // @ts-expect-error Bun mocks are isolated to this subprocess.
  const { mock } = await import("bun:test")
  mock.module("../../lib/supabase/server", () => ({ createClient: async () => ({}) }))
  mock.module("../../lib/supabase/session-user", () => ({ getSessionUser: async () => viewer ? { id: viewer } : null }))
  mock.module("web-push", () => ({ default: { sendNotification: async (_device: unknown, raw: string) => {
    assert.deepEqual(JSON.parse(raw), { kind: "comparison", recipientId: initiator, eventId: id, tag: `comparison:${id}` })
    sent++
    if (rejection) throw { statusCode: rejection }
  } } }))
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, "synthetic.supabase.test")
    if (url.pathname.endsWith("/comparison_jobs")) {
      assert.equal(url.searchParams.get("id"), `eq.${id}`)
      const recipient = url.searchParams.get("initiated_by")
      return Response.json(!recipient || recipient === `eq.${job.initiated_by}` ? job : null)
    }
    assert.ok(url.pathname.endsWith("/push_subscriptions"))
    if (init?.method === "DELETE") { deleted = true; return new Response(null, { status: 204 }) }
    if (!url.searchParams.has("id")) {
      assert.equal(url.searchParams.get("user_id"), `eq.${initiator}`)
      return Response.json([{ id: deviceId }])
    }
    return Response.json({ id: deviceId, user_id: subscriptionUser, endpoint: "https://web.push.apple.com/synthetic", p256dh: "synthetic", auth: "synthetic" })
  }) as typeof fetch
  const { comparisonCompletionDevices, sendComparisonCompletion } = await import("../../lib/server/comparison-push")
  const { GET } = await import("../../app/api/push/comparisons/[id]/route")
  const read = () => GET(new Request(`https://synthetic.test/app/api/push/comparisons/${id}`), { params: Promise.resolve({ id }) })
  assert.deepEqual(await comparisonCompletionDevices(id), [deviceId])
  await sendComparisonCompletion(id, deviceId)
  assert.equal(sent, 1)
  const preview = await read()
  assert.equal(preview.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(await preview.json(), { title: "Price checks finished", body: "64 of 65 printings ready. 1 couldn't be checked.", url: "/app" })
  viewer = owner
  assert.equal((await read()).status, 404, "even the collection owner cannot read the initiator's preview")
  viewer = null
  assert.equal((await read()).status, 401)
  subscriptionUser = owner
  await sendComparisonCompletion(id, deviceId)
  assert.equal(sent, 1, "a reassigned device cannot receive the initiator's notification")
  subscriptionUser = initiator
  rejection = 410
  await sendComparisonCompletion(id, deviceId)
  assert.equal(deleted, true)
  rejection = 503
  await assert.rejects(sendComparisonCompletion(id, deviceId), /temporarily unavailable/)
  job.status = "cancelled"
  assert.deepEqual(await comparisonCompletionDevices(id), [])
  const previous = sent
  await sendComparisonCompletion(id, deviceId)
  assert.equal(sent, previous)
  job.status = "completed"
  job.initiated_by = null
  assert.deepEqual(await comparisonCompletionDevices(id), [], "old jobs do not assume the owner initiated them")
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
