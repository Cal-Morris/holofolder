import assert from 'node:assert/strict'

async function run() {
  // Synthetic accounts, binder and event. No network or push service is contacted.
  const actor = '00000000-0000-4000-8000-000000000001'
  const recipient = '00000000-0000-4000-8000-000000000002'
  const eventId = '00000000-0000-4000-8000-000000000003'
  const binderId = '00000000-0000-4000-8000-000000000004'
  let viewer: string | null = recipient
  let linked = true
  let binderName: string | null = 'Synthetic Trades'
  let unavailable = false
  let actorName = 'Cal Morris' // Synthetic name for the preview assertion.
  let setName: string | null = 'Synthetic set'
  let catalogUnavailable = false
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/rpc/get_billing_access')) return Response.json({ enforced: true, perpetual: true, saved_card_count: 2 })
    assert.equal(url.hostname, 'synthetic.supabase.test')
    if (url.pathname.endsWith('/partner_acquisitions')) {
      assert.equal(url.searchParams.get('id'), `eq.${eventId}`)
      return Response.json(url.searchParams.get('recipient_id') === `eq.${recipient}` ? {
        recipient_id: recipient, actor_id: actor, owner_user_id: actor, partnership_id: eventId, binder_id: binderId, actor_name: actorName, card_name: 'Synthetic card', card_id: 'synthetic-card',
      } : null)
    }
    if (url.pathname.endsWith('/partnerships')) return Response.json(linked ? { user1_id: actor, user2_id: recipient } : null)
    if (url.pathname.endsWith('/binders')) {
      assert.equal(url.searchParams.get('id'), `eq.${binderId}`)
      assert.equal(url.searchParams.get('owner_user_id'), `eq.${actor}`)
      return unavailable ? Response.json({ code: '42501', message: 'Synthetic read permission failure' }, { status: 403 }) : Response.json(binderName ? { name: binderName } : null)
    }
    if (url.pathname.endsWith('/tcg_cards')) {
      assert.equal(url.searchParams.get('id'), 'eq.synthetic-card')
      return catalogUnavailable ? Response.json({ code: '42501', message: 'Synthetic catalog failure' }, { status: 403 }) : Response.json(setName ? { tcg_sets: { name_en: setName } } : null)
    }
    throw new Error('Unexpected synthetic backend request')
  }) as typeof fetch
  // Isolated subprocess mocks, as in the existing API tests.
  // @ts-expect-error Bun types are deliberately absent from the application.
  const { mock } = await import('bun:test')
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => ({}) }))
  mock.module('../../lib/supabase/session-user', () => ({ getSessionUser: async () => viewer ? { id: viewer } : null }))
  const { GET } = await import('../../app/api/push/events/[id]/route')
  const read = () => GET(new Request('https://synthetic.test/app/api/push/events/' + eventId), { params: Promise.resolve({ id: eventId }) })
  const response = await read()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { title: 'Cal found a card', body: 'Synthetic card (Synthetic set) was added to Synthetic Trades.', url: `/app?binder=${binderId}` })
  setName = null
  assert.equal((await (await read()).json()).body, 'Synthetic card was added to Synthetic Trades.', 'Missing catalog cards retain the card name')
  setName = '   '
  assert.equal((await (await read()).json()).body, 'Synthetic card was added to Synthetic Trades.', 'Blank set names are omitted')
  catalogUnavailable = true
  assert.equal((await (await read()).json()).body, 'Synthetic card was added to Synthetic Trades.', 'Catalog failures do not hide the notification')
  actorName = 'Your partner'
  assert.equal((await (await read()).json()).title, 'Your partner found a card')
  actorName = 'synthetic@example.test'
  assert.equal((await (await read()).json()).title, 'Your partner found a card')
  viewer = null
  assert.equal((await read()).status, 401)
  viewer = actor
  assert.equal((await read()).status, 404, 'Actor cannot read recipient previews')
  viewer = recipient
  linked = false
  assert.equal((await read()).status, 404, 'Unlinking revokes preview access')
  linked = true
  binderName = null
  assert.equal((await read()).status, 404, 'A removed binder has no private preview')
  binderName = 'Synthetic Trades'
  unavailable = true
  assert.equal((await read()).status, 503, 'Unavailable authorization data must never produce a private preview')
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
