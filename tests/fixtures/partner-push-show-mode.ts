import assert from 'node:assert/strict'

async function run() {
  // Synthetic users, event and device; no requests reach a push provider.
  let until: string | null = null
  let expiryAtDelivery: string | null | undefined
  let sent = 0
  let claims = 0
  let deviceFilter = false
  // @ts-expect-error Bun mocks are isolated to this subprocess.
  const { mock } = await import('bun:test')
  mock.module('../../lib/server/billing', () => ({ getBillingAccess: async () => ({ enforced: false }) }))
  mock.module('web-push', () => ({ default: { sendNotification: async () => { sent++ } } }))
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => ({
    rpc: async () => { claims++; return { data: 'synthetic-lease', error: null } },
    from: (table: string) => {
      let single = false, selection = '', writing = false
      const query = {
        select: (value: string) => { selection = value; return query },
        eq: () => query,
        gt: (key: string) => { assert.equal(key, 'show_mode_until'); deviceFilter = true; return query },
        update: () => { writing = true; return query },
        maybeSingle: () => { single = true; return query },
        then: (resolve: (result: unknown) => void) => {
          let data: unknown = null
          if (!writing && table === 'partner_acquisitions') data = { recipient_id: 'synthetic-recipient', owner_user_id: 'synthetic-owner', created_at: new Date().toISOString() }
          if (!writing && table === 'push_subscriptions') data = single
            ? { user_id: 'synthetic-recipient', endpoint: 'synthetic-endpoint', p256dh: 'synthetic-key', auth: 'synthetic-auth', show_mode_until: expiryAtDelivery === undefined ? until : expiryAtDelivery }
            : until && Date.parse(until) > Date.now() ? [{ id: 'synthetic-device' }] : []
          if (single && table === 'push_subscriptions') assert.ok(selection.includes('show_mode_until'))
          resolve({ data, error: null })
        },
      }
      return query
    },
  }) }))
  const { partnerAcquisitionPush } = await import('../../workflows/partner-acquisition-push')
  for (until of [null, new Date(Date.now() - 1000).toISOString()]) {
    assert.deepEqual(await partnerAcquisitionPush('synthetic-event'), { devices: 0, delivered: 0 })
    assert.ok(deviceFilter, 'recipient enumeration must filter Show mode expiry')
  }
  assert.equal(claims, 0)
  until = new Date(Date.now() + 60_000).toISOString()
  assert.deepEqual(await partnerAcquisitionPush('synthetic-event'), { devices: 1, delivered: 1 })
  assert.equal(sent, 1)
  for (expiryAtDelivery of [null, new Date(Date.now() - 1000).toISOString()]) {
    assert.deepEqual(await partnerAcquisitionPush('synthetic-event'), { devices: 1, delivered: 0 })
  }
  assert.equal(sent, 1, 'turning Show mode off or expiring between enumeration and delivery prevents sending')
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
