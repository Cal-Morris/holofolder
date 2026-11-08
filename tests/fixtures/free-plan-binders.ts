import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import type { Binder } from '../../lib/binders/model'

async function run() {
  let signedIn = true, paid = false, legacy = false, racing = false
  const rows: Binder[] = []
  const owner = '00000000-0000-4000-8000-000000000001'
  const admin = {
    async rpc(name: string) {
      assert.equal(name, 'get_billing_access')
      return { data: { enforced: true, perpetual: paid, ...(!legacy ? { free_card_limit: 100, free_binder_limit: 1 } : {}) }, error: null }
    },
    from(table: string) {
      let inserted: Record<string, unknown> | undefined
      const q = {
        select() { return q }, eq() { return q },
        insert(value: Record<string, unknown>) { inserted = value; return q },
        async single() {
          assert.equal(table, 'binders')
          if (racing) return { data: null, error: { code: 'P0001', message: 'binder_limit_reached' } }
          const id = crypto.randomUUID()
          rows.push({ id, ownerUserId: owner, name: String(inserted?.name), isDefault: inserted?.is_default === true, sortOrder: Number(inserted?.sort_order), color: null, rows: null, cols: null, createdAt: null, updatedAt: null })
          return { data: { id }, error: null }
        },
        then(resolve: (result: { count: number; error: null }) => unknown) { return Promise.resolve({ count: 0, error: null }).then(resolve) },
      }
      return q
    },
  }
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import('bun:test')
  mock.module('../../lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getClaims: async () => ({data: signedIn ? {claims:{sub:owner}} : null,error:null}), getUser: async () => ({ data: { user: signedIn ? { id: owner } : null } }) } }),
  }))
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => admin }))
  mock.module('../../lib/server/collection-owner', () => ({ resolveCollectionOwnerUserId: async () => owner }))
  mock.module('../../lib/server/binders', () => ({ listOwnerBinders: async () => rows, ensureDefaultBinderId: async () => { throw new Error('POST must not create an extra default binder') } }))
  const { POST } = await import('../../app/api/binders/route')
  const post = (name = 'Synthetic named binder') => POST(new NextRequest('https://synthetic.test/app/api/binders', { method: 'POST', body: JSON.stringify({ name }) }))
  const first = await post()
  assert.equal(first.status, 200)
  const created = (await first.json()).binders[0]
  assert.equal(created.name, 'Synthetic named binder')
  assert.equal(created.isDefault, true)
  const second = await post()
  assert.equal(second.status, 402)
  assert.equal((await second.json()).code, 'binder_limit_reached')
  paid = true
  assert.equal((await post()).status, 200)
  assert.equal(rows[1].isDefault, false)
  paid = false; legacy = true
  assert.equal((await post()).status, 200, 'legacy server policy keeps creation working before migration')
  racing = true
  const conflict = await post()
  assert.equal(conflict.status, 402)
  assert.equal((await conflict.json()).code, 'binder_limit_reached')
  signedIn = false
  assert.equal((await post()).status, 401)
}
run().catch(error => { console.error(error); process.exitCode = 1 })
