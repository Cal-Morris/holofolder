import assert from 'node:assert/strict'

async function run() {
  // Synthetic device and user. No requests reach Supabase or a push provider.
  const person = '00000000-0000-4000-8000-000000000001'
  let signedIn = true
  let updated: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  // @ts-expect-error Bun mocks are isolated to this subprocess.
  const { mock } = await import('bun:test')
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => ({ auth: { getClaims: async () => ({data:signedIn?{claims:{sub:person}}:null,error:null}), getUser: async () => ({ data: { user: signedIn ? { id: person } : null } }) } }) }))
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (table: string) => {
    assert.equal(table, 'push_subscriptions')
    const query = { update: (row: Record<string, unknown>) => { updated = row; return query }, eq: (key: string, value: unknown) => { filters[key] = value; return query }, then: (resolve: (result: unknown) => void) => resolve({ error: null }) }
    return query
  } }) }))
  const { PATCH } = await import('../../app/api/push/subscriptions/route')
  const request = (body: unknown) => new Request('https://synthetic.test/app/api/push/subscriptions', { method: 'PATCH', body: JSON.stringify(body) })
  signedIn = false
  assert.equal((await PATCH(request({ endpoint: 'synthetic', showMode: true }))).status, 401)
  signedIn = true
  for (const body of [null, {}, { endpoint: 'synthetic', showMode: 'true' }]) assert.equal((await PATCH(request(body))).status, 400)
  const before = Date.now()
  assert.equal((await PATCH(request({ endpoint: 'synthetic', showMode: true, userId: 'other', show_mode_until: '2099-01-01' }))).status, 204)
  assert.deepEqual(filters, { user_id: person, endpoint: 'synthetic' })
  const expiry = Date.parse(String(updated.show_mode_until))
  assert.ok(expiry >= before + 4 * 60 * 60 * 1000 && expiry <= Date.now() + 4 * 60 * 60 * 1000)
  assert.equal((await PATCH(request({ endpoint: 'synthetic', showMode: false }))).status, 204)
  assert.deepEqual(updated, { show_mode_until: null })
  const updates: unknown[] = []
  let subscribed = true
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscribed ? { endpoint: 'synthetic-device' } : null } }) } } })
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    updates.push(JSON.parse(String(init?.body)))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const { syncPushShowMode } = await import('../../lib/push-device-client')
  await syncPushShowMode(true)
  await syncPushShowMode(false)
  assert.deepEqual(updates, [{ endpoint: 'synthetic-device', showMode: true }, { endpoint: 'synthetic-device', showMode: false }])
  await syncPushShowMode(true, AbortSignal.abort())
  subscribed = false
  await syncPushShowMode(true)
  assert.equal(updates.length, 2, 'aborted updates and devices without subscriptions do not send requests')

}
void run().catch(error => { console.error(error); process.exitCode = 1 })
