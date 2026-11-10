import { createServer } from 'node:http'
import { syntheticPublicDatabase } from '../tests/fixtures/public-binder'

// Local-only synthetic PostgREST, used to exercise the REAL token/named routes and SSR.
const port = Number(process.env.PUBLIC_SHARE_BACKEND_PORT ?? 54471)
let fixture = syntheticPublicDatabase()
async function handle(request: Request) {
  const url = new URL(request.url)
  if (url.pathname === '/_synthetic/reset') {
    fixture = syntheticPublicDatabase({ disabled: url.searchParams.get('revoked') === '1', prices: url.searchParams.get('prices') === '1' })
    if (url.searchParams.has('rows')) fixture.tables.binders[0].binder_rows = Number(url.searchParams.get('rows'))
    if (url.searchParams.has('cols')) fixture.tables.binders[0].binder_cols = Number(url.searchParams.get('cols'))
    if (url.searchParams.get('light') === '1') fixture.tables.user_settings[0].dark_mode = false
    if (url.searchParams.get('wanted') === '1') {
      // Synthetic stored wants with private sentinels: an owned slot and an unfilled page-2 target.
      const want = (cardId: string) => ({ card_id: cardId, card_name: 'PRIVATE-stored-name', added_at: '2026-01-01T00:00:00.000Z', wanted_by: ['00000000-0000-4000-8000-000000000001'], notes: 'PRIVATE-notes' })
      fixture.tables.binder_slots[0].wanted_cards = [want('synthetic-energy')]
      fixture.tables.binder_slots[6].wanted_cards = [want('synthetic-trainer'), want('synthetic-energy')]
    }
    if (url.searchParams.get('stress') === '1') {
      fixture.tables.binders[0].name = 'S'.repeat(40)
      fixture.tables.inventory_items[0].grading = { grade: 'G'.repeat(500), provider: { kind: 'custom', name: 'P'.repeat(500) }, certificate: 'PRIVATE-certificate', label: { assetIds: ['PRIVATE-asset'] } }
    }
    return Response.json({ synthetic: true })
  }
  if (url.pathname === '/_synthetic/calls') return Response.json(fixture.calls)
  const name = url.pathname.split('/').at(-1)!
  if (name === 'resolve_named_binder_share') {
    const input = await request.json()
    if (input.requested_username !== 'synthetic-owner' || input.requested_slug !== 'mixed') return Response.json(null)
  }
  let query = fixture.client.from(name).select(url.searchParams.get('select') ?? '*')
  for (const [key, value] of url.searchParams) {
    if (value.startsWith('eq.')) {
      const raw = value.slice(3)
      query = query.eq(key, raw === 'true' ? true : raw === 'false' ? false : raw)
    } else if (value.startsWith('in.')) query = query.in(key, value.slice(3).replace(/^\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, '')))
    else if (value.startsWith('cs.')) query = query.contains(key, JSON.parse(value.slice(3)))
  }
  const order = url.searchParams.get('order')?.split('.')[0]
  if (order) query = query.order(order)
  const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
  query = query.range(offset, offset + limit - 1)
  const result = await query
  // maybeSingle uses a JSON array and the client enforces zero/one under current supabase-js.
  return Response.json(result.data, { headers: { 'Content-Range': `0-${Math.max(0, (result.data?.length ?? 0) - 1)}/*` } })
}
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
    const response = await handle(request)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch { res.writeHead(500); res.end('Synthetic backend failure') }
}).listen(port, '127.0.0.1')
console.log(`Synthetic public-share backend: http://127.0.0.1:${port}`)
