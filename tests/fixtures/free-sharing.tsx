import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { syntheticPublicDatabase } from './public-binder'
import type { BinderShareRecord } from '../../lib/binder-share'

async function run() {
  const owner = '00000000-0000-4000-8000-000000000001', binderId = '00000000-0000-4000-8000-000000000002'
  let actor: string | null = owner, named = false, wrongBinder = false, collectionError = false
  let share: BinderShareRecord | null = null
  let pricingSchemaMissing = false
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
          if (table === 'account_identities') return { data: filters.user_id === owner ? { username: 'synthetic' } : null, error: null }
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
  const { loadPublicBinder: realLoad } = await import('../../lib/server/public-binder')
  mock.module('../../lib/server/public-binder', () => ({ loadPublicBinder: async (identity: { token: string } | { username: string; binderSlug: string }) => {
    if (!share || !share.is_enabled || ('token' in identity ? identity.token !== share.token : !named || identity.username !== 'synthetic' || identity.binderSlug !== 'binder')) throw new Error('unavailable')
    if (wrongBinder || collectionError) throw new Error('unavailable')
    const db = syntheticPublicDatabase({ prices: share.show_prices })
    for (const table of ['binder_shares', 'resolve_named_binder_share']) db.tables[table][0].token = share.token
    return realLoad(identity, db.client)
  } }))
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
  const { default: TokenPage, generateMetadata: generateTokenMetadata } = await import('../../app/share/[token]/page')
  const { default: NamedPage, generateMetadata: generateNamedMetadata } = await import('../../app/u/[username]/[binderSlug]/page')
  actor = owner
  const tokenPage = await TokenPage({ params: Promise.resolve({ token }) })
  const signedInHtml = renderToStaticMarkup(SharedBinder(tokenPage.props))
  actor = null
  const html = renderToStaticMarkup(SharedBinder(tokenPage.props))
  actor = owner
  assert.equal(signedInHtml, html, 'public presentation is identical for owner and guest')
  assert.match(html, /Read-only binder/)
  assert.doesNotMatch(html, /PRIVATE|wanted_by|initialUser|inventoryItemId|purchase_cost/)
  const tokenMetadata = await generateTokenMetadata({ params: Promise.resolve({ token }) })
  assert.equal(tokenMetadata.title, 'Synthetic mixed binder · Holo Folder')
  assert.deepEqual(tokenMetadata.robots, { index: false, follow: false })
  named = true
  const namedMetadata = await generateNamedMetadata({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) })
  assert.equal(namedMetadata.title, '@synthetic’s Synthetic mixed binder · Holo Folder')
  assert.deepEqual(namedMetadata.robots, { index: false, follow: false })
  const namedPage = await NamedPage({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) })
  assert.equal(renderToStaticMarkup(SharedBinder(namedPage.props)), html)
  assert.equal((await api.POST(request('true'))).status, 400)
  const enabledPrices = await (await api.POST(request(true))).json()
  assert.equal(enabledPrices.share.show_prices, true)
  assert.equal(enabledPrices.share.token, token)
  const enabledTokenPage = await TokenPage({ params: Promise.resolve({ token }) })
  const enabledNamedPage = await NamedPage({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) })
  assert.equal(enabledTokenPage.props.binder.slots[0].marketGBP, 12.34)
  assert.equal(enabledNamedPage.props.binder.slots[0].marketGBP, 12.34)
  assert.equal((await (await api.POST(request())).json()).share.show_prices, true, 're-enabling preserves explicit opt-in')
  const hiddenPrices = await (await api.POST(request(false))).json()
  assert.equal(hiddenPrices.share.show_prices, false)
  assert.ok((await TokenPage({ params: Promise.resolve({ token }) })).props.binder.slots.every((s: { marketGBP?: number }) => s.marketGBP === undefined))
  await assert.rejects(TokenPage({ params: Promise.resolve({ token: 'wrong' }) }), /NOT_FOUND/)
  await assert.rejects(generateTokenMetadata({ params: Promise.resolve({ token: 'wrong' }) }), /NOT_FOUND/)
  await assert.rejects(generateNamedMetadata({ params: Promise.resolve({ username: 'invalid/name', binderSlug: 'binder' }) }), /NOT_FOUND/)
  wrongBinder = true
  await assert.rejects(generateTokenMetadata({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  await assert.rejects(generateNamedMetadata({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) }), /NOT_FOUND/)
  await assert.rejects(TokenPage({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  wrongBinder = false; collectionError = true
  await assert.rejects(TokenPage({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  collectionError = false
  const disabled = await api.DELETE(new Request(`https://synthetic.test/app/api/binder-share?binderId=${binderId}`, { method: 'DELETE' }))
  assert.equal(disabled.status, 200)
  await assert.rejects(generateTokenMetadata({ params: Promise.resolve({ token }) }), /NOT_FOUND/)
  await assert.rejects(generateNamedMetadata({ params: Promise.resolve({ username: 'synthetic', binderSlug: 'binder' }) }), /NOT_FOUND/)
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
