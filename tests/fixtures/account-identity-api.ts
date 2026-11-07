import assert from 'node:assert/strict'

async function run() {
  let signedIn = true
  let stored: string | null = null
  let errorCode: string | null = null
  let writes = 0
  const user = { id: 'synthetic-actor' }
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? user : null }, error: null }) },
    from: (table: string) => {
      assert.equal(table, 'account_identities')
      return { select: () => ({ eq: (column: string, id: string) => {
        assert.equal(column, 'user_id')
        assert.equal(id, user.id, 'Reads use the signed-in account, not the collection owner')
        return { maybeSingle: async () => ({ data: stored ? { username: stored } : null, error: errorCode ? { code: errorCode } : null }) }
      } }) }
    },
    rpc: async (fn: string, params: { p_username: string }) => {
      assert.equal(fn, 'claim_account_username')
      assert.deepEqual(Object.keys(params), ['p_username'], 'Identity comes from the verified session')
      writes++
      if (!errorCode) stored = params.p_username
      return { data: errorCode ? null : stored, error: errorCode ? { code: errorCode } : null }
    },
  }
  // Isolated subprocess module mocks, following existing route tests.
  // @ts-expect-error Bun types are deliberately absent from the application.
  const { mock } = await import('bun:test')
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => client }))
  mock.module('../../lib/supabase/session-user', () => ({ getSessionUser: async () => signedIn ? user : null }))
  const { GET, PATCH } = await import('../../app/api/account-identity/route')
  const save = (body: unknown) => PATCH(new Request('https://synthetic.test/app/api/account-identity', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  assert.deepEqual(await (await GET()).json(), { username: null })
  assert.equal((await save({ username: '../cal' })).status, 400)
  assert.equal(writes, 0)
  const saved = await save({ username: ' CAL ', userId: 'someone-else' })
  assert.equal(saved.status, 200)
  assert.equal(saved.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await saved.json(), { username: 'cal' })
  assert.deepEqual(await (await GET()).json(), { username: 'cal' })
  errorCode = '23505'
  assert.equal((await save({ username: 'taken' })).status, 409)
  errorCode = '42P01'
  assert.equal((await GET()).status, 503)
  assert.equal((await save({ username: 'new-name' })).status, 503)
  signedIn = false
  assert.equal((await GET()).status, 401)
  assert.equal((await save({ username: 'new-name' })).status, 401)
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
