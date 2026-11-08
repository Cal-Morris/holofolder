import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_BINDER_SETTINGS } from '../../lib/settings'
import type { BinderShareRecord } from '../../lib/binder-share'

async function run() {
  const owner = '00000000-0000-4000-8000-000000000001', binderId = '00000000-0000-4000-8000-000000000002'
  let actor: string | null = owner, named = false, wrongBinder = false, collectionError = false
  let share: BinderShareRecord | null = null
  let pricingSchemaMissing = false
  const binder = { id: binderId, ownerUserId: owner, name: 'Synthetic binder', isDefault: true, sortOrder: 0, color: null, rows: null, cols: null, createdAt: null, updatedAt: null }
  const database = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const matches = () => share && Object.entries(filters).every(([key, value]) => share?.[key as keyof BinderShareRecord] === value)
      let missingColumn = false
      const q = {
        select() { return q },
        eq(key: string, value: unknown) { filters[key] = value; return q },
        upsert(value: BinderShareRecord) { missingColumn = pricingSchemaMissing && "show_prices" in value; if (!missingColumn) share = value; return q },
        update(value: Partial<BinderShareRecord>) { if (matches()) share = { ...share!, ...value }; return q },
        async single() { return missingColumn ? { data: null, error: { code: "PGRST204", message: "show_prices column not found" } } : { data: share, error: null } },
        async maybeSingle() {
          return { data: table === 'binders' ? filters.id === binderId && filters.owner_user_id === owner ? { id: binderId } : null : matches() ? share : null, error: null }
        },
      }
      return q
    },
    rpc(name: string) {
      if (name === 'get_billing_access') return Promise.resolve({ data: { enforced: true, free_card_limit: 100, free_binder_limit: 1 }, error: null })
      if (name === 'resolve_named_binder_share') return { maybeSingle: async () => ({ data: named && share?.is_enabled ? share : null, error: null }) }
      throw new Error(`Unexpected RPC ${name}`)
    },
  }
  const client = { ...database, auth: { getUser: async () => ({ data: { user: actor ? { id: actor } : null } }) } }
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import('bun:test')
  mock.module('../../lib/supabase/server', () => ({ createClient: async () => client }))
  mock.module('../../lib/supabase/admin', () => ({ createAdminClient: () => database }))
  mock.module('../../lib/supabase/session-user', () => ({ getFirstPartyUser: async (client: {auth:{getUser:()=>Promise<unknown>}}) => client.auth.getUser(), getSessionUser: async () => actor ? { id: actor } : null }))
  mock.module('../../lib/server/collection-owner', () => ({ resolveCollectionOwnerUserId: async (_client: unknown, id: string) => id }))
  const identity = await import('../../lib/server/public-binder-identity')
  mock.module('../../lib/server/public-binder-identity', () => ({
    ...identity,
    namedSharePath: async () => named ? '/@synthetic/binder' : null,
  }))
  mock.module('next/navigation', () => ({ notFound() { throw new Error('NOT_FOUND') } }))
  mock.module('next/server', () => ({ connection: async () => undefined }))
  mock.module('../../lib/server/binder-bootstrap', () => ({ loadBinderBootstrap: async () => ({
    collectionError: collectionError ? new Error('Synthetic read failure') : null, settings: DEFAULT_BINDER_SETTINGS, hasStoredSettings: false,
    collection: [{ pokemon_id: 1, pokemon_name: 'Synthetic card', user_id: 'private-owner', private_note: 'secret', wanted_cards: [{ card_id: 'synthetic', card_name: 'Synthetic wanted', wanted_by: [owner] }] }],
  }) }))
  const realBinders = await import('../../lib/server/binders')
  mock.module('../../lib/server/binders', () => ({ ...realBinders, resolveActiveBinder: async () => ({ activeBinder: wrongBinder ? { ...binder, id: 'other' } : binder }) }))
  mock.module('../../components/binder-app', () => ({ default: (props: Record<string, unknown>) => <pre>{JSON.stringify(props)}</pre> }))
  const api = await import('../../app/api/binder-share/route')
  const request = (showPrices?: unknown) => new Request('https://synthetic.test/app/api/binder-share', { method: 'POST', body: JSON.stringify({ binderId, ...(showPrices === undefined ? {} : { showPrices }) }) })
  const created = await api.POST(request())
  assert.equal(created.status, 200, 'free owners can create shares')
  assert.equal(created.headers.get('cache-control'), 'private, no-store')
  const payload = await created.json()
  assert.equal(payload.share.show_prices, false, 'new links hide prices')
  const token = payload.share.token
  assert.match(token, /^[A-Za-z0-9_-]{32}$/)
  assert.equal(payload.share.path, `/app/share/${token}`)
  const { default: SharedBinder } = await import('../../components/shared-binder-page')
  const { default: TokenPage, metadata: tokenMetadata } = await import('../../app/share/[token]/page')
  const { default: NamedPage, metadata: namedMetadata } = await import('../../app/u/[username]/[binderSlug]/page')
  actor = owner // Signed-in visitors keep their viewer identity on a read-only share.
  const tokenPage = await TokenPage({ params: Promise.resolve({ token }) })
  const signedInHtml = renderToStaticMarkup(await SharedBinder(tokenPage.props))
  assert.match(signedInHtml, /initialUser&quot;:\{&quot;id&quot;:&quot;00000000-0000-4000-8000-000000000001&quot;\}/)
  assert.match(signedInHtml, /readOnlyMode&quot;:true/, 'signed-in viewers still receive read-only shares')
  actor = null
  const html = renderToStaticMarkup(await SharedBinder(tokenPage.props))
  actor = owner
  assert.match(html, /readOnlyMode&quot;:true/)
  assert.match(html, /pricingEnabled&quot;:false/)
  assert.match(html, /initialPriceMode&quot;:false/)
  assert.match(html, /initialUser&quot;:null/)
  assert.doesNotMatch(html, /private_note|private-owner|wanted_by/)
  assert.deepEqual(tokenMetadata.robots, { index: false, follow: false })
  assert.deepEqual(namedMetadata.robots, { index: false, follow: false })
  named = true
  const namedPage = await NamedPage({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) })
  assert.match(renderToStaticMarkup(await SharedBinder(namedPage.props)), /initialSharePath&quot;:&quot;\/@synthetic\/binder/)
  assert.equal((await api.POST(request('true'))).status, 400)
  const enabledPrices = await (await api.POST(request(true))).json()
  assert.equal(enabledPrices.share.show_prices, true)
  assert.equal(enabledPrices.share.token, token)
  const enabledTokenPage = await TokenPage({ params: Promise.resolve({ token }) })
  const enabledNamedPage = await NamedPage({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) })
  assert.match(renderToStaticMarkup(await SharedBinder(enabledTokenPage.props)), /pricingEnabled&quot;:true/)
  assert.match(renderToStaticMarkup(await SharedBinder(enabledNamedPage.props)), /pricingEnabled&quot;:true/)
  assert.match(renderToStaticMarkup(await SharedBinder({ share: enabledPrices.share })), /pricingEnabled&quot;:true/)
  assert.equal((await (await api.POST(request())).json()).share.show_prices, true, 're-enabling preserves explicit opt-in')
  const hiddenPrices = await (await api.POST(request(false))).json()
  assert.equal(hiddenPrices.share.show_prices, false)
  assert.match(renderToStaticMarkup(await SharedBinder({ share: { ...hiddenPrices.share, show_prices: undefined } })), /pricingEnabled&quot;:false/)
  await assert.rejects(TokenPage({ params: Promise.resolve({ token: 'wrong' }) }), /NOT_FOUND/)
  wrongBinder = true
  await assert.rejects(SharedBinder({ share: payload.share }), /NOT_FOUND/)
  wrongBinder = false; collectionError = true
  await assert.rejects(SharedBinder({ share: payload.share }), /NOT_FOUND/)
  collectionError = false
  const disabled = await api.DELETE(new Request(`https://synthetic.test/app/api/binder-share?binderId=${binderId}`, { method: 'DELETE' }))
  assert.equal(disabled.status, 200)
  await assert.rejects(TokenPage({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  await assert.rejects(NamedPage({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) }), /NOT_FOUND/)
  assert.equal((await (await api.POST(request())).json()).share.token, token, 're-enable retains the token')
  pricingSchemaMissing = true
  assert.equal((await api.POST(request())).status, 200, 'sharing works before pricing migration')
  assert.equal((await api.POST(request(true))).status, 503, 'opt-in fails clearly before pricing migration')
  pricingSchemaMissing = false
  actor = '00000000-0000-4000-8000-000000000003'
  assert.equal((await api.POST(request())).status, 404)
  actor = null
  assert.equal((await api.POST(request())).status, 401)
  assert.equal((await api.GET(request())).status, 401)
  const crossSite = request(); crossSite.headers.set('sec-fetch-site', 'cross-site')
  assert.equal((await api.POST(crossSite)).status, 403)
}
run().catch(error => { console.error(error); process.exitCode = 1 })
